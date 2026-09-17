/**
 * The `__crossBorderCategory`/`__crossBorderMentions` sidecar strip on invoice "send" — see
 * `invoice-actions.ts`'s own `registerInvoiceActions` header for the full "why". Same test-double
 * style as `invoice-channel-mandate.spec.ts`: calls the registered "send" handler directly, bypassing
 * `DocumentsService.runAction`'s own gates entirely, with `country-policy`, the channel mandate,
 * company-transport, B2G routing, and numbering all mocked so this file's own concern — does the
 * handler strip a caller-supplied sidecar before persistence/preflight, and never strip the SAME
 * sidecar on a worker replay — is exercised in isolation from every one of those other mechanisms.
 */
import * as persistence from '../persistence';
import * as countryPolicy from '../country-policy/country-policy';
import * as mandate from '../transports/channel-policy/mandate';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import * as takeNumber from '../numbering/take-number';
import * as taxLoadAndResolve from '../tax/load-and-resolve';
import { TransportRegistry } from '../transports/transport-registry';
import * as companyTransport from '../transports/company-transport';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';

jest.mock('../persistence');
jest.mock('../transports/company-transport');
jest.mock('../country-policy/country-policy');
jest.mock('../transports/channel-policy/mandate');
jest.mock('../b2g-routing/b2g-routing');
jest.mock('../numbering/take-number');
jest.mock('../tax/load-and-resolve');

// A domestic invoice — a client posting a cross-border sidecar directly is exactly the case that must
// never be honored: nothing about this data legitimately involves the tax engine at all.
const poisonedLine = {
  description: 'Consulting',
  quantity: 1,
  unit: 'unit',
  unitPrice: 100,
  vatRate: '999-not-a-real-rate',
  __crossBorderCategory: 'AE',
  __crossBorderExemptionReason: 'Fabricated by the caller, not the tax engine',
};

const poisonedData = {
  client: 'client-1',
  issueDate: '2026-09-01',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [poisonedLine],
  __crossBorderMentions: [{ code: 'X', text: 'Autoliquidation — art. 283-2 du CGI (fabricated)' }],
};

function draftDocument() {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data: poisonedData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function sendingDocument() {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data: poisonedData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildRegistry() {
  const registry = new ActionRegistry();
  const transportRegistry = new TransportRegistry();
  transportRegistry.register('email', 'Email', { send: jest.fn().mockResolvedValue({ message: 'Sent.' }) });
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: jest.fn() } });
  return registry;
}

describe('invoice "send" — the __crossBorder* sidecar strip', () => {
  afterEach(() => jest.resetAllMocks());

  beforeEach(() => {
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateFor as jest.Mock).mockReturnValue(null);
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
    (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
      applies: false,
      missingIdentifierSchemes: [],
    });
    // Echoes back whatever it is handed — this file's own concern is what DATA reaches this call,
    // never the tax engine's own domestic/cross-border decision (that is resolve-invoice-tax.spec.ts's
    // job). A domestic-STANDARD invoice's real resolver returns `data` UNCHANGED (the exact behavior
    // this test double stands in for) — see `tax/resolve-invoice-tax.ts`'s own header.
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
  });

  it('phase 1 (fresh submission): strips both sidecars BEFORE the tax preflight ever sees them, and persists the cleaned data — never the fabricated mention/category', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({ ...draftDocument(), status: 'sending' });
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const handler = buildRegistry().resolve('invoice', 'send');
    await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: poisonedData,
      params: {},
      currentStatus: 'draft',
    });

    // The tax engine's own preflight call never even sees the caller's fabricated sidecars.
    const [, dataHandedToPreflight] = (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock)
      .mock.calls[0];
    expect(dataHandedToPreflight).not.toHaveProperty('__crossBorderMentions');
    expect((dataHandedToPreflight.lines as Record<string, unknown>[])[0]).not.toHaveProperty(
      '__crossBorderCategory',
    );
    expect((dataHandedToPreflight.lines as Record<string, unknown>[])[0]).not.toHaveProperty(
      '__crossBorderExemptionReason',
    );

    // Nor does the persisted "sending" write — the mention can never reach the printed PDF or the
    // transmitted XML (both read straight off the persisted document's own `data`).
    const persistedData = (persistence.upsertDocument as jest.Mock).mock.calls[0][4] as Record<
      string,
      unknown
    >;
    expect(persistedData).not.toHaveProperty('__crossBorderMentions');
    expect((persistedData.lines as Record<string, unknown>[])[0]).not.toHaveProperty('__crossBorderCategory');

    // Every LEGITIMATE field survives untouched — this is a strip, not a rewrite.
    expect(persistedData).toMatchObject({ client: 'client-1', issueDate: '2026-09-01' });
    expect((persistedData.lines as Record<string, unknown>[])[0]).toMatchObject({
      description: 'Consulting',
      vatRate: '999-not-a-real-rate',
    });
  });

  it('phase 2 (the worker replaying an already-"sending" record): never strips — the SAME sidecars this preflight itself wrote earlier must survive the replay untouched', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument());
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
      ...sendingDocument(),
      status: 'sent',
    });

    const handler = buildRegistry().resolve('invoice', 'send');
    await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: poisonedData,
      params: {},
      currentStatus: 'sending',
    });

    // `deliver()`'s own re-resolution call (invoice-actions.ts's `deliver`) is what actually reaches
    // the tax engine on this path — it must receive the SAME sidecars unchanged, since a genuine
    // worker replay is re-submitting what THIS SAME preflight already resolved and persisted, never a
    // fresh caller-supplied body.
    const [, dataHandedToDeliverResolve] = (
      taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock
    ).mock.calls[0];
    expect(dataHandedToDeliverResolve).toHaveProperty('__crossBorderMentions');
    expect((dataHandedToDeliverResolve.lines as Record<string, unknown>[])[0]).toHaveProperty(
      '__crossBorderCategory',
      'AE',
    );

    // Phase 2 never calls upsertDocument (only a status-only write) or takes a number again — proves
    // this is genuinely the replay branch, not an accidental re-run of phase 1.
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });
});
