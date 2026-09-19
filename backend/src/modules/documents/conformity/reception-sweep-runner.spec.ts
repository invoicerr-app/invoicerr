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
import { vi, type Mock } from 'vitest';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import * as storage from '../received-invoices/storage';
import * as supplierReconciliation from '../received-invoices/supplier-reconciliation';
import { DocumentsService } from '../documents.service';
import { DocumentEventsPublisher } from '../queue/document-events-publisher';
import { buildPdpReceptionPoller } from './pollers/pdp-reception-poller';
import { PdpReceptionSweepRunner } from './reception-sweep-runner';
import { buildPdpReceptionStatusPusher } from '../transports/pdp/pdp-reception';

vi.mock('./pollers/pdp-reception-poller');
vi.mock('../transports/pdp/pdp-reception');
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { $queryRaw: vi.fn() },
}));
vi.mock('../received-invoices/storage');
vi.mock('../received-invoices/supplier-reconciliation');

const mockedBuildPoller = buildPdpReceptionPoller as Mock;
const mockedBuildPusher = buildPdpReceptionStatusPusher as Mock;
// `isAlreadyImported` issues a raw, tagged-template query (see that method's own header for why —
// the index this proves against would never actually be USED by Prisma's own JSON-path filter) —
// mocked as a plain function, called with the template's own interpolated values as its rest args,
// matching how `prisma.$queryRaw` itself is invoked under the hood.
const mockedQueryRaw = (prisma as unknown as { $queryRaw: Mock }).$queryRaw;
const mockedPersistInboundFile = storage.persistInboundFile as Mock;
const mockedReconcile = supplierReconciliation.reconcileSupplierClient as Mock;

/** A `PrismaClientKnownRequestError` shaped exactly like a real `P2002` unique-constraint violation —
 *  the constructor itself requires an internal `clientVersion`, which this codebase's own
 *  `reminder-sweep-runner.spec.ts` already builds the identical way for the same reason (there is no
 *  public factory for this class). */
function p2002Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`companyId`,`data->>'pdpInboundId'`)",
    { code: 'P2002', clientVersion: '7.8.0' },
  );
}

const ACTIVE_CONFIG_A = { companyId: 'company-a', providerId: 'pdp', channel: 'PDP', environment: 'TEST' };
const ACTIVE_CONFIG_B = { companyId: 'company-b', providerId: 'pdp', channel: 'PDP', environment: 'TEST' };

function buildChannelCredentials(listActiveByProvider = vi.fn().mockResolvedValue([])) {
  return { listActiveByProvider } as unknown as ChannelCredentialsService;
}

function buildDocumentsService(runAction = vi.fn()) {
  return { runAction } as unknown as DocumentsService;
}

describe('PdpReceptionSweepRunner.runSweep', () => {
  let listInbound: Mock;
  let downloadAndExtract: Mock;
  let pushTakenInCharge: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    listInbound = vi.fn().mockResolvedValue([]);
    downloadAndExtract = vi.fn();
    mockedBuildPoller.mockReturnValue({ providerId: 'pdp', listInbound, downloadAndExtract });

    pushTakenInCharge = vi.fn().mockResolvedValue(undefined);
    mockedBuildPusher.mockReturnValue({
      pushTakenInCharge,
      pushApproved: vi.fn(),
      pushRejected: vi.fn(),
      pushPaid: vi.fn(),
    });

    mockedQueryRaw.mockResolvedValue([]);
    mockedPersistInboundFile.mockReturnValue('file:///tmp/whatever');
    mockedReconcile.mockResolvedValue({ outcome: 'no-match' });
  });

  it('visits every company with an active PDP channel, importing nothing when none has inbound deposits', async () => {
    const channelCredentials = buildChannelCredentials(
      vi.fn().mockResolvedValue([ACTIVE_CONFIG_A, ACTIVE_CONFIG_B]),
    );
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService());

    const result = await runner.runSweep();

    expect(listInbound).toHaveBeenCalledWith('company-a');
    expect(listInbound).toHaveBeenCalledWith('company-b');
    expect(result).toEqual({ companies: 2, imported: 0, skipped: 0, failed: 0 });
  });

  it('imports a NEW inbound deposit through DocumentsService.runAction("receive"), the exact production entry point', async () => {
    const channelCredentials = buildChannelCredentials(vi.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 604667, direction: 'in' }]);
    downloadAndExtract.mockResolvedValue({
      bytes: Buffer.from('%PDF-1.4 fake'),
      mime: 'application/pdf',
      fileName: 'pdp-inbound-604667.pdf',
      extraction: { syntax: 'FACTURX_CII', fields: { supplier: 'Acme Supplies', currency: 'EUR' } },
    });
    const runAction = vi.fn().mockResolvedValue({ document: { id: 'ri-1' }, changed: true });
    const eventsPublisher = { publish: vi.fn() } as unknown as DocumentEventsPublisher;
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
    const channelCredentials = buildChannelCredentials(vi.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 604667, direction: 'in' }]);
    downloadAndExtract.mockResolvedValue({
      bytes: Buffer.from('xml'),
      mime: 'application/xml',
      fileName: 'pdp-inbound-604667.xml',
      extraction: { syntax: 'CII', fields: { supplier: 'Acme Supplies', supplierVatId: 'FR123' } },
    });
    mockedReconcile.mockResolvedValue({ outcome: 'matched', clientId: 'client-9' });
    const runAction = vi.fn().mockResolvedValue({ document: { id: 'ri-1' }, changed: true });
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

  it('skips a deposit already imported — dedup by an EXACT `data.pdpInboundId` lookup, never a second `received-invoice`', async () => {
    const channelCredentials = buildChannelCredentials(vi.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 604667, direction: 'in' }]);
    mockedQueryRaw.mockResolvedValue([{ id: 'ri-1' }]);
    const runAction = vi.fn();
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService(runAction));

    const result = await runner.runSweep();

    // The tagged-template call's own rest args are exactly its interpolated values, in order — see
    // `isAlreadyImported`'s own header for why this is a hand-written `->>'pdpInboundId'` query, never
    // Prisma's own JSON-path filter.
    const [, ...values] = mockedQueryRaw.mock.calls[0];
    expect(values).toEqual(['company-a', 'received-invoice', '604667']);
    expect(runAction).not.toHaveBeenCalled();
    expect(downloadAndExtract).not.toHaveBeenCalled();
    expect(result).toEqual({ companies: 1, imported: 0, skipped: 1, failed: 0 });
  });

  // THE MUTATION TARGET: the OLD dedup check scanned only the last 500 received invoices — a deposit
  // older than that window would silently stop being recognized as already-imported. This test proves
  // the NEW lookup has no such window: the query filters on the EXACT `pdpInboundId` value itself,
  // never a `LIMIT`/offset over a company's own history, so a company's history size can never matter
  // (a `LIMIT 1` IS present — "does at least one match exist", never a bounded scan window).
  it('still recognizes an already-imported deposit regardless of how large this company’s received-invoice history is', async () => {
    const channelCredentials = buildChannelCredentials(vi.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 1, direction: 'in' }]);
    mockedQueryRaw.mockResolvedValue([{ id: 'ri-old' }]);
    const runAction = vi.fn();
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService(runAction));

    const result = await runner.runSweep();

    const [sql, ...values] = mockedQueryRaw.mock.calls[0];
    expect(sql.join('')).not.toMatch(/OFFSET/i);
    expect(values).toEqual(['company-a', 'received-invoice', '1']);
    expect(result).toEqual({ companies: 1, imported: 0, skipped: 1, failed: 0 });
  });

  // THE MUTATION TARGET this whole rewrite exists to close (this file's own header, "Idempotency"):
  // Prisma's own `{ path: [...], equals }` JSON filter compiles to a `#>`-based expression on
  // Postgres, byte-for-byte DIFFERENT from the partial unique index's own `->>'pdpInboundId'` — so it
  // would never actually use that index. Asserted here against the LITERAL SQL text, not merely "some
  // query happened", because a query that merely returns the right ANSWER (every test above already
  // proves that) would still silently regress this fix if it stopped matching the index's own
  // expression.
  it("queries the EXACT `->>'pdpInboundId'` text expression the partial unique index declares", async () => {
    const channelCredentials = buildChannelCredentials(vi.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 604667, direction: 'in' }]);
    mockedQueryRaw.mockResolvedValue([]);
    downloadAndExtract.mockResolvedValue({
      bytes: Buffer.from('pdf'),
      mime: 'application/pdf',
      fileName: 'invoice.pdf',
      extraction: { fields: {} },
    });
    const runner = new PdpReceptionSweepRunner(
      channelCredentials,
      buildDocumentsService(vi.fn().mockResolvedValue({ document: { id: 'ri-1' }, changed: true })),
    );

    await runner.runSweep();

    const [sql] = mockedQueryRaw.mock.calls[0];
    expect(sql.join('')).toContain(`"data"->>'pdpInboundId'`);
    expect(sql.join('')).not.toContain('#>');
  });

  // THE MUTATION TARGET: a genuine race between two overlapping sweep passes for the SAME
  // never-before-seen deposit — the partial unique index (this file's own header) makes the LOSING
  // side's write fail with P2002. That must read as an ordinary dedup hit, never a sweep failure, and
  // must never abort the REST of this company's own deposits in the same pass.
  it('treats a P2002 conflict on import as a concurrent-pass dedup hit — never a failure, never aborts the rest of this company’s deposits', async () => {
    const channelCredentials = buildChannelCredentials(vi.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([
      { id: 1, direction: 'in' },
      { id: 2, direction: 'in' },
    ]);
    downloadAndExtract.mockResolvedValue({
      bytes: Buffer.from('%PDF-1.4 fake'),
      mime: 'application/pdf',
      fileName: 'pdp-inbound.pdf',
      extraction: { syntax: 'FACTURX_CII', fields: { supplier: 'Acme Supplies' } },
    });
    const runAction = vi
      .fn()
      .mockRejectedValueOnce(p2002Error()) // deposit 1: lost the race
      .mockResolvedValueOnce({ document: { id: 'ri-2' }, changed: true }); // deposit 2: imports fine
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService(runAction));

    const result = await runner.runSweep();

    expect(runAction).toHaveBeenCalledTimes(2); // deposit 2 was still attempted, never skipped upstream
    expect(result).toEqual({ companies: 1, imported: 1, skipped: 1, failed: 0 });
  });

  it('still counts a genuinely UNRELATED failure during import as a failure, never silently as a dedup hit', async () => {
    const channelCredentials = buildChannelCredentials(vi.fn().mockResolvedValue([ACTIVE_CONFIG_A]));
    listInbound.mockResolvedValue([{ id: 1, direction: 'in' }]);
    downloadAndExtract.mockRejectedValue(new Error('PDP download timed out'));
    const runner = new PdpReceptionSweepRunner(channelCredentials, buildDocumentsService());

    const result = await runner.runSweep();

    expect(result).toEqual({ companies: 1, imported: 0, skipped: 0, failed: 1 });
  });

  it("never lets one company's failure stop the pass for every other company", async () => {
    const channelCredentials = buildChannelCredentials(
      vi.fn().mockResolvedValue([ACTIVE_CONFIG_A, ACTIVE_CONFIG_B]),
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
