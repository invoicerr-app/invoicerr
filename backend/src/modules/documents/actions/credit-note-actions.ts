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
import { registerSaveDraftAction } from './generic-actions';

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

export function registerCreditNoteActions(registry: ActionRegistry, deps: CreditNoteActionDeps): void {
  registerSaveDraftAction(registry, 'credit-note', deps.webhooks);

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
