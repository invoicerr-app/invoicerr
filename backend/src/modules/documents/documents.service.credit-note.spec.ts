import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerCreditNoteActions } from './actions/credit-note-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildCreditNoteDescriptor } from './descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { ROW_ID_KEY } from './row-selection/row-selection';
import * as settlementCredits from './settlement/credits';
import * as settlementPayments from './settlement/payments';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// See documents.service.spec.ts's own comment on this mock — the real decision code is proven
// elsewhere (country-policy/country-policy.spec.ts, documents.service.country-policy.spec.ts). The
// default "allowed" is (re-)installed in `beforeEach` below, not just here, since
// `afterEach(() => jest.resetAllMocks())` would otherwise wipe it after the first test.
jest.mock('./country-policy/country-policy');
// TODO_PRODUIT.md T3 — "send" (phase 2) now checks whether IT is the write that settles the invoice
// it corrects (credit-note-actions.ts's `checkAndEmitInvoiceSettledFromCreditNote`), which reaches
// Prisma directly through `listPayments`/`listCreditNotes` — same "mock what bypasses the mocked
// ./persistence" discipline documents.service.invoice.spec.ts already holds for the identical
// concern. PARTIAL mocks (`jest.requireActual` for everything else): `creditsForInvoiceFromNotes`/
// `toSettlementCreditInputs`/`toSettlementPaymentInputs` are PURE, DB-free, and already proven by
// their own spec files — re-mocking them here would mean hand-rolling a fake that has to agree with
// the real arithmetic, which is exactly the kind of drift a partial mock avoids. Defaulted in
// `beforeEach` below to "no payments, no OTHER credit notes" so every pre-existing test in this file
// (none of which cares about settlement at all) keeps meaning exactly what it always did; the
// dedicated "DOCUMENT_SETTLED" describe block overrides `listPayments`/`listCreditNotes` to prove the
// crossing.
jest.mock('./settlement/payments', () => ({
  ...jest.requireActual('./settlement/payments'),
  listPayments: jest.fn(),
}));
jest.mock('./settlement/credits', () => ({
  ...jest.requireActual('./settlement/credits'),
  listCreditNotes: jest.fn(),
}));

/**
 * The THIRD document type written entirely as a descriptor (credit-note.descriptor.ts) — this is
 * where the "a document type is a descriptor" claim gets its strongest test, because unlike the
 * invoice (which mostly restates the quote's fields), the credit note is a genuinely different shape
 * (it references an INVOICE, not a client-plus-lines-from-scratch document with no upstream link).
 * Same wiring discipline as the other two: real descriptor, real core field kinds, real action
 * registration, only persistence.ts mocked.
 *
 * The `invoice` type is ALSO registered here (unlike the other two files, which each register only
 * their own type) — the credit note's `correctedLines` (kind: 'rowSelection') declares
 * `sourceEntity: 'invoice'`, and resolving it needs that type's own descriptor to exist in the
 * registry, exactly the way it would in the real DocumentsModule wiring.
 */
/**
 * `webhooks` (TODO_PRODUIT.md T2bis) is OPTIONAL, defaulted to `undefined` — every pre-existing test
 * in this file constructs `buildService()` with no opinion on webhooks and must keep meaning exactly
 * what it always did. Only the dedicated "DOCUMENT_SENT" test below passes one — proving the type
 * T2 deliberately left webhook-less (no `CREDIT_NOTE_SENT` ever existed) gets one for free the moment
 * the vocabulary stops being per-type (credit-note-actions.ts's own header).
 */
function buildService(webhooks?: { dispatch: jest.Mock }) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildCreditNoteDescriptor());
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  // "send" is asynchronous (TODO.md item 22, actions/async-send.ts) for every type that has one,
  // credit-note included — see credit-note.descriptor.ts's own header on why, even though this
  // type's own `deliver` does nothing at all. A fake dispatcher: no BullMQ, no Nest, no Redis.
  const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

  const actionRegistry = new ActionRegistry();
  registerCreditNoteActions(actionRegistry, { queueDispatcher, webhooks });

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
  return { service, queueDispatcher };
}

/** A minimal, already-saved invoice a credit note can correct — its "lines" carry the stable
 *  ROW_ID_KEY a real invoice would only have once it has been saved through runAction at least once
 *  since this kind shipped (row-selection.ts's stampRowIds). Built by hand here since persistence is
 *  mocked, not derived from a real save — the stamping mechanism itself is row-selection.spec.ts's job. */
function invoiceDocument(id: string, lineRowIds: string[]) {
  return {
    id,
    typeId: 'invoice',
    status: 'draft',
    data: {
      client: 'client-1',
      issueDate: '2026-01-15',
      dueDate: '2026-02-15',
      currency: 'EUR',
      lines: lineRowIds.map((rowId) => ({
        [ROW_ID_KEY]: rowId,
        description: 'Widget',
        quantity: 1,
        unitPrice: 9.9,
      })),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const validCreditNoteData = {
  invoice: 'invoice-doc-1',
  issueDate: '2026-02-01',
  currency: 'EUR',
  correctedLines: ['line-1'],
};

describe('DocumentsService — the credit note type, the THIRD descriptor-only type', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    // TODO_PRODUIT.md T3 — see this file's own top-of-file comment on the two partial mocks: no
    // payments, no OTHER credit notes, by default. A test that cares about settlement overrides these.
    (settlementPayments.listPayments as jest.Mock).mockResolvedValue([]);
    (settlementCredits.listCreditNotes as jest.Mock).mockResolvedValue([]);
  });
  afterEach(() => jest.resetAllMocks());

  it('is registered', () => {
    expect(buildService().service.listTypes()).toEqual(
      expect.arrayContaining([{ id: 'credit-note', label: 'Credit note' }]),
    );
  });

  it('declares exactly three actions: "save-draft", "send", and "share-link" — nothing more', () => {
    // "share-link" (root TODO item 24) joined "save-draft"/"send" here — see
    // credit-note.descriptor.ts's own comment on that action for why it is declared at all despite
    // never running through ActionRegistry.
    const descriptor = buildService().service.getType('credit-note');
    expect(descriptor.actions.map((a) => a.id)).toEqual(['save-draft', 'send', 'share-link']);
  });

  it('"send" (phase 1): draft -> sending, enqueued — no params, no email, no delivery yet', async () => {
    // A single shared mock, exploited the same way the rest of this file already does: runAction's
    // own status gate-check, the row-selection cross-check against the referenced invoice, AND
    // async-send.ts's own re-read of the credit note ALL call `findOwnedDocument` — none of them
    // reads `.typeId` off what comes back, only `.status`/`.data`, so one fixture (status "draft")
    // serves every purpose here, exactly like the pre-existing coverage already relied on.
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-doc-1', ['line-1']),
    );
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'sending',
      data: validCreditNoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service, queueDispatcher } = buildService();
    const result = await service.runAction('company-1', 'credit-note', 'send', {
      documentId: 'cn-1',
      data: validCreditNoteData,
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'cn-1', status: 'sending' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'credit-note',
      'cn-1',
      'sending',
      validCreditNoteData,
    );
    expect(queueDispatcher.enqueueAction).toHaveBeenCalledWith({
      companyId: 'company-1',
      typeId: 'credit-note',
      documentId: 'cn-1',
      actionId: 'send',
      payload: { data: validCreditNoteData, params: {} },
    });
  });

  it('"send" (phase 2 — the worker\'s replay): "sending" -> "sent", nothing to deliver, never re-enqueued', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      ...invoiceDocument('invoice-doc-1', ['line-1']),
      status: 'sending',
    });
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'sent',
      data: validCreditNoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service, queueDispatcher } = buildService();
    const result = await service.runAction('company-1', 'credit-note', 'send', {
      documentId: 'cn-1',
      data: validCreditNoteData,
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'cn-1', status: 'sent' });
    // `null, undefined, undefined`: no lastActionError, no transport reference, and no provider id —
    // a credit note's "send" has no transport at all (see transport-registry.ts's own
    // `DocumentTransportResult.reference`/`.providerId`).
    expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
      'company-1',
      'credit-note',
      'cn-1',
      'sent',
      null,
      undefined,
      undefined,
    );
    expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
  });

  // TODO_PRODUIT.md T2bis — "l'avoir gagne le webhook au passage": T2 deliberately left this type
  // with NO webhook at all (no `CREDIT_NOTE_SENT` ever existed in the schema); the generic
  // `DOCUMENT_SENT` removes the need for a per-type event, so the credit note gets one for free the
  // moment `deps.webhooks` is passed — the SAME wiring invoice/quote already have, no new mechanism.
  it('"send" (phase 2) dispatches DOCUMENT_SENT — the type T2 left webhook-less gets one for free', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      ...invoiceDocument('invoice-doc-1', ['line-1']),
      status: 'sending',
    });
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'sent',
      data: validCreditNoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
    const { service } = buildService(webhooks);
    const result = await service.runAction('company-1', 'credit-note', 'send', {
      documentId: 'cn-1',
      data: validCreditNoteData,
    });

    expect(result.document).toMatchObject({ id: 'cn-1', status: 'sent' });
    expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
    expect(webhooks.dispatch).toHaveBeenCalledWith(
      'DOCUMENT_SENT',
      expect.objectContaining({
        documentId: 'cn-1',
        typeId: 'credit-note',
        companyId: 'company-1',
        document: expect.objectContaining({ id: 'cn-1', status: 'sent' }),
      }),
    );
  });

  // ── TODO_PRODUIT.md T3's own "T2bis différé" — a credit note reaching "sent" is the SECOND write
  // path (besides invoice-actions.ts's "record-payment") that can cross an invoice into "settled".
  describe('"send" (phase 2) — DOCUMENT_SETTLED, when THIS credit note is the one that settles the invoice it corrects', () => {
    /** Two 100 EUR (0% VAT) lines — round numbers, so every settlement figure below is exact and
     *  easy to hand-check: 200.00 EUR gross total, 100.00 EUR per corrected line. */
    function settledInvoiceDocument() {
      return {
        id: 'invoice-doc-1',
        typeId: 'invoice',
        status: 'sent',
        data: {
          client: 'client-1',
          issueDate: '2026-01-15',
          dueDate: '2026-02-15',
          currency: 'EUR',
          lines: [
            { [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '0' },
            { [ROW_ID_KEY]: 'line-2', description: 'Gadget', quantity: 1, unitPrice: 100, vatRate: '0' },
          ],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const sentCreditNoteRow = {
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'sent',
      data: {
        invoice: 'invoice-doc-1',
        issueDate: '2026-02-01',
        currency: 'EUR',
        correctedLines: ['line-1'],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('the invoice was already 100.00 EUR paid — this credit note (100.00 EUR, the other line) COMPLETES it: DOCUMENT_SETTLED fires once', async () => {
      // Phase 2's OWN re-read (async-send.ts) needs "sending"; the settlement check's re-fetch of the
      // INVOICE (a DIFFERENT id, 'invoice-doc-1') needs the settled-friendly fixture above — the SAME
      // shared mock serves both, exactly like this file's own header already documents for the "send"
      // tests above (neither call site reads `.typeId`/`.id` off the fixture to pick a branch).
      (persistence.findOwnedDocument as jest.Mock).mockImplementation((_companyId, typeId, id) =>
        Promise.resolve(
          typeId === 'invoice' && id === 'invoice-doc-1'
            ? settledInvoiceDocument()
            : { ...settledInvoiceDocument(), id: 'cn-1', typeId: 'credit-note', status: 'sending' },
        ),
      );
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(sentCreditNoteRow);
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([
        { id: 'payment-1', documentId: 'invoice-doc-1', documentAmountMinor: 10000, currency: 'EUR' },
      ]);
      // The DB now shows this note "sent" — `listCreditNotes` reads CURRENT state (see
      // credit-note-actions.ts's own header on why the crossing check excludes it for "before" rather
      // than snapshotting a moment earlier).
      (settlementCredits.listCreditNotes as jest.Mock).mockResolvedValue([sentCreditNoteRow]);

      const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
      const { service } = buildService(webhooks);
      const result = await service.runAction('company-1', 'credit-note', 'send', {
        documentId: 'cn-1',
        data: sentCreditNoteRow.data,
      });

      expect(result.document).toMatchObject({ id: 'cn-1', status: 'sent' });
      // DOCUMENT_SENT (the credit note itself) AND DOCUMENT_SETTLED (the invoice it just completed)
      // — exactly two dispatches, never more.
      expect(webhooks.dispatch).toHaveBeenCalledTimes(2);
      expect(webhooks.dispatch).toHaveBeenCalledWith('DOCUMENT_SENT', expect.anything());
      expect(webhooks.dispatch).toHaveBeenCalledWith(
        'DOCUMENT_SETTLED',
        expect.objectContaining({
          documentId: 'invoice-doc-1',
          typeId: 'invoice',
          companyId: 'company-1',
          settlement: expect.objectContaining({
            settled: true,
            totalGrossMinor: 20000,
            paidMinor: 10000,
            creditedMinor: 10000,
            outstandingMinor: 0,
          }),
        }),
      );
    });

    it('the invoice still owes money after this credit note (only a PARTIAL correction) — zero DOCUMENT_SETTLED emissions', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockImplementation((_companyId, typeId, id) =>
        Promise.resolve(
          typeId === 'invoice' && id === 'invoice-doc-1'
            ? settledInvoiceDocument()
            : { ...settledInvoiceDocument(), id: 'cn-1', typeId: 'credit-note', status: 'sending' },
        ),
      );
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(sentCreditNoteRow);
      // NOTHING paid at all — correcting line-1 (100 EUR) still leaves line-2 (100 EUR) owed.
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([]);
      (settlementCredits.listCreditNotes as jest.Mock).mockResolvedValue([sentCreditNoteRow]);

      const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
      const { service } = buildService(webhooks);
      await service.runAction('company-1', 'credit-note', 'send', {
        documentId: 'cn-1',
        data: sentCreditNoteRow.data,
      });

      expect(webhooks.dispatch).toHaveBeenCalledTimes(1); // DOCUMENT_SENT only.
      expect(webhooks.dispatch).not.toHaveBeenCalledWith('DOCUMENT_SETTLED', expect.anything());
    });

    it('the invoice was ALREADY settled before this credit note (an excess credit on top) — no NEW crossing, zero emissions', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockImplementation((_companyId, typeId, id) =>
        Promise.resolve(
          typeId === 'invoice' && id === 'invoice-doc-1'
            ? settledInvoiceDocument()
            : { ...settledInvoiceDocument(), id: 'cn-1', typeId: 'credit-note', status: 'sending' },
        ),
      );
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(sentCreditNoteRow);
      // Already fully paid BEFORE this credit note — the crossing already happened at that payment.
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([
        { id: 'payment-1', documentId: 'invoice-doc-1', documentAmountMinor: 20000, currency: 'EUR' },
      ]);
      (settlementCredits.listCreditNotes as jest.Mock).mockResolvedValue([sentCreditNoteRow]);

      const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
      const { service } = buildService(webhooks);
      await service.runAction('company-1', 'credit-note', 'send', {
        documentId: 'cn-1',
        data: sentCreditNoteRow.data,
      });

      expect(webhooks.dispatch).toHaveBeenCalledTimes(1); // DOCUMENT_SENT only — never a re-fire.
      expect(webhooks.dispatch).not.toHaveBeenCalledWith('DOCUMENT_SETTLED', expect.anything());
    });
  });

  it('"send" is not offered before the credit note has ever been saved — 409, like any other status-gated action', async () => {
    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'send', { data: validCreditNoteData }),
    ).rejects.toThrow(/not available before the document has been saved/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('declares "correctedLines" as a rowSelection sourced from the invoice\'s own "lines"', () => {
    const descriptor = buildService().service.getType('credit-note');
    const field = descriptor.fields.find((f) => f.key === 'correctedLines');
    expect(field).toMatchObject({
      kind: 'rowSelection',
      sourceField: 'invoice',
      sourceEntity: 'invoice',
      sourceArrayField: 'lines',
    });
  });

  it('a complete credit note, correcting a line that genuinely exists on the invoice, is persisted', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-doc-1', ['line-1']),
    );
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'draft',
      data: validCreditNoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const result = await service.runAction('company-1', 'credit-note', 'save-draft', {
      data: validCreditNoteData,
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'cn-1', status: 'draft' });
    expect(persistence.findOwnedDocument).toHaveBeenCalledWith('company-1', 'invoice', 'invoice-doc-1');
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'credit-note',
      undefined,
      'draft',
      // correctedLines isn't an 'array' field itself, so nothing here gets a $rowId stamped onto
      // it — stamping only ever touches 'array' rows (the INVOICE's own lines), never this field.
      validCreditNoteData,
    );
  });

  it('requires the invoice it corrects — an empty credit note is rejected before ever touching persistence', async () => {
    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: {} }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('rejects the multi-target OBJECT shape — "invoice" never declared more than one possible target', async () => {
    const dataWithObjectRef = { ...validCreditNoteData, invoice: { entity: 'invoice', id: 'invoice-doc-1' } };

    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: dataWithObjectRef }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // THE case this task singled out: a corrected line that has since disappeared from the invoice it
  // targets. This must block through the REAL, wired path (runAction), not merely in the pure
  // validator's own unit tests (resolve-row-selection.spec.ts) — a regression that wired the
  // mechanism but never actually called it from runAction would pass every test in that file while
  // failing this one.
  it('blocks saving a credit note whose corrected line no longer exists on the invoice — never a silent save', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-doc-1', ['line-1']),
    );

    const dataWithGhostLine = { ...validCreditNoteData, correctedLines: ['a-line-that-was-removed'] };

    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: dataWithGhostLine }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('blocks, naming the invoice, when the invoice it references no longer exists at all', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new NotFoundException('gone'));

    let caught: unknown;
    try {
      await buildService().service.runAction('company-1', 'credit-note', 'save-draft', {
        data: validCreditNoteData,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    const response = (
      caught as { getResponse: () => { errors: { key: string; message: string }[] } }
    ).getResponse();
    expect(response.errors).toContainEqual(
      expect.objectContaining({ key: 'correctedLines', message: expect.stringMatching(/no longer exists/) }),
    );
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  /**
   * TODO_PRODUIT.md T4-d — credit-note-actions.ts's own `assertCreditNoteCurrencyMatchesInvoice`:
   * a credit note's own `currency` must equal the invoice it corrects, at every save (creation AND
   * a later re-edit) — never a silent mismatch. `validCreditNoteData`/`invoiceDocument()` (this
   * file's own fixtures, used by every OTHER test above) already agree on "EUR" for both, which is
   * exactly why none of those pre-existing tests needed to change for this guard to land.
   */
  describe('"save-draft" — TODO_PRODUIT.md T4-d: the credit note\'s own currency must match its invoice', () => {
    beforeEach(() => {
      (persistence.upsertDocument as jest.Mock).mockImplementation(
        async (_companyId, _typeId, _documentId, status, data) => ({
          id: 'cn-1',
          typeId: 'credit-note',
          status,
          data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    it("accepts a credit note whose currency is IDENTICAL to its invoice's own", async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
        invoiceDocument('invoice-doc-1', ['line-1']),
      );

      const { service } = buildService();
      const result = await service.runAction('company-1', 'credit-note', 'save-draft', {
        data: validCreditNoteData, // "EUR", same as invoiceDocument()'s own
      });

      expect(result.document?.status).toBe('draft');
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'credit-note',
        undefined,
        'draft',
        validCreditNoteData,
      );
    });

    it("BLOCKS a credit note whose currency does NOT match its invoice's own — named 400, nothing persisted", async () => {
      // invoiceDocument() is always "EUR" (this file's own fixture) — declaring "USD" here is the
      // mismatch this guard exists to catch.
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
        invoiceDocument('invoice-doc-1', ['line-1']),
      );
      const mismatchedData = { ...validCreditNoteData, currency: 'USD' };

      let caught: unknown;
      try {
        await buildService().service.runAction('company-1', 'credit-note', 'save-draft', {
          data: mismatchedData,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).message).toMatch(/USD.*EUR|currency other than the invoice/i);
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('is enforced on a RE-EDIT too, not just at creation — an existing draft cannot be saved into a mismatch', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
        invoiceDocument('invoice-doc-1', ['line-1']),
      );
      const mismatchedData = { ...validCreditNoteData, currency: 'USD' };

      await expect(
        buildService().service.runAction('company-1', 'credit-note', 'save-draft', {
          documentId: 'cn-1', // an EXISTING record — this is an edit, not a first save
          data: mismatchedData,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('does not block when the invoice itself has no currency yet (a country-less-safe draft) — nothing to compare against', async () => {
      const currencyLessInvoice = invoiceDocument('invoice-doc-1', ['line-1']);
      delete (currencyLessInvoice.data as { currency?: string }).currency;
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(currencyLessInvoice);

      const { service } = buildService();
      const result = await service.runAction('company-1', 'credit-note', 'save-draft', {
        data: validCreditNoteData, // still declares "EUR" — nothing on the invoice side to disagree with
      });

      expect(result.document?.status).toBe('draft');
      expect(persistence.upsertDocument).toHaveBeenCalled();
    });

    // THE BYPASS this guard would otherwise leave open: "send" (unlike every other action) persists
    // whatever `data` IT is called with, at its own phase-1 preflight — a scripted client could
    // skip "save-draft" entirely and call "send" directly with a mismatched currency. Proven through
    // the REAL wired path (runAction -> credit-note-actions.ts's "send" registration), never just
    // the pure guard function's own unit behavior.
    it('"send" (phase 1) is ALSO guarded — a scripted client cannot bypass "save-draft" to sneak a mismatch straight to "send"', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
        invoiceDocument('invoice-doc-1', ['line-1']),
      );
      const mismatchedData = { ...validCreditNoteData, currency: 'USD' };

      let caught: unknown;
      try {
        await buildService().service.runAction('company-1', 'credit-note', 'send', {
          documentId: 'cn-1',
          data: mismatchedData,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      // Blocked BEFORE the "sending" write AND before anything is queued — the same "nothing
      // persisted on a hard block" discipline every other named refusal in this codebase holds.
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });
  });
});
