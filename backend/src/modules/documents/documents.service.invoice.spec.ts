import { BadRequestException, ConflictException, NotImplementedException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerInvoiceActions } from './actions/invoice-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as takeNumber from './numbering/take-number';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { computeSettlement } from './settlement/compute-settlement';
import * as settlementCredits from './settlement/credits';
import * as settlementPayments from './settlement/payments';
import * as taxLoadAndResolve from './tax/load-and-resolve';
import { resolveInvoiceCrossBorderTax } from './tax/resolve-invoice-tax';
import { computeDocumentTotals } from './totals/compute-totals';
import * as companyTransport from './transports/company-transport';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
jest.mock('./transports/company-transport');
// "record-payment" (invoice-actions.ts) writes through settlement/payments.ts, which reaches Prisma
// directly — mocked here the same reason `./numbering/take-number` already is just below: it bypasses
// the mocked `./persistence` entirely, so a test that wants to observe or control it must mock this
// module too, not assume `./persistence`'s mock covers it.
jest.mock('./settlement/payments');
// Same reason, same discipline, for CREDITS (item 8, "le lettrage") — `resolveCreditsForDocument`
// (settlement/credits.ts) also reaches Prisma directly. Defaulted to "no credits" in `beforeEach`
// below so every pre-existing test in this file keeps meaning exactly what it always did; the
// dedicated credits describe block overrides it to prove the balance actually changes.
jest.mock('./settlement/credits');
// Root TODO item 16 ("transfrontalier") — `resolveInvoiceCrossBorderTaxForCompany` (tax/load-and-
// resolve.ts) ALSO reaches Prisma directly (the seller/buyer country + buyer VAT lookup), same
// reason, same discipline as every mock above. Defaulted to a permissive PASS-THROUGH in
// `beforeEach` below (this file's own fixtures never set up a real client/company row, so the real
// function would otherwise resolve an unknown buyer country and block every "send" — a concern this
// file does not test; that behaviour is proven directly in `tax/resolve-invoice-tax.spec.ts` and
// `tax/cross-border-formats.spec.ts` instead).
jest.mock('./tax/load-and-resolve');
// See documents.service.spec.ts's own comment on this mock — the real invoice descriptor now
// declares `numbering: { onEnterStatus: 'sent' }` too (invoice.descriptor.ts), and
// `takeDocumentNumberForTransition` reaches Prisma directly, bypassing the mocked `./persistence`.
jest.mock('./numbering/take-number');
// See documents.service.spec.ts's own comment on this mock — the real decision code is proven
// elsewhere (country-policy/country-policy.spec.ts, documents.service.country-policy.spec.ts). The
// default "allowed" is (re-)installed in `beforeEach` below, not just here, since
// `afterEach(() => jest.resetAllMocks())` would otherwise wipe it after the first test.
jest.mock('./country-policy/country-policy');

/**
 * Same wiring discipline as documents.service.spec.ts's quote coverage, applied to the invoice — the
 * SECOND document type written entirely as a descriptor (invoice.descriptor.ts). What this file
 * exists to prove is not "does DocumentsService work" (already proven for the quote) but "does the
 * exact same generic machinery work UNMODIFIED for an independently-declared second type": no branch
 * of DocumentsService, validateAgainstDescriptor, or ActionRegistry knows the word "invoice" — it is
 * only ever data these registries were handed.
 *
 * The invoice's "send" is deliberately NOT the quote's mechanism (see actions/invoice-actions.ts and
 * actions/send-divergence.spec.ts) — the transport is read from `Company.invoiceTransportId`
 * (transports/company-transport.ts), mocked here the same way persistence.ts already is.
 */
function buildService(transportRegistry: TransportRegistry = new TransportRegistry()) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  // "send" is asynchronous (TODO.md item 22, actions/async-send.ts) — a fake dispatcher, no BullMQ,
  // no Nest, no Redis needed.
  const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

  const actionRegistry = new ActionRegistry();
  registerInvoiceActions(actionRegistry, { transportRegistry, queueDispatcher });
  // "record-payment" IS registered (invoice-actions.ts) — its own describe block below. "export-
  // accounting" is NOT, on purpose — see invoice.descriptor.ts.

  const actionExtensionRegistry = new ActionExtensionRegistry();
  const referenceRegistry = new EntityReferenceRegistry();

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    actionExtensionRegistry,
    referenceRegistry,
    transportRegistry,
    new ContributionRegistry(),
  );
  return { service, queueDispatcher };
}

const validInvoiceData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  dueDate: '2026-01-31',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unit: 'unit', unitPrice: 9.9, vatRate: '20' }],
};

const noDueDateInvoiceData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unit: 'unit', unitPrice: 9.9, vatRate: '20' }],
};

describe('DocumentsService — the invoice type, the SECOND descriptor-only type', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);
    (settlementCredits.resolveCreditsForDocument as jest.Mock).mockResolvedValue({
      credits: [],
      warnings: [],
    });
    (settlementCredits.toSettlementCreditInputs as jest.Mock).mockImplementation((credits) =>
      credits.map((c: { id: string; amountMinor: number }) => ({ id: c.id, amountMinor: c.amountMinor })),
    );
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
  });
  afterEach(() => jest.resetAllMocks());

  it('is registered', () => {
    expect(buildService().service.listTypes()).toEqual([{ id: 'invoice', label: 'Invoice' }]);
  });

  it('its fields validate: a complete invoice is accepted', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const result = await service.runAction('company-1', 'invoice', 'save-draft', {
      data: validInvoiceData,
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'doc-1', status: 'draft' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      undefined,
      'draft',
      validInvoiceData,
    );
  });

  it('its fields validate: an empty invoice is rejected before ever touching persistence', async () => {
    await expect(
      buildService().service.runAction('company-1', 'invoice', 'save-draft', { data: {} }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // The array-ROW SUBFIELD case of the SAME `min`/`max` enforcement field-kinds.spec.ts already
  // proves for a top-level field: validateAgainstDescriptor recurses into a row with the exact same
  // FieldKindRegistry, so a line's own `discountPercent` (0..100 — invoice.descriptor.ts) is checked
  // no less strictly than a document-level field would be. A discount of -20 that silently INCREASED
  // the price (via `1 - (-20)/100 = 1.2`, compute-totals.ts) would be exactly this validator's job to
  // refuse before that arithmetic ever runs.
  it("a line's discountPercent outside 0..100 is rejected — a -20% cannot slip through as a price increase", async () => {
    const negativeDiscount = {
      ...validInvoiceData,
      lines: [{ ...validInvoiceData.lines[0], discountPercent: -20 }],
    };
    await expect(
      buildService().service.runAction('company-1', 'invoice', 'save-draft', { data: negativeDiscount }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();

    const tooLargeDiscount = {
      ...validInvoiceData,
      lines: [{ ...validInvoiceData.lines[0], discountPercent: 120 }],
    };
    await expect(
      buildService().service.runAction('company-1', 'invoice', 'save-draft', { data: tooLargeDiscount }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('accepts a valid in-range discountPercent on a line, and 0/absent are equally fine', async () => {
    const withDiscount = {
      ...validInvoiceData,
      lines: [{ ...validInvoiceData.lines[0], discountPercent: 50 }],
    };
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: withDiscount,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await buildService().service.runAction('company-1', 'invoice', 'save-draft', {
      data: withDiscount,
    });
    expect(result.changed).toBe(true);
  });

  // The one requiredness difference from the quote (quote.descriptor.ts's dueDate is optional) —
  // same 'date' kind, no new kind needed, just a different `required` on this descriptor. The
  // per-field message lives in the exception's response body (`errors`), not in `.message` itself —
  // see documents.service.ts's runAction, which always throws the generic "Invalid document data"
  // as the top-level message and carries the per-field detail alongside it.
  it('requires a due date — unlike the quote, where it is optional', async () => {
    const { service } = buildService();
    expect.assertions(2);

    try {
      await service.runAction('company-1', 'invoice', 'save-draft', { data: noDueDateInvoiceData });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        errors: { key: string; message: string }[];
      };
      expect(response.errors).toEqual(
        expect.arrayContaining([{ key: 'dueDate', message: '"Due date" is required.' }]),
      );
    }
  });

  describe('"origin" — a MULTI-TARGET reference (quote OR invoice), unlike "client"', () => {
    it('accepts an origin pointing at a quote', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: { entity: 'quote', id: 'quote-doc-1' } };
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: dataWithOrigin,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction('company-1', 'invoice', 'save-draft', {
        data: dataWithOrigin,
      });

      expect(result.changed).toBe(true);
    });

    it('accepts an origin pointing at ANOTHER invoice — the second declared target', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: { entity: 'invoice', id: 'invoice-doc-0' } };
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: dataWithOrigin,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction('company-1', 'invoice', 'save-draft', {
        data: dataWithOrigin,
      });

      expect(result.changed).toBe(true);
    });

    it('rejects an origin naming an entity that was never declared as a target', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: { entity: 'client', id: 'client-1' } };

      expect.assertions(3);
      try {
        await buildService().service.runAction('company-1', 'invoice', 'save-draft', {
          data: dataWithOrigin,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          errors: { key: string; message: string }[];
        };
        expect(response.errors).toContainEqual(
          expect.objectContaining({ key: 'origin', message: expect.stringMatching(/quote, invoice/) }),
        );
      }
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('rejects the OLD bare-id shape — a plain string is no longer enough once more than one target is possible', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: 'quote-doc-1' };

      await expect(
        buildService().service.runAction('company-1', 'invoice', 'save-draft', { data: dataWithOrigin }),
      ).rejects.toThrow(/Invalid document data/);
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });
  });

  // The behaviour the task explicitly asks to keep proven on THIS second type, not only on the
  // quote's "convert-to-invoice": a real, declared action on the real invoice descriptor, genuinely
  // never registered (invoice-actions.ts), is blocked with a clear 501 — never a silent no-op. This
  // used to be "record-payment"'s role; it moved to "export-accounting" the day "record-payment" got
  // a real implementation (see invoice.descriptor.ts's own header) — the live case this proves the
  // mechanism against must always be a genuinely unregistered action, never a stale example.
  it('blocks "export-accounting" — declared, no implementation registered — with a clear 501', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sent',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const action = service.runAction('company-1', 'invoice', 'export-accounting', {
      documentId: 'doc-1',
      data: validInvoiceData,
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/no registered implementation/);
  });

  it('refuses "record-payment" for a status outside its availableWhen list — 409, not a silent bypass', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    await expect(
      service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('"record-payment" — implemented: validates, persists, and hands back the balance', () => {
    const sentInvoice = {
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sent',
      data: validInvoiceData, // currency: 'EUR'
      createdAt: new Date(),
      updatedAt: new Date(),
      // Already numbered — a "sent" invoice always is (numbering: { onEnterStatus: 'sent' }). Set
      // here so runAction's own numbering re-check (documents.service.ts) is a no-op for these
      // tests, which are about the payment mechanism, not numbering.
      number: 1,
      displayNumber: 'INV-2026-0001',
    };

    beforeEach(() => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sentInvoice);
      (settlementPayments.recordPayment as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        documentId: 'doc-1',
        amountMinor: 0,
        currency: 'EUR',
        method: null,
        paidAt: new Date('2026-08-30'),
        note: null,
        createdAt: new Date('2026-08-30'),
      });
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([]);
    });

    // validInvoiceData's own lines total 2 * 9.9 = 19.8 EUR net, +20% VAT = 23.76 EUR gross —
    // 2376 minor units. Every test below that needs the gross total spells this out rather than
    // re-deriving it, so a change to compute-totals.ts's own rounding would fail LOUDLY here instead
    // of silently shifting what "partial" means.
    const GROSS_MINOR = 2376;

    it('records a partial payment, converts to minor units with the DOCUMENT currency, and states the new balance', async () => {
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([
        { id: 'payment-1', documentId: 'doc-1', amountMinor: 1000, currency: 'EUR' },
      ]);

      const { service } = buildService();
      const result = await service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
        params: { amount: 10, currency: 'EUR', paidAt: '2026-08-30', method: 'bank_transfer' },
      });

      expect(settlementPayments.recordPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'company-1',
          documentId: 'doc-1',
          amountMinor: 1000, // 10 EUR * 100 (2 decimals)
          currency: 'EUR',
          method: 'bank_transfer',
        }),
      );
      expect(result.changed).toBe(true);
      expect(result.document).toEqual(sentInvoice);
      // The result SAYS the new balance — outstanding is GROSS_MINOR - 1000 = 1376 -> 13.76 EUR.
      expect(result.message).toMatch(/13\.76 EUR/);
      expect(result.message).toMatch(/outstanding/i);
    });

    it("converts to minor units using the CURRENCY's OWN decimals — JPY has none, not two", async () => {
      const jpyInvoice = { ...sentInvoice, data: { ...validInvoiceData, currency: 'JPY' } };
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(jpyInvoice);

      const { service } = buildService();
      await service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: jpyInvoice.data,
        params: { amount: 500, currency: 'JPY', paidAt: '2026-08-30' },
      });

      expect(settlementPayments.recordPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 500, currency: 'JPY' }), // NOT 50000
      );
    });

    it("refuses a payment currency that does not match the document's own — no silent conversion", async () => {
      const { service } = buildService();
      const action = service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
        params: { amount: 10, currency: 'USD', paidAt: '2026-08-30' },
      });

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow(/does not match this invoice's own currency/);
      expect(settlementPayments.recordPayment).not.toHaveBeenCalled();
    });

    it('refuses an amount that is not strictly positive', async () => {
      const { service } = buildService();
      const zero = service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
        params: { amount: 0, currency: 'EUR', paidAt: '2026-08-30' },
      });
      await expect(zero).rejects.toBeInstanceOf(BadRequestException);
      await expect(zero).rejects.toThrow(/greater than zero/);
      expect(settlementPayments.recordPayment).not.toHaveBeenCalled();
    });

    it('an EXACT full payment settles the invoice — the result says so, never "outstanding"', async () => {
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([
        { id: 'payment-1', documentId: 'doc-1', amountMinor: GROSS_MINOR, currency: 'EUR' },
      ]);

      const { service } = buildService();
      const result = await service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
        params: { amount: 23.76, currency: 'EUR', paidAt: '2026-08-30' },
      });

      expect(result.message).toMatch(/fully paid/i);
      expect(result.message).not.toMatch(/outstanding/i);
    });

    it('a PRE-EXISTING credit is folded into the balance THIS message states — never contradicting a follow-up read of the settlement screen', async () => {
      // The invoice (GROSS_MINOR = 2376) was already credited 2000 minor before this payment —
      // recording a further 376 must be exactly enough to settle it.
      (settlementCredits.resolveCreditsForDocument as jest.Mock).mockResolvedValue({
        credits: [{ id: 'cn-1', displayNumber: null, amountMinor: 2000, currency: 'EUR' }],
        warnings: [],
      });
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([
        { id: 'payment-1', documentId: 'doc-1', amountMinor: GROSS_MINOR - 2000, currency: 'EUR' },
      ]);

      const { service } = buildService();
      const result = await service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
        params: { amount: 3.76, currency: 'EUR', paidAt: '2026-08-30' },
      });

      expect(result.message).toMatch(/fully paid/i);
      expect(result.message).not.toMatch(/outstanding/i);
      expect(settlementCredits.resolveCreditsForDocument).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        expect.anything(),
        validInvoiceData,
      );
    });
  });

  describe('"send" — reads the company\'s OWN transport configuration, not the quote\'s email mechanism', () => {
    it('blocks with a 501 when the company has not configured a transport', async () => {
      (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue(null);
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const action = service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      await expect(action).rejects.toBeInstanceOf(NotImplementedException);
      await expect(action).rejects.toThrow(/no transport is configured/i);
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('phase 1: with a transport configured, persists "sending" and ENQUEUES — never calls the transport synchronously', async () => {
      (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
      const transportRegistry = new TransportRegistry();
      const fakeTransport = { send: jest.fn() };
      transportRegistry.register('email', 'Email', fakeTransport);

      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service, queueDispatcher } = buildService(transportRegistry);
      const result = await service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      expect(result.changed).toBe(true);
      expect(result.document).toMatchObject({ id: 'doc-1', status: 'sending' });
      expect(fakeTransport.send).not.toHaveBeenCalled();
      expect(queueDispatcher.enqueueAction).toHaveBeenCalledWith({
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        actionId: 'send',
        payload: { data: validInvoiceData, params: {} },
      });
    });

    it('phase 2 (the worker\'s replay, record already "sending"): delivers through the configured transport and marks the document "sent"', async () => {
      (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
      const transportRegistry = new TransportRegistry();
      const fakeTransport = {
        send: jest.fn().mockResolvedValue({ message: 'Invoice sent to client-1@example.com.' }),
      };
      transportRegistry.register('email', 'Email', fakeTransport);

      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service, queueDispatcher } = buildService(transportRegistry);
      const result = await service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      expect(result.changed).toBe(true);
      expect(result.document).toMatchObject({ id: 'doc-1', status: 'sent' });
      expect(result.message).toBe('Invoice sent to client-1@example.com.');
      expect(fakeTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-1', label: 'Invoice' }),
      );
      expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
    });

    it('phase 2: a transport that DISAPPEARED between enqueue and replay still 501s — never a silent skip', async () => {
      // Re-resolved lazily inside `deliver()` (invoice-actions.ts's own comment on why) — a company
      // could reconfigure (or lose) its transport between the first "send" call and the worker's
      // later replay; this must refuse exactly as loudly as the preflight already does.
      (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue(null);
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const action = service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      await expect(action).rejects.toBeInstanceOf(NotImplementedException);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('declares no params — there is no user-typed recipient, unlike the quote\'s "send"', () => {
      const descriptor = buildService().service.getType('invoice');
      const sendAction = descriptor.actions.find((a) => a.id === 'send');
      expect(sendAction?.params ?? []).toEqual([]);
    });
  });

  /**
   * Root TODO item 16, the SURGICAL FIX — the bug this task exists to close: `resolveInvoiceCrossBorderTax`
   * ("tax/resolve-invoice-tax.ts") was only ever applied at `deliver()` (what the client received, what
   * the archive kept), never to the STORED `instance.data` a "sending"/"sent" record actually carries —
   * so `computeDocumentTotals`, the settlement balance, and the dashboard's own "pending" total all kept
   * reading the user's raw, unresolved 20% instead of the resolved 0% reverse-charge. Fixed by having the
   * preflight's OWN resolution flow into the "sending" write (see async-send.ts's `preflight` header and
   * invoice-actions.ts's `runInvoiceCrossBorderTaxPreflight`) instead of being computed and discarded.
   *
   * `resolveInvoiceCrossBorderTaxForCompany` (tax/load-and-resolve.ts) is mocked here exactly like
   * every other test in this file (it reaches Prisma directly) — but its mock implementation calls the
   * REAL, pure `resolveInvoiceCrossBorderTax` underneath, so this proves the actual FR→DE reverse-charge
   * arithmetic, not a hand-rolled fixture standing in for it.
   */
  describe('"send" — root TODO item 16: phase 1 persists the RESOLVED cross-border data, never the raw draft', () => {
    // 1 line, 12 000 EUR net, SERVICES, FR seller → DE buyer with a valid intra-Community VAT number:
    // reverse charge (art. 196), category AE, 0% — resolved GROSS must be 12 000.00 EUR (1 200 000
    // minor units), never the 14 400.00 EUR (1 440 000 minor) the user's own drafted 20% would total.
    const frDeB2bInvoiceData = {
      client: 'client-1',
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      currency: 'EUR',
      lines: [
        {
          description: 'Conseil stratégique',
          quantity: 1,
          unit: 'day',
          unitPrice: 12000,
          vatRate: '20', // the user's own draft-time entry — MUST NOT survive into "sending"
          supplyType: 'SERVICES',
        },
      ],
    };

    // Same as the "send" describe's own "phase 1: with a transport configured..." test above — a
    // real transport must be REGISTERED (not just returned by `getCompanyInvoiceTransportId`),
    // otherwise `resolveInvoiceTransport` (invoice-actions.ts) 501s before the preflight this
    // describe cares about ever gets a chance to run.
    function buildEmailTransportRegistry(): TransportRegistry {
      const transportRegistry = new TransportRegistry();
      transportRegistry.register('email', 'Email', { send: jest.fn() });
      return transportRegistry;
    }

    beforeEach(() => {
      (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
      (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
        (_companyId: string, data: Record<string, unknown>) =>
          Promise.resolve(
            resolveInvoiceCrossBorderTax({
              seller: { countryCode: 'FR' },
              buyer: { countryCode: 'DE' },
              buyerVat: { value: 'DE136695976', validationStatus: 'VALID' }, // checksum-valid, see vat-syntax.spec.ts
              data,
            }),
          ),
      );
    });

    it('THE DEFECT, closed: instance.data persisted at "sending" carries the RESOLVED rate (0%, AE) — computeDocumentTotals on the STORED data is 12 000.00 EUR, never 14 400.00 EUR', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: frDeB2bInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockImplementation(
        async (_companyId, _typeId, _documentId, status, data) => ({
          id: 'doc-1',
          typeId: 'invoice',
          status,
          data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const { service } = buildService(buildEmailTransportRegistry());
      await service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: frDeB2bInvoiceData,
      });

      expect(persistence.upsertDocument).toHaveBeenCalledTimes(1);
      const [, , , persistedStatus, persistedData] = (persistence.upsertDocument as jest.Mock).mock
        .calls[0] as [string, string, string, string, Record<string, unknown>];
      expect(persistedStatus).toBe('sending');

      const persistedLine = (persistedData.lines as Record<string, unknown>[])[0];
      expect(persistedLine.vatRate).toBe('0'); // never the drafted "20"
      expect(persistedLine.__crossBorderCategory).toBe('AE');

      // The number this task's own bug report names: the STORED document's own totals, computed the
      // exact same way documents.service.ts's own `computeTotals` endpoint and the settlement screen
      // do, off the exact same descriptor.
      const totals = computeDocumentTotals(buildInvoiceDescriptor(), persistedData);
      expect(totals.grossMinor).toBe(1_200_000); // 12 000.00 EUR
      expect(totals.grossMinor).not.toBe(1_440_000); // NEVER 14 400.00 EUR (20% of the raw draft)
    });

    it('a domestic FR→FR invoice is UNCHANGED: still persists the raw, user-typed rate (the resolver never touches it)', async () => {
      // Overrides this describe's own FR→DE mock — proving the domestic path independently of the
      // FR→DE fixture, same discipline resolve-invoice-tax.spec.ts's own domestic tests hold.
      const domesticData = validInvoiceData;
      (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as jest.Mock).mockImplementation(
        (_companyId: string, data: Record<string, unknown>) =>
          Promise.resolve(
            resolveInvoiceCrossBorderTax({
              seller: { countryCode: 'FR' },
              buyer: { countryCode: 'FR' },
              data,
            }),
          ),
      );
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: domesticData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockImplementation(
        async (_companyId, _typeId, _documentId, status, data) => ({
          id: 'doc-1',
          typeId: 'invoice',
          status,
          data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const { service } = buildService(buildEmailTransportRegistry());
      await service.runAction('company-1', 'invoice', 'send', { documentId: 'doc-1', data: domesticData });

      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'sending',
        domesticData, // untouched — still 20%, the rate the user actually typed
      );
    });

    it('a "send_failed" retry re-submits the ALREADY-RESOLVED data (what the screen re-sends) and stays stable — idempotent, not corrupted further', async () => {
      // The document already went through phase 1 once: it now holds the RESOLVED treatment, exactly
      // what document-list.tsx's own `getData()` would hand back for a row acting on this instance —
      // computed by actually resolving the draft once (the real resolver, mentions/exemption reason
      // included), never a hand-rolled approximation of what it produces.
      const alreadyResolvedData = resolveInvoiceCrossBorderTax({
        seller: { countryCode: 'FR' },
        buyer: { countryCode: 'DE' },
        buyerVat: { value: 'DE136695976', validationStatus: 'VALID' },
        data: frDeB2bInvoiceData,
      }).data;
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'send_failed', // NOT "sending" — a fresh phase-1 call, exactly like a first send
        data: alreadyResolvedData,
        createdAt: new Date(),
        updatedAt: new Date(),
        number: 1,
        displayNumber: 'INV-2026-0001',
      });
      (persistence.upsertDocument as jest.Mock).mockImplementation(
        async (_companyId, _typeId, _documentId, status, data) => ({
          id: 'doc-1',
          typeId: 'invoice',
          status,
          data,
          number: 1,
          displayNumber: 'INV-2026-0001',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const { service } = buildService(buildEmailTransportRegistry());
      await service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: alreadyResolvedData,
      });

      const [, , , , persistedData] = (persistence.upsertDocument as jest.Mock).mock.calls[0] as [
        string,
        string,
        string,
        string,
        Record<string, unknown>,
      ];
      // Stable: re-resolving the already-resolved line reproduces it exactly, never a second rewrite
      // that drifts (e.g. onto a different category) or corrupts the sidecar keys.
      expect(persistedData).toEqual(alreadyResolvedData);
    });

    it('THE SETTLEMENT PROOF: a 12 000 EUR payment against the STORED (resolved) totals settles the invoice — never "partially paid" against the raw 14 400 EUR the user typed', () => {
      const resolvedData = {
        ...frDeB2bInvoiceData,
        lines: [{ ...frDeB2bInvoiceData.lines[0], vatRate: '0', __crossBorderCategory: 'AE' }],
      };
      const totals = computeDocumentTotals(buildInvoiceDescriptor(), resolvedData);
      expect(totals.grossMinor).toBe(1_200_000);

      const settlement = computeSettlement(totals.grossMinor, [{ amountMinor: 1_200_000 }]);
      expect(settlement.settled).toBe(true);
      expect(settlement.outstandingMinor).toBe(0);

      // Against the WRONG (unresolved, 20%) total this task's bug report names, the SAME 12 000 EUR
      // payment would have wrongly read as a partial payment — spelled out here so a future change
      // that reintroduces the defect fails LOUDLY on this exact contrast, not silently.
      const wrongTotals = computeDocumentTotals(buildInvoiceDescriptor(), frDeB2bInvoiceData);
      expect(wrongTotals.grossMinor).toBe(1_440_000);
      const wrongSettlement = computeSettlement(wrongTotals.grossMinor, [{ amountMinor: 1_200_000 }]);
      expect(wrongSettlement.settled).toBe(false);
      expect(wrongSettlement.outstandingMinor).toBe(240_000); // the phantom "still owed" 2 400 EUR
    });

    it('"save-draft" NEVER resolves cross-border tax — a draft stays exactly what the user typed', async () => {
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: frDeB2bInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      await service.runAction('company-1', 'invoice', 'save-draft', { data: frDeB2bInvoiceData });

      expect(taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        undefined,
        'draft',
        frDeB2bInvoiceData, // still 20% — a draft is never rewritten
      );
    });
  });
});
