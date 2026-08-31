/**
 * The two-phase "send" every type declaring one shares (quote/invoice/credit-note — never "expense",
 * which has no "send" at all) — TODO.md item 22, and TODO_ISSUES.md's own entry on the limit this
 * replaces: the document used to be persisted "sent" (and numbered) BEFORE the email actually left,
 * so a PDF/SMTP failure left a "sent" document nobody ever received. Fixed by an intermediate
 * status, declared in data on each type's own lifecycle (see e.g. quote.descriptor.ts's own
 * `SEND_TRANSITIONS`):
 *
 *   draft/send_failed --[send]--> sending --[send, replayed by the worker]--> sent | send_failed
 *
 * `runAsyncSendAction` is called from the SAME registered "send" handler on BOTH ends of that arrow
 * — `documents.service.ts`'s `runAction` has no other way to reach an action's implementation, so the
 * API's own synchronous call and the worker's replayed one are, by construction, THE SAME CODE PATH:
 *
 *  - called with the record "draft" (or "send_failed" — a retry IS the action itself, not a separate
 *    mechanism): persists "sending", then — for a type that numbers at "sending" (`numberOnEnqueue:
 *    true`, see below) — takes the number ITSELF, right here, before enqueueing anything. This is
 *    NOT the same "pulled forward" mechanism send-document-email.ts's own header describes as a
 *    defensive fallback: it is the PRIMARY numbering path for the async model, and it is load-bearing
 *    — `documents.service.ts`'s `runAction` only numbers a record AFTER its handler returns, which is
 *    too late here: the job is enqueued (and can be picked up by a real worker) BEFORE control ever
 *    returns to `runAction`'s own post-handler hook. Without taking the number here first, a fast
 *    worker can render+send the email BEFORE the number exists, producing a document (and a subject
 *    line) with a blank number — a real race this task's own integration test
 *    (queue/__tests__/document-action-queue.redis.spec.ts) caught in practice, not a theoretical one.
 *    Only once numbered does this enqueue a document-action job for this SAME action and return.
 *    Nothing is delivered yet.
 *  - called with the record already "sending" — this only ever happens via
 *    queue/processors/document-action.processor.ts replaying the job through `runAction`, never a
 *    normal user click (the frontend hides an in-flight record's actions — see
 *    document-list.tsx's own `isProcessing` check): runs `deliver()`. A thrown error propagates
 *    UNCAUGHT — never caught and turned into "send_failed" here, so BullMQ's own retry/backoff gets
 *    to run first. Only queue/mark-send-failed.ts, once every retry is exhausted, records
 *    "send_failed" — see that file's own header for why that is a deliberately SEPARATE path.
 *
 * `deliver` is the only thing that genuinely varies by type: the quote's unconditional email
 * (quote-actions.ts), the invoice's company-configured transport (invoice-actions.ts), or
 * (credit-note-actions.ts) nothing at all — a plain status transition with no transport, no email,
 * exactly as before this task, just reached one hop later.
 */
import { DocumentInstanceResult, ActionResult } from './action-registry';
import { takeDocumentNumberForTransition } from '../numbering/take-number';
import { findOwnedDocument, updateDocumentStatus, upsertDocument } from '../persistence';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';

export interface AsyncSendDeliverContext {
  companyId: string;
  typeId: string;
  documentId: string;
  /** Freshly re-read from the database — already carries `number`/`displayNumber` (see this file's
   *  own header: numbering happens at "sending", strictly before `deliver` ever runs). */
  document: DocumentInstanceResult;
  data: Record<string, unknown>;
  params: Record<string, unknown>;
}

export type AsyncSendDeliver = (
  ctx: AsyncSendDeliverContext,
) => Promise<{ message?: string; reference?: string }>;

export interface RunAsyncSendInput {
  companyId: string;
  typeId: string;
  documentId: string | undefined;
  data: Record<string, unknown>;
  params: Record<string, unknown>;
  queueDispatcher: DocumentActionQueueDispatcher;
  deliver: AsyncSendDeliver;
  /**
   * An OPTIONAL synchronous gate run ONLY on the phase-1 (enqueue) call, BEFORE the record is ever
   * transitioned to "sending" and BEFORE anything is queued — e.g. the invoice's "is a transport even
   * configured" check (invoice-actions.ts). Throwing here (a `NotImplementedException`, exactly like
   * an action with no registered handler at all) means nothing is persisted and nothing is queued —
   * the same "blocked, and says so, before touching anything" behavior this action had before it
   * became asynchronous. Absent for a type with no such precondition (the quote, the credit note).
   */
  preflight?: () => Promise<void>;
  /**
   * Whether THIS type declares `numbering: { onEnterStatus: 'sending' }` (quote/invoice: true;
   * credit-note: false — see credit-note.descriptor.ts's own comment on why it declares no numbering
   * at all). `runAsyncSendAction` cannot infer this itself — it never sees a descriptor, only a typeId
   * — so each caller passes it explicitly, reading straight off its own type's descriptor (the same
   * `INVOICE_DESCRIPTOR`-style module-level constant invoice-actions.ts already keeps for this exact
   * purpose). Numbering a type that declares none would silently invent a fact this core has no
   * business inventing, the same discipline every other numbering check in this codebase already
   * holds — see this file's own header for WHY this has to happen here at all, not left to
   * `runAction`'s own (now merely defensive) post-handler hook.
   */
  numberOnEnqueue: boolean;
}

export async function runAsyncSendAction(input: RunAsyncSendInput): Promise<ActionResult> {
  const {
    companyId,
    typeId,
    documentId,
    data,
    params,
    queueDispatcher,
    deliver,
    preflight,
    numberOnEnqueue,
  } = input;

  if (!documentId) {
    // Unreachable in practice — every type's own SEND_TRANSITIONS starts from 'draft'/'send_failed',
    // never 'always', so a never-saved record never satisfies `availableWhen` for "send" in the first
    // place — but a handler never trusts that alone, the same defensive posture "delete" and
    // "record-payment" already hold.
    throw new Error(`Cannot send a "${typeId}" document that has not been saved yet.`);
  }

  const existing = await findOwnedDocument(companyId, typeId, documentId);

  if (existing.status === 'sending') {
    const { message, reference } = await deliver({
      companyId,
      typeId,
      documentId,
      document: existing,
      data,
      params,
    });
    const sent = await updateDocumentStatus(companyId, typeId, documentId, 'sent', null, reference);
    return { document: sent, changed: true, message };
  }

  if (preflight) await preflight();

  let sending = await upsertDocument(companyId, typeId, documentId, 'sending', data);

  // THE FIX for the race this file's own header describes: the number must exist BEFORE the job is
  // enqueued, never after — a worker could otherwise pick the job up and render the PDF/email before
  // `documents.service.ts`'s own post-handler numbering hook ever runs. `number == null` mirrors that
  // same hook's own guard (never re-number an already-numbered record — a "send_failed" retry keeps
  // its original number, no gap, no duplicate).
  if (numberOnEnqueue && sending.number == null) {
    const numbered = await takeDocumentNumberForTransition(companyId, typeId, sending.id);
    if (numbered) sending = { ...sending, ...numbered };
  }

  await queueDispatcher.enqueueAction({
    companyId,
    typeId,
    documentId: sending.id,
    actionId: 'send',
    payload: { data, params },
  });
  return { document: sending, changed: true, message: 'Sending…' };
}
