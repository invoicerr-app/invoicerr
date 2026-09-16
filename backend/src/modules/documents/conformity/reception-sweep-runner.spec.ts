/**
 * `PdpReceptionSweepRunner` in isolation — `pollers/pdp-reception-poller.ts` and
 * `transports/pdp/pdp-reception.ts` (the poller/pusher this runner builds internally, see its own
 * header) are BOTH mocked wholesale: the real PDP round-trip is those two files' own specs
 * (`pdp-reception-poller.spec.ts`, `pdp-reception.spec.ts`) plus `pdp-reception.live.spec.ts`. This
 * file's own concern is the SWEEP's wiring: which companies it visits, the dedup-by-`pdpInboundId`
 * check, and that `DocumentsService.runAction('receive')` is called with the right shape — the SAME
 * "mock the leaf, prove the orchestration" split every OTHER sweep runner spec in this directory
 * already holds (`conformity-sweep-runner.spec.ts`'s own header).
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import * as persistence from '../persistence';
import * as storage from '../received-invoices/storage';
import * as supplierReconciliation from '../received-invoices/supplier-reconciliation';
import { DocumentsService } from '../documents.service';
import { DocumentEventsPublisher } from '../queue/document-events-publisher';
import { buildPdpReceptionPoller } from './pollers/pdp-reception-poller';
import { PdpReceptionSweepRunner } from './reception-sweep-runner';
import { buildPdpReceptionStatusPusher } from '../transports/pdp/pdp-reception';

jest.mock('./pollers/pdp-reception-poller');
jest.mock('../transports/pdp/pdp-reception');
jest.mock('../persistence');
jest.mock('../received-invoices/storage');
jest.mock('../received-invoices/supplier-reconciliation');

const mockedBuildPoller = buildPdpReceptionPoller as jest.Mock;
const mockedBuildPusher = buildPdpReceptionStatusPusher as jest.Mock;
const mockedListDocuments = persistence.listDocuments as jest.Mock;
const mockedPersistInboundFile = storage.persistInboundFile as jest.Mock;
const mockedReconcile = supplierReconciliation.reconcileSupplierClient as jest.Mock;

const ACTIVE_CONFIG_A = { companyId: 'company-a', providerId: 'pdp', channel: 'PDP', environment: 'TEST' };
const ACTIVE_CONFIG_B = { companyId: 'company-b', providerId: 'pdp', channel: 'PDP', environment: 'TEST' };

function buildChannelCredentials(listActiveByProvider = jest.fn().mockResolvedValue([])) {
  return { listActiveByProvider } as unknown as ChannelCredentialsService;
}

function buildDocumentsService(runAction = jest.fn()) {
  return { runAction } as unknown as DocumentsService;
}

describe('PdpReceptionSweepRunner.runSweep', () => {
  let listInbound: jest.Mock;
  let downloadAndExtract: jest.Mock;
  let pushTakenInCharge: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    listInbound = jest.fn().mockResolvedValue([]);
    downloadAndExtract = jest.fn();
    mockedBuildPoller.mockReturnValue({ providerId: 'pdp', listInbound, downloadAndExtract });

    pushTakenInCharge = jest.fn().mockResolvedValue(undefined);
    mockedBuildPusher.mockReturnValue({
      pushTakenInCharge,
      pushApproved: jest.fn(),
      pushRejected: jest.fn(),
      pushPaid: jest.fn(),
    });

    mockedListDocuments.mockResolvedValue([]);
    mockedPersistInboundFile.mockReturnValue('file:///tmp/whatever');
    mockedReconcile.mockResolvedValue({ outcome: 'no-match' });
  });

  it('visits every company with an active PDP channel, importing nothing when none has inbound deposits', async () => {
    const channelCredentials = buildChannelCredentials(
      jest.fn().mockResolvedValue([ACTIVE_CONFIG_A, ACTIVE_CONFIG_B]),
    );
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService());

    const result = await runner.runSweep();

    expect(listInbound).toHaveBeenCalledWith('company-a');
    expect(listInbound).toHaveBeenCalledWith('company-b');
    expect(result).toEqual({ companies: 2, imported: 0, skipped: 0, failed: 0 });
  });

  it('imports a NEW inbound deposit through DocumentsService.runAction("receive"), the exact production entry point', async () => {
    const channelCredentials = buildChannelCredentials(jest.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 604667, direction: 'in' }]);
    downloadAndExtract.mockResolvedValue({
      bytes: Buffer.from('%PDF-1.4 fake'),
      mime: 'application/pdf',
      fileName: 'pdp-inbound-604667.pdf',
      extraction: { syntax: 'FACTURX_CII', fields: { supplier: 'Acme Supplies', currency: 'EUR' } },
    });
    const runAction = jest.fn().mockResolvedValue({ document: { id: 'ri-1' }, changed: true });
    const eventsPublisher = { publish: jest.fn() } as unknown as DocumentEventsPublisher;
    const runner = new PdpReceptionSweepRunner(
      channelCredentials,
      buildDocumentsService(runAction),
      eventsPublisher,
    );

    const result = await runner.runSweep();

    expect(runAction).toHaveBeenCalledWith(
      'company-a',
      'received-invoice',
      'receive',
      expect.objectContaining({
        documentId: undefined,
        data: expect.objectContaining({
          supplier: 'Acme Supplies',
          currency: 'EUR',
          pdpInboundId: '604667',
          pdpProviderId: 'pdp',
        }),
        params: {},
      }),
    );
    expect(pushTakenInCharge).toHaveBeenCalledWith('company-a', '604667');
    expect(eventsPublisher.publish).toHaveBeenCalledWith('company-a', {
      documentId: 'ri-1',
      typeId: 'received-invoice',
      kind: 'authority-event',
    });
    expect(result).toEqual({ companies: 1, imported: 1, skipped: 0, failed: 0 });
  });

  it('fills in `data.supplierClient` when supplier reconciliation matches — the SAME single point every other path into this type converges on', async () => {
    const channelCredentials = buildChannelCredentials(jest.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 604667, direction: 'in' }]);
    downloadAndExtract.mockResolvedValue({
      bytes: Buffer.from('xml'),
      mime: 'application/xml',
      fileName: 'pdp-inbound-604667.xml',
      extraction: { syntax: 'CII', fields: { supplier: 'Acme Supplies', supplierVatId: 'FR123' } },
    });
    mockedReconcile.mockResolvedValue({ outcome: 'matched', clientId: 'client-9' });
    const runAction = jest.fn().mockResolvedValue({ document: { id: 'ri-1' }, changed: true });
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService(runAction));

    await runner.runSweep();

    expect(mockedReconcile).toHaveBeenCalledWith('company-a', {
      vatId: 'FR123',
      supplierName: 'Acme Supplies',
    });
    expect(runAction).toHaveBeenCalledWith(
      'company-a',
      'received-invoice',
      'receive',
      expect.objectContaining({ data: expect.objectContaining({ supplierClient: 'client-9' }) }),
    );
  });

  it('skips a deposit already imported — dedup by `data.pdpInboundId`, never a second `received-invoice`', async () => {
    const channelCredentials = buildChannelCredentials(jest.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 604667, direction: 'in' }]);
    mockedListDocuments.mockResolvedValue([
      { id: 'ri-1', typeId: 'received-invoice', status: 'received', data: { pdpInboundId: '604667' } },
    ]);
    const runAction = jest.fn();
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService(runAction));

    const result = await runner.runSweep();

    expect(runAction).not.toHaveBeenCalled();
    expect(downloadAndExtract).not.toHaveBeenCalled();
    expect(result).toEqual({ companies: 1, imported: 0, skipped: 1, failed: 0 });
  });

  it("never lets one company's failure stop the pass for every other company", async () => {
    const channelCredentials = buildChannelCredentials(
      jest.fn().mockResolvedValue([ACTIVE_CONFIG_A, ACTIVE_CONFIG_B]),
    );
    listInbound.mockImplementation(async (companyId: string) => {
      if (companyId === 'company-a') throw new Error('sandbox network blip');
      return [];
    });
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService());

    const result = await runner.runSweep();

    expect(listInbound).toHaveBeenCalledWith('company-b'); // still visited
    expect(result).toEqual({ companies: 2, imported: 0, skipped: 0, failed: 1 });
  });
});
