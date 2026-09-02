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
import { archiveDeliveredArtifactsIfAny } from '../archive/archive-on-send';
import { ArchivedArtifactInput } from '../archive/hashing';
import { takeDocumentNumberForTransition } from '../numbering/take-number';
import { findOwnedDocument, updateDocumentStatus, upsertDocument } from '../persistence';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { reportOnSendIfObligated } from '../reporting/report-on-send';

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

export type AsyncSendDeliver = (ctx: AsyncSendDeliverContext) => Promise<{
  message?: string;
  reference?: string;
  /** Mirrors `DocumentTransportResult.providerId` (`transports/transport-registry.ts`) — persisted
   *  onto `DocumentInstance.channelProviderId` on the SAME write as `reference` below, so the
   *  conformity sweep (`conformity/`) always knows which channel THIS document actually went
   *  through, regardless of what the company's transport choice has since become. */
  providerId?: string;
  artifacts?: ArchivedArtifactInput[];
}>;

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
   *
   * Root TODO item 16 ("transfrontalier") — MAY now return the field values to persist INSTEAD OF
   * `data` (returning `undefined`, the ONLY shape a preflight had before this task, still means
   * "nothing to rewrite, persist `data` exactly as submitted" — the quote's and the credit note's own
   * preflights, and every existing caller, are entirely unaffected). The invoice's own preflight
   * (invoice-actions.ts) uses this to hand back the RESOLVED cross-border treatment: the principle,
   * carried over from the pre-refonte compliance engine, is that a document's fiscal treatment is
   * resolved at ISSUANCE, and the record that actually enters "sending" — the one a worker will
   * transmit, archive, and total a balance against — IS that resolved document, never the raw draft.
   * The draft was the user's own entry; the moment it leaves "draft" (or "send_failed") it becomes a
   * legal fact, frozen exactly as resolved. See this file's own header for why "sending" (not "sent")
   * is where a document's field values freeze for good — the SAME `data` this returns also becomes
   * the enqueued job's own payload just below, so `deliver()`'s later re-resolution (see
   * `invoice-actions.ts`'s own header) runs on ALREADY-RESOLVED data — which is why that resolution
   * has to be idempotent (tax/resolve-invoice-tax.spec.ts proves it is).
   */
  preflight?: () => Promise<Record<string, unknown> | undefined>;
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
  const { companyId, typeId, documentId, params, queueDispatcher, deliver, preflight, numberOnEnqueue } =
    input;
  // Reassigned below, ONLY on the phase-1 path, when `preflight` hands back a resolved replacement —
  // see `RunAsyncSendInput.preflight`'s own header. Untouched (still exactly `input.data`) for the
  // phase-2 branch just below, and for any type whose preflight is absent or returns nothing.
  let data = input.data;

  if (!documentId) {
    // Unreachable in practice — every type's own SEND_TRANSITIONS starts from 'draft'/'send_failed',
    // never 'always', so a never-saved record never satisfies `availableWhen` for "send" in the first
    // place — but a handler never trusts that alone, the same defensive posture "delete" and
    // "record-payment" already hold.
    throw new Error(`Cannot send a "${typeId}" document that has not been saved yet.`);
  }

  const existing = await findOwnedDocument(companyId, typeId, documentId);

  if (existing.status === 'sending') {
    const { message, reference, providerId, artifacts } = await deliver({
      companyId,
      typeId,
      documentId,
      document: existing,
      data,
      params,
    });
    const sent = await updateDocumentStatus(
      companyId,
      typeId,
      documentId,
      'sent',
      null,
      reference,
      providerId,
    );

    // Root TODO item 14 ("archivage légal") — archived ONLY once delivery has genuinely succeeded
    // (this line runs after `sent` is already persisted, never before): archiving a delivery that
    // could still fail would be a lie about what was actually conserved. `archiveDeliveredArtifactsIfAny`
    // NEVER throws (see its own header) — a storage/DB problem here must never undo a delivery that
    // already happened (the email already left, the deposit was already accepted); it is instead
    // recorded on the document itself (`lastArchiveError`) and logged loudly, never silently.
    await archiveDeliveredArtifactsIfAny({ companyId, documentId, artifacts });

    // A NEW concept (root TODO — "déclaration"), never a transport: Hungary/NAV and Greece/myDATA
    // require the SELLER to declare the invoice's data to its tax authority AFTER issuance,
    // regardless of the channel that just delivered it — see `reporting/report-on-send.ts`'s own
    // header. Runs generically, for every type/transport, exactly like the archive call just above;
    // NEVER throws, and enqueues nothing for a seller whose country has no such obligation.
    await reportOnSendIfObligated({ companyId, typeId, documentId, queueDispatcher });

    return { document: sent, changed: true, message };
  }

  if (preflight) {
    // Root TODO item 16 — a resolved replacement REPLACES `data` for everything below: the
    // "sending" write just after this, AND the job payload enqueued further down. `deliver()` later
    // re-resolves that SAME (already-resolved) value again — see this function's own `preflight`
    // header on why that has to be, and is, idempotent.
    const resolved = await preflight();
    if (resolved) data = resolved;
  }

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
