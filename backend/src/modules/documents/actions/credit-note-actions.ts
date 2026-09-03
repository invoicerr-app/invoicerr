import { BadRequestException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { findOwnedDocument } from '../persistence';
import { DocumentEventPublisher } from '../queue/document-events';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { computeSettlement } from '../settlement/compute-settlement';
import { creditsForInvoiceFromNotes, listCreditNotes, toSettlementCreditInputs } from '../settlement/credits';
import { crossedIntoSettled, emitDocumentSettled } from '../settlement/document-settled';
import { listPayments, toSettlementPaymentInputs } from '../settlement/payments';
import { computeDocumentTotals } from '../totals/compute-totals';
import { runAsyncSendAction } from './async-send';
import { ActionRegistry, DocumentInstanceResult } from './action-registry';
import { performSaveDraft } from './generic-actions';

/** Same direct-import model as actions/invoice-actions.ts's own `INVOICE_DESCRIPTOR` constant — used
 *  ONLY to feed `computeDocumentTotals` the invoice's own field shape when a credit note this task's
 *  settlement-crossing check just sent might have settled it (see
 *  `checkAndEmitInvoiceSettledFromCreditNote` below). */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export interface CreditNoteActionDeps {
  queueDispatcher: DocumentActionQueueDispatcher;
  /** TODO_PRODUIT.md T1 / PLAN-V2 R8 — see `async-send.ts`'s own `RunAsyncSendInput.events` header. */
  events?: DocumentEventPublisher;
  /**
   * TODO_PRODUIT.md T2bis — see `async-send.ts`'s own `RunAsyncSendInput.webhooks` header. Under T2
   * this type deliberately got NO webhook at all: the schema had no `CREDIT_NOTE_SENT` (nor any other
   * `CREDIT_NOTE_*` entry) and inventing one was explicitly out of that task's scope. T2bis's own
   * generic `DOCUMENT_SENT`/`DOCUMENT_CREATED` removes the need for a per-type event entirely — this
   * type now passes the SAME `deps.webhooks` invoice/quote already do, and gets both for free.
   */
  webhooks?: DocumentWebhookEmitter;
}

/**
 * Registers the credit note type's action IMPLEMENTATIONS — "save-draft" (the exact same generic
 * mechanism the quote and the invoice already share, generic-actions.ts) and, as of item 8 of the
 * root TODO ("le lettrage"), "send" (see credit-note.descriptor.ts's own "Actions" paragraph for the
 * full reasoning). "send" is deliberately NOT the quote's own send-by-email mechanism
 * (quote-actions.ts), nor any bespoke transport lookup (the invoice's own, invoice-actions.ts): its
 * own `deliver` below does nothing at all — no transport, no email, no recipient — only the shared
 * status machinery moves the record from "draft"/"send_failed" through "sending" to "sent": this type
 * still has no "client" field, no transport, and no policy on who a credit note goes to, exactly the
 * gap this file's own history already refused to invent. What DOES need this transition to exist:
 * settlement/credits.ts only counts a credit note that is "sent" — a draft settles nothing (its own
 * comment, carried over from the removed `invoices/settlement.ts`), so lettrage needed SOME way out of
 * "draft" to mean anything at all.
 *
 * As of TODO.md item 22, this goes through `runAsyncSendAction` (actions/async-send.ts) like every
 * other type's "send" — see credit-note.descriptor.ts's own comment on why that is deliberate even
 * though this type's `deliver` has nothing to await: ONE mechanism for the action id "send", whatever
 * a given type's own delivery actually does.
 */
/**
 * TODO_PRODUIT.md T3's own "T2bis différé" — a credit note reaching "sent" is the SECOND (and only
 * other) write path that can make an INVOICE cross into "settled" (settlement/credits.ts only counts
 * a credit note once it is "sent" — a draft settles nothing): the invoice's own "record-payment"
 * (invoice-actions.ts) covers the first. Called ONLY once `sentCreditNote.status === 'sent'` is
 * genuinely true in Postgres (see this file's own "send" registration below — never on phase 1,
 * where the record is merely "sending").
 *
 * "Before" is computed the same way invoice-actions.ts's own record-payment does — the SAME set of
 * credit notes, minus the one that JUST became "sent" (never a snapshot taken a moment earlier,
 * which would need a second query and open a race window) — `listCreditNotes` already reads the
 * CURRENT database state, where this note is already "sent", so filtering it OUT reconstructs exactly
 * what settlement looked like the instant before this write. The invoice's PAYMENTS are unaffected by
 * a credit note's own "send", so they are read once and reused on both sides of the comparison.
 *
 * Never throws — wrapped entirely in its own try/catch, the same "a third party's webhook endpoint
 * being down must never undo, or even be visible from, the write that just succeeded" discipline
 * every other `DOCUMENT_*` dispatch site holds (see async-send.ts's own `DOCUMENT_SENT` block): a
 * credit note that failed to reach the invoice it corrects (deleted invoice, a transient DB hiccup)
 * must not turn "the credit note was sent" into a 500 the user never asked for.
 */
async function checkAndEmitInvoiceSettledFromCreditNote(
  companyId: string,
  sentCreditNote: DocumentInstanceResult,
  webhooks: DocumentWebhookEmitter | undefined,
): Promise<void> {
  if (!webhooks) return; // no capability, no effect — same guard emitDocumentSettled itself holds.
  try {
    const noteData = (sentCreditNote.data ?? {}) as Record<string, unknown>;
    const invoiceId = typeof noteData.invoice === 'string' ? noteData.invoice : undefined;
    if (!invoiceId) return;

    const invoice = await findOwnedDocument(companyId, 'invoice', invoiceId);
    const invoiceData = (invoice.data ?? {}) as Record<string, unknown>;
    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, invoiceData);
    const paymentInputs = toSettlementPaymentInputs(await listPayments(companyId, invoiceId));

    const allNotes = await listCreditNotes(companyId);
    const notesBefore = allNotes.filter((note) => note.id !== sentCreditNote.id);
    const { credits: creditsBefore } = creditsForInvoiceFromNotes(
      notesBefore,
      invoiceId,
      INVOICE_DESCRIPTOR,
      invoiceData,
    );
    const { credits: creditsAfter } = creditsForInvoiceFromNotes(
      allNotes,
      invoiceId,
      INVOICE_DESCRIPTOR,
      invoiceData,
    );

    const before = computeSettlement(
      totals.grossMinor,
      paymentInputs,
      toSettlementCreditInputs(creditsBefore),
    );
    const after = computeSettlement(totals.grossMinor, paymentInputs, toSettlementCreditInputs(creditsAfter));

    if (crossedIntoSettled(before, after)) {
      await emitDocumentSettled(webhooks, companyId, 'invoice', invoice, after);
    }
  } catch (error) {
    logger.error('Failed to check/emit DOCUMENT_SETTLED after a credit note was sent', {
      category: 'documents',
      details: {
        companyId,
        creditNoteId: sentCreditNote.id,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * TODO_PRODUIT.md T4-d — the currency a credit note declares has no business meaning independent of
 * the invoice it corrects: T3 established that an avoir carries NO conversion of its own (settlement/
 * credits.ts credits whatever it declares directly against the invoice's own, un-converted balance —
 * see that file's own header and TODO_ISSUES.md's "avoirs : pas de conversion — structurellement en
 * devise facture" constat) — so a credit note in a currency OTHER than its invoice's is not a second
 * valid business case with its own rule, it is a data-entry mistake with no sensible reading at all,
 * refused outright rather than silently miscounted forever against the wrong total.
 *
 * `data.invoice` is already GUARANTEED to resolve to a real, owned invoice by the time this handler
 * ever runs: `correctedLines` (credit-note.descriptor.ts, kind: 'rowSelection', sourceField:
 * 'invoice') is REQUIRED, so `validateRowSelections` (documents.service.ts#runAction, BEFORE any
 * handler) has already fetched and confirmed this exact invoice exists — the SECOND
 * `findOwnedDocument` call below is a deliberate, cheap re-read (that validation lives in a
 * different module, with no shared cache), not a sign this function is otherwise unreachable.
 *
 * TWO call sites, deliberately — both write paths that can change what `data.currency` persists.
 * `registerCreditNoteSaveDraftAction` below guards "save-draft" (creation AND every later re-edit,
 * since that action ALWAYS persists whatever `data` it receives). `registerCreditNoteActions`'s own
 * "send" registration guards the SECOND, easy-to-miss path: `async-send.ts`'s phase-1 `preflight`
 * runs BEFORE its own `upsertDocument` persists the submitted `data` as "sending" — a scripted
 * client could otherwise call "send" directly (skipping "save-draft" entirely) with a mismatched
 * currency and have it persisted uncaught. Same guard, same function, never a second copy of the
 * comparison.
 *
 * Screen-side, `credit-note.descriptor.ts`'s own `currency` field declares `lockedFromReference`
 * (descriptors/types.ts) so the create/edit form never lets a user TYPE a mismatch in the first
 * place — this is the hard backstop for whatever reaches the API directly, the same "the screen is
 * never trusted alone" posture invoice-actions.ts's own buyer-country guard (TODO_PRODUIT.md T4-c)
 * already holds.
 */
async function assertCreditNoteCurrencyMatchesInvoice(
  companyId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const invoiceId = typeof data.invoice === 'string' ? data.invoice : undefined;
  // Unreachable in practice — the descriptor's own required 'invoice' field, and the rowSelection
  // validation this function's own header describes, already refuse an invoice-less credit note
  // before this ever runs — but a guard never trusts that alone (duplicate-extension.ts's own
  // discipline).
  if (!invoiceId) return;

  const invoice = await findOwnedDocument(companyId, 'invoice', invoiceId);
  const invoiceData = (invoice.data ?? {}) as Record<string, unknown>;
  const invoiceCurrency = invoiceData.currency;
  // The invoice itself has no currency yet (a country-less-safe DRAFT, per invoice.descriptor.ts's
  // own posture) — nothing sensible to compare against; this credit note's own currency stays the
  // user's choice, unblocked, until the invoice it corrects actually has one.
  if (typeof invoiceCurrency !== 'string') return;

  if (data.currency !== invoiceCurrency) {
    throw new BadRequestException(
      `This credit note declares "${String(data.currency)}", but the invoice it corrects ` +
        `(${invoice.displayNumber ?? invoiceId}) is in "${invoiceCurrency}" — a credit note has no ` +
        'business existing in a currency other than the invoice it corrects: the amount it credits ' +
        `is structurally denominated in that invoice's own currency, with no conversion of its own ` +
        `(TODO_PRODUIT.md T3). Pick "${invoiceCurrency}".`,
    );
  }
}

/**
 * "save-draft" for the credit note — NOT the plain generic mechanism (unlike before T4-d): wraps
 * `performSaveDraft` (generic-actions.ts) with the currency guard above, the same "diverge from the
 * shared mechanism for one documented, invoice-shaped reason" precedent invoice-actions.ts's own
 * `registerInvoiceSaveDraftAction` already set (TODO_PRODUIT.md T4-c) — this is credit-note's
 * analogous case, not a coincidence: both types need ONE extra check the generic mechanism has no
 * business knowing about, and both reuse `performSaveDraft` for the actual persistence so the two
 * never drift.
 */
function registerCreditNoteSaveDraftAction(
  registry: ActionRegistry,
  webhooks?: DocumentWebhookEmitter,
): void {
  registry.register('credit-note', 'save-draft', async (ctx) => {
    await assertCreditNoteCurrencyMatchesInvoice(ctx.companyId, ctx.data);
    return performSaveDraft(ctx.companyId, 'credit-note', ctx.documentId, ctx.data, webhooks);
  });
}

export function registerCreditNoteActions(registry: ActionRegistry, deps: CreditNoteActionDeps): void {
  registerCreditNoteSaveDraftAction(registry, deps.webhooks);

  registry.register('credit-note', 'send', async ({ companyId, documentId, data, params }) => {
    const result = await runAsyncSendAction({
      companyId,
      typeId: 'credit-note',
      documentId,
      data,
      params,
      queueDispatcher: deps.queueDispatcher,
      events: deps.events,
      // TODO_PRODUIT.md T2bis — see async-send.ts's own `RunAsyncSendInput.webhooks` header.
      webhooks: deps.webhooks,
      // credit-note.descriptor.ts declares NO `numbering` at all — never number this type, ever.
      numberOnEnqueue: false,
      // TODO_PRODUIT.md T4-d — "send" (unlike every OTHER action) persists whatever `data` THIS
      // call submits as the record's new "sending" state (async-send.ts's own phase-1 `upsertDocument`
      // call, right after `preflight` runs) — a SEPARATE write path from "save-draft", which
      // `assertCreditNoteCurrencyMatchesInvoice` above already guards. Without this, a scripted
      // client could call "send" directly (skipping "save-draft" entirely) with a currency that
      // mismatches the invoice and have it persisted uncaught — the exact bypass this preflight
      // closes, no `data` replacement needed (returning `undefined` leaves `data` exactly as
      // submitted; only a MISMATCH ever throws).
      preflight: async () => {
        await assertCreditNoteCurrencyMatchesInvoice(companyId, data);
        return undefined;
      },
      // Nothing to deliver — see this file's own header. The status transition itself IS the
      // action's entire effect.
      deliver: async () => ({ message: undefined }),
    });

    // `result.document.status` is "sending" after phase 1 (draft/send_failed -> sending, the
    // synchronous API call) and "sent" only after phase 2 (the worker's replay, once
    // `runAsyncSendAction` has ACTUALLY persisted it — see that function's own header) — checking it
    // here, from OUTSIDE `runAsyncSendAction`, is what lets this stay entirely credit-note-specific
    // without adding a new generic hook to the shared engine every OTHER type would have to ignore.
    if (result.document?.status === 'sent') {
      await checkAndEmitInvoiceSettledFromCreditNote(companyId, result.document, deps.webhooks);
    }

    return result;
  });
}
