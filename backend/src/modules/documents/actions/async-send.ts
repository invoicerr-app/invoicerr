/**
 * The two-phase "send" every type declaring one shares (quote/invoice/credit-note — never "expense",
 * which has no "send" at all). The limit this replaces: the document used to be persisted "sent"
 * (and numbered) BEFORE the email actually left,
 * so a PDF/SMTP failure left a "sent" document nobody ever received. Fixed by an intermediate
 * status, declared in data on each type's own lifecycle (see e.g. quote.descriptor.ts's own
 * `SEND_TRANSITIONS`):
 *
 *   draft/send_failed --[send]--> sending --[send, replayed by the worker]--> sent | send_failed
 *
 * ## The delivery guarantee: AT-MOST-ONCE delivery, AT-LEAST-ONCE bookkeeping
 *
 * `deliver()` reaches a real, external system this process does not transactionally control (an SMTP
 * relay, superpdp, KSeF, SdI, Chorus Pro) — nothing here can make "call `deliver()`" and "record that
 * it happened" a single atomic step, so a genuine exactly-once guarantee across that boundary does not
 * exist to be built. Given that choice, this file picks AT-MOST-ONCE for the call to `deliver()`
 * itself (never risk a second real email/deposit) and leaves the bookkeeping AFTER it AT-LEAST-ONCE
 * (safe to retry indefinitely, because it changes nothing outside this database): a duplicate invoice
 * in a client's inbox or a duplicate deposit at a tax authority is expensive and, in France/Italy,
 * a compliance problem; a document that is genuinely "sent" but briefly still LOOKS "sending" (or, in
 * the narrow case below, briefly shows "send_failed") because a status write is still being retried
 * costs nothing but a stale badge.
 *
 * The mechanism: `persistence.ts#confirmDelivery` writes a durable, cross-process fact —
 * `DocumentInstance.deliveryConfirmedAt` — the INSTANT `deliver()` returns success, strictly BEFORE
 * the "sending" -> "sent" write is ever attempted (see that column's own schema comment, and
 * `confirmDeliveryWithRetry` below). Phase 2 checks this fact FIRST, before ever calling `deliver()`:
 * non-null means some earlier attempt — this process or a completely different one, sharing nothing
 * but the same Postgres row — already delivered, so this call skips straight to finishing whatever
 * write never completed, no matter how many times "send" is replayed after that. This is what makes
 * the remaining "sending" -> "sent" write safe to retry FOREVER: once `deliveryConfirmedAt` is set,
 * no code path in this file ever calls `deliver()` again for this document, so retrying the status
 * write can never turn into a second delivery. Only the confirmation write itself sits in the
 * remaining risk window — see `confirmDeliveryWithRetry`'s own header for exactly how narrow that is
 * and why it is accepted rather than hidden.
 *
 * None of the transports wired today (`transports/email-transport.ts`, `pdp-transport.ts`,
 * `ksef-transport.ts`, `sdi-transport.ts`, `chorus-pro-transport.ts`) accept a caller-supplied
 * idempotency key that the RECEIVING system could use to recognize and collapse a genuine duplicate
 * submission on its own side — every reference `deliver()` gets back (a PDP deposit id, a KSeF session
 * ref, an SdI `idSdI`) is assigned BY that system, never sent TO it. That is the one guarantee this
 * file cannot provide by itself: if the confirmation write above fails on every one of its own bounded
 * retries (the whole local Postgres primary unreachable for that entire window, not merely a blip), a
 * subsequent attempt has nothing durable to check and could still call `deliver()` a second time.
 * Closing that residual gap needs the OTHER side to deduplicate, which needs a real, per-authority
 * protocol answer (does PDP/KSeF/SdI/Chorus Pro accept a client-chosen submission id at all?) that is
 * not established anywhere in this codebase today — a follow-up, not something to guess at here.
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
 *    line) with a blank number — a real race the integration test
 *    (queue/__tests__/document-action-queue.redis.spec.ts) caught in practice, not a theoretical one.
 *    Only once numbered does this enqueue a document-action job for this SAME action and return.
 *    Nothing is delivered yet.
 *  - called with the record already "sending" — the INTENDED caller is
 *    queue/processors/document-action.processor.ts replaying the job through `runAction`, never a
 *    normal user click (the frontend hides an in-flight record's actions — see
 *    document-list.tsx's own `isProcessing` check). But this action's own `availableWhen` is DERIVED
 *    from `transitions` (descriptors/lifecycle.ts's own header) and has to include "sending" for that
 *    worker replay to be allowed through `documents.service.ts#runAction`'s own status gate AT ALL —
 *    which means a SECOND, genuinely external caller (a double-click, a second browser tab, an HTTP
 *    client retrying after a timeout, an API-key integration) passes the exact same gate and reaches
 *    this exact branch too. A hidden-in-the-frontend action is a UI courtesy, not a server-side
 *    guarantee — this branch runs `deliver()` for whichever caller wins the in-process claim just
 *    below (`inFlightDeliveries`) AND the database claim (`claimDocumentTransition`), and refuses
 *    every other one with a named, loud `ConflictException` rather than silently delivering twice.
 *    But a caller that reaches this branch with `deliveryConfirmedAt` ALREADY set (see the guarantee
 *    above) never calls `deliver()` at all, no matter which of those it is — that is what makes a
 *    replay landing on a DIFFERENT process, after `deliver()` already succeeded once, safe. A thrown
 *    error from `deliver()` itself still propagates UNCAUGHT — never caught and turned into
 *    "send_failed" here, so BullMQ's own retry/backoff gets to run first. Only
 *    queue/mark-send-failed.ts, once every retry is exhausted, records "send_failed" — see that file's
 *    own header for why that is a deliberately SEPARATE path, and for the one case where it can fire
 *    even though delivery genuinely already succeeded.
 *
 * `deliver` is the only thing that genuinely varies by type: the quote's unconditional email
 * (quote-actions.ts), the invoice's company-configured transport (invoice-actions.ts), or
 * (credit-note-actions.ts) nothing at all — a plain status transition with no transport, no email,
 * exactly as before the async model, just reached one hop later.
 */
import { ConflictException } from '@nestjs/common';

import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { DocumentInstanceResult, ActionResult } from './action-registry';
import { archiveDeliveredArtifactsIfAny } from '../archive/archive-on-send';
import { ArchivedArtifactInput } from '../archive/hashing';
import { logger } from '@/logger/logger.service';
import { isNumberingAllowedFrom } from '../numbering/only-from';
import { TakenDocumentNumber } from '../numbering/sequence';
import { takeDocumentNumberForTransition } from '../numbering/take-number';
import { applyStockOnIssuance } from '../stock/apply-stock-on-issuance';
import {
  claimDocumentTransition,
  confirmDelivery,
  findOwnedDocument,
  updateDocumentStatus,
  upsertDocument,
} from '../persistence';
import { DocumentEventPublisher } from '../queue/document-events';
import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from '../queue/document-webhooks';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { reportOnSendIfObligated } from '../reporting/report-on-send';

/**
 * The IN-PROCESS fast path for the double-delivery guard below — a `Set` of
 * `companyId:typeId:documentId` keys currently claimed for delivery in THIS process. Checked FIRST,
 * before ever reaching the database, so the overwhelmingly common case (a genuine duplicate landing on
 * the SAME process — the default `WORKER_INLINE=true` topology, where the API and the BullMQ worker
 * share one process) is refused with no round trip at all. This is a SHORT-CIRCUIT, never the actual
 * guarantee: the real one is `persistence.ts#claimDocumentTransition`'s database-level compare-and-swap
 * (see its own header), which is what closes the gap this `Set` cannot — a horizontally-scaled
 * deployment (`WORKER_INLINE=false`, `docker-compose.scale.yml`, or either role replicated by a Helm
 * chart) runs the API and worker as SEPARATE processes, each holding its OWN `Set`, blind to the
 * other's claim, but every one of them shares the SAME `DocumentInstance` row.
 *
 * Together with `claimDocumentTransition` just below it, this pair only ever protects against TWO
 * CALLERS RACING TO START A DELIVERY — a genuinely concurrent double-click, a second tab, a second
 * worker picking up the exact same moment. Neither says anything about a caller that shows up AFTER
 * `deliver()` has already finished (successfully) once — that is what `deliveryConfirmedAt` (this
 * file's own header, and `confirmDeliveryWithRetry` below) exists for.
 */
const inFlightDeliveries = new Set<string>();

/**
 * Bounded, fast, LOCAL retries around the ONE write that turns "a real email/deposit just went out"
 * into a durable, cross-process fact (`persistence.ts#confirmDelivery`) — see this file's own header,
 * "The delivery guarantee". `deliver()` has already run by the time this is ever called: there is no
 * external side effect left to protect by holding this up, only a small, dependency-free Postgres
 * `UPDATE` standing between "delivered" and "durably KNOWN to be delivered". A handful of short, local
 * retries turn an ordinary transient blip — the exact "DB hiccup right after a successful delivery"
 * scenario this whole mechanism exists for — into a non-event, without extending a stuck job
 * indefinitely: BullMQ's own job-level `attempts` (default 3, `document-queue.dispatcher.ts`) is what
 * eventually gives up, this is only what stops "flaky for one write" from ALSO being "risks a second
 * delivery". If every attempt here still fails, the error is left to propagate uncaught — exactly like
 * a `deliver()` failure itself — so BullMQ's retry/backoff gets a chance to run the whole action again
 * (which will see `deliveryConfirmedAt` still unset and, correctly, call `deliver()` — the one
 * remaining risk window this file's own header names and does not hide).
 */
async function confirmDeliveryWithRetry(
  companyId: string,
  typeId: string,
  documentId: string,
  transportRef: string | undefined,
  channelProviderId: string | undefined,
): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      await confirmDelivery(companyId, typeId, documentId, transportRef, channelProviderId);
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      logger.warn('confirmDelivery write failed — retrying locally before giving up', {
        category: 'documents',
        details: {
          companyId,
          typeId,
          documentId,
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

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
   * Cross-border ("transfrontalier") — MAY now return the field values to persist INSTEAD OF
   * `data` (returning `undefined`, the original preflight shape, still means
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
   * Publishes a `{documentId, typeId, kind}` nudge (never the
   * resulting state, see `queue/document-events.ts`'s own header) for the SSE stream
   * (`documents.controller.ts`'s `events` route) to relay to a browser, at each of the two points
   * below where a status transition is genuinely ACQUIRED in Postgres — never before, and never for a
   * call that throws before reaching that point (see each call site's own comment). OPTIONAL,
   * deliberately: every EXISTING caller/spec of this function predates this field and must keep
   * type-checking and passing unchanged (the same "capability absent, no effect" posture
   * `DocumentActionQueueDispatcher.enqueueReport`'s own optional method already holds just above) —
   * `events?.publish(...)` below is a no-op when absent. Production wiring
   * (`documents-core.module.ts`'s `buildActionRegistry`) always threads through a real one.
   */
  events?: DocumentEventPublisher;
  /**
   * Replaces the earlier bundled `{ emitter, event }` field: the
   * event is no longer PER-TYPE (`invoice-actions.ts` used to pass `WebhookEvent.INVOICE_SENT`,
   * `quote-actions.ts` `WebhookEvent.QUOTE_SENT`, `credit-note-actions.ts` nothing at all, because the
   * schema had no `CREDIT_NOTE_SENT`) — it is now the ONE constant `WebhookEvent.DOCUMENT_SENT` every
   * type shares, dispatched right below. That collapses the field to just the emitter: an emitter
   * with nothing to dispatch through was already the only way this fired nothing, so naming the event
   * per call site bought nothing once it is always the same value — and it is exactly what hands
   * `credit-note-actions.ts` a webhook for free (see that file's own header): the type that used to be
   * the one deliberate exception now passes the identical `deps.webhooks` invoice/quote already do.
   *
   * OPTIONAL, deliberately — like `events` above, every EXISTING caller/spec of this function predates
   * it and must keep passing unchanged: "no emitter wired" reads as "no webhook for this type/
   * deployment", never a crash. Depends on the narrow `DocumentWebhookEmitter` interface
   * (queue/document-webhooks.ts), never the concrete `WebhookDispatcherService` — same
   * "interface, not class" discipline `events` already holds, for the identical testability reason.
   */
  webhooks?: DocumentWebhookEmitter;
  /**
   * Whether THIS type declares `numbering: { onEnterStatus: 'sending' }` (quote/invoice/credit-note,
   * issue #471: all three, now - see credit-note.descriptor.ts's own "Numbering" header for why the
   * credit note also needs `numberingOnlyFrom` below, which quote/invoice do not).
   * `runAsyncSendAction` cannot infer this itself - it never sees a descriptor, only a typeId
   * — so each caller passes it explicitly, reading straight off its own type's descriptor (the same
   * `INVOICE_DESCRIPTOR`-style module-level constant invoice-actions.ts already keeps for this exact
   * purpose). Numbering a type that declares none would silently invent a fact this core has no
   * business inventing, the same discipline every other numbering check in this codebase already
   * holds — see this file's own header for WHY this has to happen here at all, not left to
   * `runAction`'s own (now merely defensive) post-handler hook.
   */
  numberOnEnqueue: boolean;
  /**
   * Mirrors `DocumentTypeDescriptor.numbering.onlyFrom` (descriptors/types.ts, issue #471) - the same
   * "each caller reads its own type's descriptor and passes the fact explicitly" discipline
   * `numberOnEnqueue` above already holds, for the identical reason (this function never sees a
   * descriptor). Checked against `existing.status` - the status this record held BEFORE this very
   * call, read from `findOwnedDocument` a few lines up, i.e. exactly the "immediately before this
   * transition" moment `onlyFrom` itself is defined against. Absent (quote, invoice) means "no
   * restriction", the same default `isNumberingAllowedFrom` itself holds.
   */
  numberingOnlyFrom?: string[];
  /**
   * Optional hook run immediately after THIS call actually WINS the numbering race just above (the
   * exact same `numbered` truthy condition the stock-effect call already gates on — never for the
   * loser of a concurrent race, never for a "send_failed" retry of an already-numbered record). Exists
   * for a fact that can only be computed from the FROZEN `displayNumber` numbering just produced —
   * e.g. the invoice's own Portuguese ATCUD (`actions/atcud-issuance.ts#attachAtcudToNumberedInvoice`)
   * — which cannot run any earlier: `preflight()` above executes BEFORE a real number exists at all.
   * Kept generic here (never a `typeId === 'invoice'` branch in this file — see this module's own
   * header on why `deliver` is the only thing that is meant to vary by type) so a type with no such
   * fact (the quote, the credit note) simply never supplies one; absent is a true no-op, the same
   * "capability absent, no effect" posture `events`/`webhooks` above already hold.
   */
  onNumbered?: (ctx: {
    companyId: string;
    typeId: string;
    documentId: string;
    numbered: TakenDocumentNumber;
  }) => Promise<void>;
}

export async function runAsyncSendAction(input: RunAsyncSendInput): Promise<ActionResult> {
  const {
    companyId,
    typeId,
    documentId,
    params,
    queueDispatcher,
    deliver,
    preflight,
    numberOnEnqueue,
    numberingOnlyFrom,
    onNumbered,
    events,
    webhooks,
  } = input;
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
    // THE DOUBLE-DELIVERY GUARD — see this file's own header ("inFlightDeliveries") for the full
    // scope/limits: this branch is reached BOTH by the worker's legitimate replay AND by a second,
    // concurrent/duplicate "send" call landing on an already-"sending" record (a double-click, a
    // second browser tab, a client retrying after an HTTP timeout — this action's own `availableWhen`
    // has to include "sending" for the worker's replay to reach this branch at all, so a second HUMAN
    // call passes the exact same `isActionAvailable` gate). Without this claim, both callers would
    // call `deliver()` — a second REAL deposit/email, not a theoretical one.
    const claimKey = `${companyId}:${typeId}:${documentId}`;
    // Checked AND claimed in the SAME synchronous stretch, with no `await` in between: an `await`
    // between `.has()` and `.add()` would reopen exactly the race this guard exists to close (two
    // concurrent calls both observing an empty `Set` before either one adds itself) the moment the
    // very next line's database round trip suspends this function. Released again just below if the
    // database claim itself is refused — the in-process slot must never stay reserved for a caller the
    // database says lost.
    if (inFlightDeliveries.has(claimKey)) {
      throw new ConflictException(
        `Document "${documentId}" is already being delivered — refusing to send it a second time ` +
          'concurrently.',
      );
    }
    inFlightDeliveries.add(claimKey);

    // THE CROSS-PROCESS GUARANTEE — see `persistence.ts#claimDocumentTransition`'s own header for why
    // `existing.updatedAt` (read a moment ago, right above) makes this a genuine compare-and-swap even
    // though `fromStatuses`/`toStatus` are both "sending" here (no actual status value changes: this is
    // a RE-claim of an already-"sending" row, never a real transition). `0` means someone else — in
    // this process or another one entirely — already holds the claim; `deliver()` must never run.
    const claimedRows = await claimDocumentTransition(
      companyId,
      typeId,
      documentId,
      ['sending'],
      existing.updatedAt,
      'sending',
    );
    if (claimedRows === 0) {
      inFlightDeliveries.delete(claimKey);
      throw new ConflictException(
        `Document "${documentId}" is already being delivered — refusing to send it a second time ` +
          'concurrently.',
      );
    }

    let delivered: Awaited<ReturnType<AsyncSendDeliver>>;
    if (existing.deliveryConfirmedAt) {
      // RESUMING an interrupted delivery — see this file's own header, "The delivery guarantee".
      // `existing.deliveryConfirmedAt` (read fresh, off the SAME row this call's own claim just
      // re-acquired) already proves `deliver()` genuinely succeeded in an EARLIER attempt — this
      // process's own, or a completely different one sharing nothing but that row. Never call
      // `deliver()` again: finish whatever write never completed, using exactly what was already
      // durably recorded (`persistence.ts#confirmDelivery`) rather than inventing a fresh
      // reference/providerId from a delivery that never happened on THIS call.
      delivered = {
        message: 'Delivery already completed by an earlier attempt — finishing the pending update.',
        reference: existing.transportRef ?? undefined,
        providerId: existing.channelProviderId ?? undefined,
        // No artifacts to hand `archiveDeliveredArtifactsIfAny` below — whatever could be archived
        // already was, by the attempt that set `deliveryConfirmedAt` in the first place (archiving
        // now runs right after confirming delivery, BEFORE the "sent" write — see below).
        artifacts: undefined,
      };
    } else {
      try {
        delivered = await deliver({
          companyId,
          typeId,
          documentId,
          document: existing,
          data,
          params,
        });
      } catch (error) {
        // Released ONLY here, on a `deliver()` failure — releasing immediately (rather than after some
        // cooldown) is what lets a legitimate BullMQ retry — a genuinely failed attempt, e.g. a
        // transient network error the transport itself surfaced — proceed right away instead of being
        // wrongly told "already delivering" by its own predecessor's still-held claim.
        inFlightDeliveries.delete(claimKey);
        throw error;
      }

      // THE GUARANTEE ITSELF — see this file's own header, "The delivery guarantee". Recorded
      // DURABLY and BEFORE the "sending" -> "sent" write below is ever attempted: from this instant
      // on, NOTHING in this file may call `deliver()` again for this document, on any process, no
      // matter how many times "send" is replayed afterward. `confirmDeliveryWithRetry` absorbs a
      // handful of transient failures on its own (see its own header) before letting one propagate.
      //
      // THE ONE REMAINING RISK WINDOW, if it still throws after those internal retries — see this
      // file's own header for why it exists and why closing it needs a per-transport idempotency key
      // this codebase does not have today: `deliver()` already succeeded and durable confirmation
      // could not be written despite its own bounded retries. Deliberately left UNCAUGHT here, never
      // turned into a release of `inFlightDeliveries` the way the `deliver()` failure just above is —
      // that omission IS the fallback: it leaves this file relying on exactly the guarantee it had
      // BEFORE `deliveryConfirmedAt` existed (the claim stays HELD), so at least a retry landing on
      // THIS SAME process fails loud instead of silently calling `deliver()` again. A retry landing on
      // a DIFFERENT process is the residual gap named above, not something reachable from here.
      await confirmDeliveryWithRetry(
        companyId,
        typeId,
        documentId,
        delivered.reference,
        delivered.providerId,
      );

      // Legal archiving — moved here, BEFORE the "sent" write, specifically so it can never be skipped
      // by that write failing: `deliver()`'s own artifacts only ever exist on THIS branch (a resumed
      // completion above has none to give it), so archiving them any later than this would risk losing
      // them for good the moment the next write throws. `archiveDeliveredArtifactsIfAny` NEVER throws
      // (see its own header) — a storage/DB problem here must never undo a delivery that already
      // happened; it is instead recorded on the document itself (`lastArchiveError`) and logged
      // loudly, never silently.
      await archiveDeliveredArtifactsIfAny({ companyId, documentId, artifacts: delivered.artifacts });
    }

    const { message, reference, providerId } = delivered;
    let sent: DocumentInstanceResult;
    try {
      sent = await updateDocumentStatus(companyId, typeId, documentId, 'sent', null, reference, providerId);
    } finally {
      // Safe to release UNCONDITIONALLY here, success or failure: by this point `deliveryConfirmedAt`
      // is already durably set (either just now, above, or by an earlier attempt this very call
      // resumed from) — holding the claim through a FAILED status write no longer buys anything, since
      // a retry on ANY process will see that fact and skip `deliver()` regardless of whether THIS
      // process remembers ever trying. See this file's own header, "The delivery guarantee".
      inFlightDeliveries.delete(claimKey);
    }

    // The fact is ACQUIRED right above (Postgres already holds
    // "sent"); publishing right after, before reporting, is what lets a browser's own SSE
    // connection move a screen straight from "sending" to "sent" without a manual reload. Never
    // reached if `deliver()`, `confirmDeliveryWithRetry`, or `updateDocumentStatus` above threw — see
    // `RunAsyncSendInput.events`'s own header for why a failed write must never publish.
    await events?.publish(companyId, { documentId, typeId, kind: 'sent' });

    // The fix for what 085919bf left undone, now GENERIC rather than
    // per-type (the earlier `INVOICE_SENT`/`QUOTE_SENT`): fires `DOCUMENT_SENT`, the one event every
    // document type shares, right after the SAME acquired fact `events` just announced, and for the
    // identical reason — never earlier, never for a call that threw before reaching here. Absent for
    // a deployment with no `webhooks` wired at all (every EXISTING spec of this function) — "no
    // capability, no effect", the same posture `events` already holds. Every type opting into "send"
    // gets this for free the moment `deps.webhooks` is threaded through (see e.g.
    // `credit-note-actions.ts`'s own header on why THIS is the change that finally hands it one).
    //
    // Wrapped here, never left to propagate: `WebhookDispatcherService.dispatch` (the production
    // `webhooks`) already logs-then-RETHROWS on failure (every existing caller — `company.service.ts`,
    // `clients.service.ts` — wraps it in its own try/catch for the exact same reason), and this is the
    // one call site where "the send genuinely succeeded" must never be undone by a THIRD PARTY's
    // webhook endpoint being down. A named, loud log — never silent — is what "Never silent"
    // (echoing `report-on-send.ts`'s header) means here.
    if (webhooks) {
      try {
        await webhooks.dispatch(
          WebhookEvent.DOCUMENT_SENT,
          buildDocumentWebhookPayload(companyId, typeId, sent),
        );
      } catch (error) {
        logger.error(
          'Failed to dispatch a DOCUMENT_SENT webhook — the document was still sent successfully',
          {
            category: 'documents',
            details: {
              companyId,
              typeId,
              documentId,
              message: error instanceof Error ? error.message : String(error),
            },
          },
        );
      }
    }

    // Legal archiving now runs EARLIER — right after `confirmDeliveryWithRetry`, before the "sent"
    // write above could ever throw and skip it. See that call site's own comment for why (and this
    // file's own header, "The delivery guarantee").

    // A separate concept ("declaration"), never a transport: Hungary/NAV and Greece/myDATA
    // require the SELLER to declare the invoice's data to its tax authority AFTER issuance,
    // regardless of the channel that just delivered it — see `reporting/report-on-send.ts`'s own
    // header. Runs generically, for every type/transport, NEVER throws (like archiving above), and
    // enqueues nothing for a seller whose country has no such obligation.
    await reportOnSendIfObligated({ companyId, typeId, documentId, queueDispatcher });

    return { document: sent, changed: true, message };
  }

  if (preflight) {
    // A resolved replacement REPLACES `data` for everything below: the
    // "sending" write just after this, AND the job payload enqueued further down. `deliver()` later
    // re-resolves that SAME (already-resolved) value again — see this function's own `preflight`
    // header on why that has to be, and is, idempotent.
    const resolved = await preflight();
    if (resolved) data = resolved;
  }

  // `fromStatuses: ['draft', 'send_failed']` — every type's own SEND_TRANSITIONS starts "send" from
  // exactly these two statuses (this file's own header). Without this guard, two concurrent "send"
  // calls on the SAME draft (a double-click, a second tab) would both still read a pre-"sending"
  // status a moment ago and both reach this exact line, each persisting "sending" and each enqueueing
  // its OWN job below — the phase-2 claim further up in this function only ever protects a record
  // ALREADY "sending" against a THIRD concurrent caller, it does nothing for two callers racing to
  // become the FIRST to get there. A `ConflictException` here propagates unchanged: the caller sees
  // "the document has changed, reload" rather than a silently duplicated send.
  let sending = await upsertDocument(companyId, typeId, documentId, 'sending', data, [
    'draft',
    'send_failed',
  ]);

  // The fact is ACQUIRED right above (Postgres already holds
  // "sending"); publishing here, BEFORE numbering/enqueueing, means a browser's own SSE connection
  // sees the record leave "draft"/"send_failed" the moment it genuinely does, not once the (possibly
  // slower) job has even been queued. Never reached if `upsertDocument` above threw or if a preflight
  // rejected earlier — see `RunAsyncSendInput.events`'s own header.
  await events?.publish(companyId, { documentId: sending.id, typeId, kind: 'sending' });

  // THE FIX for the race this file's own header describes: the number must exist BEFORE the job is
  // enqueued, never after — a worker could otherwise pick the job up and render the PDF/email before
  // `documents.service.ts`'s own post-handler numbering hook ever runs. `number == null` mirrors that
  // same hook's own guard (never re-number an already-numbered record — a "send_failed" retry keeps
  // its original number, no gap, no duplicate).
  // `isNumberingAllowedFrom` (issue #471) - `existing.status` is this record's status strictly BEFORE
  // this call (read above, before the "sending" write), the exact "immediately before" moment
  // `numberingOnlyFrom` is defined against. A legacy credit note retried from "send_failed" without
  // ever having a number (issued before this feature existed) is correctly refused one here - see
  // `RunAsyncSendInput.numberingOnlyFrom`'s own header.
  if (
    numberOnEnqueue &&
    sending.number == null &&
    isNumberingAllowedFrom({ onlyFrom: numberingOnlyFrom }, existing.status)
  ) {
    const numbered = await takeDocumentNumberForTransition(companyId, typeId, sending.id);
    if (numbered) {
      sending = { ...sending, ...numbered };
      // STOCK EFFECT — this is the numbering site that actually fires for
      // the async send path (the number is taken HERE, before the job is enqueued, to win the race
      // this file's own header describes). Anchored to the SAME `if (numbered)` atomic winner as the
      // other numbering sites (documents.service.ts#runAction, send-document-email.ts), so the
      // decrement runs exactly once per document, at whichever site actually issues its number — for a
      // sent invoice, that is right here. Type-agnostic and never-throwing — see
      // `stock/apply-stock-on-issuance.ts`'s own header.
      await applyStockOnIssuance(companyId, sending);
      // See `RunAsyncSendInput.onNumbered`'s own header — a type-agnostic hook, never a branch on
      // `typeId` in this core file. Runs AFTER the stock effect, same as it, for the same reason: both
      // are anchored to `numbered` being the atomic winner of the numbering race, never to
      // `numberOnEnqueue` alone.
      if (onNumbered) await onNumbered({ companyId, typeId, documentId: sending.id, numbered });
    }
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
