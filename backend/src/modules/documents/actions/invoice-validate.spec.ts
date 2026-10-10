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
import * as companyTransport from '../transports/company-transport';
import { TransportRegistry } from '../transports/transport-registry';
import {
  FR_MANDATE,
  NUMBERED,
  invoiceData,
  invoiceRow,
  mockAtomicNumbering,
  mockCompany,
  mockNeutralIssuanceContext,
  runInvoiceAction,
} from '../__tests__/invoice-action-fixtures';
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

const documentData = invoiceData('2026-09-15');

const draftDocument = () => invoiceRow(documentData, 'draft');
const validatedDocument = () => invoiceRow(documentData, 'validated', NUMBERED);
const sendingDocument = () => invoiceRow(documentData, 'sending', NUMBERED);

describe('invoice "validate" (issue #581)', () => {
  afterEach(() => vi.resetAllMocks());

  beforeEach(() => {
    mockNeutralIssuanceContext();
    vi.spyOn(atcudIssuance, 'attachAtcudToNumberedDocument').mockResolvedValue(undefined);
    vi.spyOn(vatCurrencyIssuance, 'attachVatNationalCurrencyToNumberedDocument').mockResolvedValue(undefined);
    vi.spyOn(applyStockOnIssuance, 'applyStockOnIssuance').mockResolvedValue(undefined);
  });

  it('a NON-MANDATED country (DE): numbers and locks to "validated" directly - never touches a transport', async () => {
    mockCompany({ countryCode: 'DE', mandate: undefined, document: draftDocument() });
    const numberedDocument = validatedDocument();
    mockAtomicNumbering(numberedDocument);

    const transportRegistry = new TransportRegistry();
    const send = vi.fn();
    transportRegistry.register('email', 'Email', { send });

    const result = await runInvoiceAction(
      'validate',
      documentData,
      { currentStatus: 'draft' },
      transportRegistry,
    );

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
      NUMBERED,
    );
    expect(applyStockOnIssuance.applyStockOnIssuance).toHaveBeenCalledWith('company-1', numberedDocument);
  });

  it('a MANDATED operation (FR domestic B2B): delegates to the real send - same preflight/deliver "send" itself uses, lands on "sending"', async () => {
    mockCompany({ countryCode: 'FR', mandate: FR_MANDATE, transportId: 'pdp', document: draftDocument() });
    mockAtomicNumbering(sendingDocument());

    const transportRegistry = new TransportRegistry();
    const fakePreflight = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ message: 'queued' });
    transportRegistry.register('pdp', 'PDP', { send, preflight: fakePreflight });

    const result = await runInvoiceAction(
      'validate',
      documentData,
      { currentStatus: 'draft' },
      transportRegistry,
    );

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
    mockCompany({ countryCode: 'FR', mandate: FR_MANDATE, transportId: 'email', document: draftDocument() });

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: vi.fn() });
    const action = runInvoiceAction('validate', documentData, { currentStatus: 'draft' }, transportRegistry);

    await expect(action).rejects.toThrow(/"pdp" channel/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });

  it('refuses a never-saved record (no documentId) the same defensive way "send"/"cancel" already do', async () => {
    mockCompany({ countryCode: 'DE', mandate: undefined });

    const action = runInvoiceAction('validate', documentData, {
      documentId: undefined,
      currentStatus: undefined,
    });

    await expect(action).rejects.toThrow(/has not been saved yet/);
  });

  it('"send" accepts a VALIDATED invoice as a valid starting point, and never re-numbers it (the SEND_TRANSITIONS/additionalFromStatuses fix)', async () => {
    const existingValidated = { ...validatedDocument(), deliveryConfirmedAt: null };
    mockCompany({ countryCode: 'DE', mandate: undefined, transportId: 'email', document: existingValidated });
    (persistence.upsertDocument as Mock).mockResolvedValue({ ...existingValidated, status: 'sending' });

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: vi.fn().mockResolvedValue({ message: 'queued' }) });

    const result = await runInvoiceAction(
      'send',
      documentData,
      { currentStatus: 'validated' },
      transportRegistry,
    );

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
