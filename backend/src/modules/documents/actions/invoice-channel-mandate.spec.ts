/**
 * Root TODO item 11, "canal imposé par pays" — the WIRING inside `invoice-actions.ts`'s "send":
 * `resolveCompanyCountryCode` and `activeChannelMandateFor` (`channel-policy/mandate.ts`) are both
 * mocked here, the same way `documents.service.invoice.spec.ts` already mocks
 * `country-policy/country-policy` wholesale — this file's job is "does invoice-actions.ts react
 * correctly to a mandate decision", never "is the FR/PDP mandate's own date arithmetic right" (that
 * is `channel-policy/mandate.spec.ts`'s job) nor "is `2026-09-01` the real, shipped date" (that is
 * `channel-policy/registry.spec.ts`'s job). Calls the registered "send" handler directly, bypassing
 * `DocumentsService.runAction`'s own gates entirely — the exact same style `send-divergence.spec.ts`
 * already established for this module.
 */
import { NotImplementedException } from '@nestjs/common';

import * as persistence from '../persistence';
import * as countryPolicy from '../country-policy/country-policy';
import * as mandate from '../transports/channel-policy/mandate';
import { TransportRegistry } from '../transports/transport-registry';
import * as companyTransport from '../transports/company-transport';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import * as taxLoadAndResolve from '../tax/load-and-resolve';

jest.mock('../persistence');
jest.mock('../transports/company-transport');
jest.mock('../country-policy/country-policy');
jest.mock('../transports/channel-policy/mandate');
// `async-send.ts`'s own "number at enqueue time" mechanism (see that file's header) reaches Prisma
// directly for a real invoice — mocked here for the same reason `send-divergence.spec.ts` and
// `documents.service.invoice.spec.ts` already mock it: this file has no Nest, no DB, and does not
// care about numbering at all, only about the mandate decision.
jest.mock('../numbering/take-number');
// Root TODO item 16 ("transfrontalier") — see `send-divergence.spec.ts`'s own comment on this exact
// mock: a permissive pass-through, this file's own concern is the channel mandate, never cross-border
// VAT.
jest.mock('../tax/load-and-resolve');

const FR_MANDATE = {
  providerId: 'pdp',
  mandatedFrom: '2026-09-01',
  provenance: {
    kind: 'legal' as const,
    sourceText: 'Seule une plateforme agréée est habilitée à assurer toutes les fonctionnalités prévues.',
    sourceCheckedAt: '2026-08-27',
  },
};

const documentData = {
  client: 'client-1',
  issueDate: '2026-09-01',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' }],
};

function draftDocument() {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data: documentData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function sendingDocument() {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data: documentData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildRegistry(transportRegistry = new TransportRegistry()) {
  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: jest.fn() } });
  return registry;
}

describe('invoice "send" — a country channel mandate overrides the company\'s free choice', () => {
  afterEach(() => jest.resetAllMocks());
  // Root TODO item 16 — see `send-divergence.spec.ts`'s own comment on this exact mock and why it is
  // re-installed here, in `beforeEach`, rather than relying on the module factory alone.
  beforeEach(() => {
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
  });

  it('BLOCKS at the preflight when the company is configured for a DIFFERENT transport — never persisted, message names channel + source', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(FR_MANDATE);
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/FR requires invoices issued on or after 2026-09-01/);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    await expect(action).rejects.toThrow(/Seule une plateforme agréée/);
    await expect(action).rejects.toThrow(/currently configured to send invoices via "email"/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('BLOCKS the same way when NO transport is configured at all — names the mandate, not the generic "no transport" message', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(FR_MANDATE);
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue(null);
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const handler = buildRegistry().resolve('invoice', 'send');
    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    await expect(action).rejects.toThrow(/No transport is configured for this company/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('BLOCKS, naming both the mandate AND the underlying reason, when the mandated channel IS chosen but its own preflight refuses (not connected)', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(FR_MANDATE);
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('pdp');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('pdp', 'PDP', {
      send: jest.fn(),
      preflight: jest
        .fn()
        .mockRejectedValue(new NotImplementedException('The PDP channel is not connected for this company.')),
    });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/FR requires invoices issued on or after 2026-09-01/);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    await expect(action).rejects.toThrow(/already chose "pdp"/);
    await expect(action).rejects.toThrow(/The PDP channel is not connected for this company\./);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('ALLOWS the send once the mandated channel is chosen AND ready — the mandate does not block what it requires', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(FR_MANDATE);
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('pdp');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(sendingDocument());

    const transportRegistry = new TransportRegistry();
    const fakePreflight = jest.fn().mockResolvedValue(undefined);
    transportRegistry.register('pdp', 'PDP', { send: jest.fn(), preflight: fakePreflight });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    expect(fakePreflight).toHaveBeenCalledWith('company-1');
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it('a country with NO active mandate leaves the company entirely free to choose — unaffected by this task', async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('DE');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(undefined);
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(sendingDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it("deliver() (the worker's replay, phase 2) ALSO respects the mandate — a mismatch is refused even if the preflight somehow let it through", async () => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(FR_MANDATE);
    // The company switched its transport to "email" AFTER the job was enqueued — deliver() must
    // still honor the mandate at the moment it actually runs, not trust whatever preflight decided.
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: jest.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });
});
