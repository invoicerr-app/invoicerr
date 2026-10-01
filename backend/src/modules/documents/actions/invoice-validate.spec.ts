/**
 * The "validate" action (issue #581) - numbers and locks a draft invoice WITHOUT sending it, UNLESS a
 * country channel mandate is active for this exact operation, in which case it delegates DIRECTLY to
 * `performInvoiceSend` (the same function "send" itself registers) so the mandate is never bypassed by
 * taking "Validate" instead of "Send". Same mocking style as `invoice-channel-mandate.spec.ts`: no
 * Nest, no DB - `resolveCompanyCountryCode`/`activeChannelMandateForOperation` and persistence are
 * mocked wholesale, so this file's own concern is "does invoice-actions.ts react correctly to a
 * mandate decision when VALIDATING", never the mandate's own date arithmetic (`mandate.spec.ts`'s job)
 * nor the real shipped dates (`channel-policy/registry.spec.ts`'s job).
 */
import { vi, type Mock } from 'vitest';

import * as persistence from '../persistence';
import * as takeNumber from '../numbering/take-number';
import * as countryPolicy from '../country-policy/country-policy';
import * as mandate from '../transports/channel-policy/mandate';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import { TransportRegistry } from '../transports/transport-registry';
import * as companyTransport from '../transports/company-transport';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import * as taxLoadAndResolve from '../tax/load-and-resolve';
import * as atcudIssuance from './atcud-issuance';
import * as vatCurrencyIssuance from '../vat-currency/vat-currency-issuance';
import * as applyStockOnIssuance from '../stock/apply-stock-on-issuance';

vi.mock('../persistence');
vi.mock('../transports/company-transport');
vi.mock('../country-policy/country-policy');
vi.mock('../transports/channel-policy/mandate');
vi.mock('../b2g-routing/b2g-routing');
vi.mock('../numbering/take-number');
vi.mock('../tax/load-and-resolve');

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
  issueDate: '2026-09-15',
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

function validatedDocument() {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'validated',
    data: documentData,
    createdAt: new Date(),
    updatedAt: new Date(),
    number: 1,
    displayNumber: 'INV-2026-0001',
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
    number: 1,
    displayNumber: 'INV-2026-0001',
  };
}

function buildRegistry(transportRegistry = new TransportRegistry()) {
  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });
  return registry;
}

describe('invoice "validate" (issue #581)', () => {
  afterEach(() => vi.resetAllMocks());

  beforeEach(() => {
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
    (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({
      applies: false,
      missingIdentifierSchemes: [],
    });
    vi.spyOn(atcudIssuance, 'attachAtcudToNumberedDocument').mockResolvedValue(undefined);
    vi.spyOn(vatCurrencyIssuance, 'attachVatNationalCurrencyToNumberedDocument').mockResolvedValue(undefined);
    vi.spyOn(applyStockOnIssuance, 'applyStockOnIssuance').mockResolvedValue(undefined);
  });

  it('a NON-MANDATED country (DE): numbers and locks to "validated" directly - never touches a transport', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('DE');
    (mandate.activeChannelMandateForOperation as Mock).mockReturnValue(undefined);
    (persistence.findOwnedDocument as Mock).mockResolvedValue(draftDocument());
    const numberedDocument = validatedDocument();
    (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
      document: numberedDocument,
      numbered: { number: 1, displayNumber: 'INV-2026-0001' },
    });

    const transportRegistry = new TransportRegistry();
    const send = vi.fn();
    transportRegistry.register('email', 'Email', { send });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'validate');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
      currentStatus: 'draft',
    });

    expect(send).not.toHaveBeenCalled();
    expect(companyTransport.getCompanyInvoiceTransportId).not.toHaveBeenCalled();
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'validated', number: 1 });
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      ['draft'],
      'validated',
      expect.any(Object),
    );
    expect(atcudIssuance.attachAtcudToNumberedDocument).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      { number: 1, displayNumber: 'INV-2026-0001' },
    );
    expect(applyStockOnIssuance.applyStockOnIssuance).toHaveBeenCalledWith('company-1', numberedDocument);
  });

  it('a MANDATED operation (FR domestic B2B): delegates to the real send - same preflight/deliver "send" itself uses, lands on "sending"', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateForOperation as Mock).mockReturnValue(FR_MANDATE);
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('pdp');
    (persistence.findOwnedDocument as Mock).mockResolvedValue(draftDocument());
    (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
      document: sendingDocument(),
      numbered: { number: 1, displayNumber: 'INV-2026-0001' },
    });

    const transportRegistry = new TransportRegistry();
    const fakePreflight = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ message: 'queued' });
    transportRegistry.register('pdp', 'PDP', { send, preflight: fakePreflight });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'validate');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
      currentStatus: 'draft',
    });

    // The real send preflight ran (mandate-aware transport resolution + readiness check) - proof this
    // is NOT a parallel, hand-rolled implementation that could silently drift from "send"'s own.
    expect(fakePreflight).toHaveBeenCalledWith('company-1');
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
    // The SAME primitive `runAsyncSendAction`'s own phase-1 branch uses to number a "sending" record
    // (never the "validated"-status write "validate"'s own non-mandated path uses) - proof this really
    // is the ordinary async-send numbering path, not a second, hand-rolled one.
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      ['draft', 'send_failed'],
      'sending',
      expect.any(Object),
    );
  });

  it('a MANDATED operation (FR domestic B2B) still BLOCKS when the company has not connected the mandated channel - the mandate is never bypassed by "validate"', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('FR');
    (mandate.activeChannelMandateForOperation as Mock).mockReturnValue(FR_MANDATE);
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as Mock).mockResolvedValue(draftDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: vi.fn() });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'validate');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
      currentStatus: 'draft',
    });

    await expect(action).rejects.toThrow(/"pdp" channel/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });

  it('refuses a never-saved record (no documentId) the same defensive way "send"/"cancel" already do', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('DE');
    (mandate.activeChannelMandateForOperation as Mock).mockReturnValue(undefined);
    const handler = buildRegistry().resolve('invoice', 'validate');

    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: undefined,
      data: documentData,
      params: {},
      currentStatus: undefined,
    });

    await expect(action).rejects.toThrow(/has not been saved yet/);
  });

  it('"send" accepts a VALIDATED invoice as a valid starting point, and never re-numbers it (the SEND_TRANSITIONS/additionalFromStatuses fix)', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('DE');
    (mandate.activeChannelMandateForOperation as Mock).mockReturnValue(undefined);
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('email');
    const existingValidated = {
      id: 'doc-1',
      typeId: 'invoice',
      status: 'validated',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
      number: 1,
      displayNumber: 'INV-2026-0001',
      deliveryConfirmedAt: null,
    };
    (persistence.findOwnedDocument as Mock).mockResolvedValue(existingValidated);
    (persistence.upsertDocument as Mock).mockResolvedValue({ ...existingValidated, status: 'sending' });

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: vi.fn().mockResolvedValue({ message: 'queued' }) });
    const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');

    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
      currentStatus: 'validated',
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
    // The already-numbered record was accepted as a "sending" starting point via the ordinary
    // compare-and-swap, never the atomic-numbering primitive - a record that reaches here already
    // numbered can never legitimately re-win a number.
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'doc-1',
      'sending',
      expect.any(Object),
      ['draft', 'send_failed', 'validated'],
    );
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });
});
