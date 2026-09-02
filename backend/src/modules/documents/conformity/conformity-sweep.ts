/**
 * The post-deposit conformity SWEEP's own pure decisions — split from conformity-sweep-runner.ts (the
 * Prisma/BullMQ-touching half) for the exact reason `schedules/schedule-sweep.ts` is split from its
 * own runner: "which documents are due a poll" and "what job id does THIS pass get" are both plain
 * functions of data already in hand, testable without a broker or a database
 * (conformity-sweep.spec.ts).
 *
 * ## ONE sweep, not one repeatable per document — same reasoning as the recurrence sweep
 *
 * Exactly one repeatable job (`CONFORMITY_SWEEP_JOB_NAME`, registered by
 * `queue/document-queue.dispatcher.ts`'s own `registerConformitySweepRepeatable`, on
 * `DOCUMENT_CONFORMITY_SWEEP_INTERVAL_MS`, default 60s) periodically asks "which SENT documents,
 * deposited on a pollable channel, have no terminal verdict yet" — `DocumentInstance` itself (plus
 * this document's own `DocumentAuthorityEvent` rows) is the only durable state; the repeatable is
 * just a metronome, the same division `schedule-sweep.ts`'s own header already documents at length.
 *
 * ## Eligibility — see `decideConformityAction` below
 *
 * A candidate is one of three things, decided PURELY from data the runner already fetched (no extra
 * round trip needed inside this function):
 *  - already TERMINAL (a real terminal event from the provider, or a previous 'poll:gave-up') — SKIP,
 *    nothing to do, ever again, for this document;
 *  - past the max poll age (`DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS`, default 7 days) with no terminal
 *    verdict ever observed — GAVE-UP: the runner journals the ONE synthetic 'poll:gave-up' event
 *    (idempotent — see `DocumentAuthorityEvent`'s own `@@unique`, so computing this action again on a
 *    later pass, before the runner's own write has landed, is harmless) and does NOT poll;
 *  - otherwise — POLL: the runner dispatches ONE poll job for this pass.
 *
 * ## The poll jobId: what actually makes "two overlapping sweeps -> one poll" true
 *
 * Unlike a schedule occurrence (which has its own durable, per-occurrence `nextRunAt` to key off),
 * this sweep has no stored "this document's next poll is due at ⟨T⟩" value — a document is either
 * due NOW (not yet terminal) or it isn't. The jobId therefore keys off a WALL-CLOCK WINDOW: `now`
 * bucketed to the sweep's own interval (`Math.floor(now.getTime() / intervalMs)`). Two calls given
 * the EXACT SAME `now` (the race `queue/__tests__/document-conformity-queue.redis.spec.ts` proves,
 * the identical shape `document-schedule-queue.redis.spec.ts`'s own "racing" test already uses) land
 * in the same bucket, so `buildConformityPollJobId` produces the same id for both — BullMQ's own
 * jobId idempotency (`Queue.add()` given an id that already exists resolves to the existing job,
 * never a second one) is what makes that concurrent case safe, the identical guarantee
 * `schedule-sweep.ts`'s own header already documents for its own occurrence id. The NEXT tick (a
 * different bucket) produces a DIFFERENT id, which is what lets a still-non-terminal document be
 * polled again — "successive passes without a double-fire in the SAME pass", exactly the brief this
 * task states, imitating the recurrence sweep's own motif rather than inventing a new one.
 */

import { RawAuthorityEvent } from './authority-status-poller';

/** Journaled by the runner when the max poll age is exceeded with no terminal verdict ever seen —
 *  "never an eternal poll, never a silent give-up": this row IS the loud, permanent record that
 *  polling stopped, and why. */
export const GAVE_UP_STATUS_CODE = 'poll:gave-up';

/** Journaled by the runner when a poll could not even be ATTEMPTED — the channel's credentials are
 *  missing/invalid right now (`ChannelNotConnectedError`) or the poller itself threw unexpectedly.
 *  Deliberately NOT terminal (see `decideConformityAction` below): a channel can be reconnected, so a
 *  blocked document stays eligible for the next pass, unlike a genuine gave-up. */
export const BLOCKED_STATUS_CODE = 'poll:blocked';

export const CONFORMITY_SWEEP_JOB_NAME = 'document-conformity-sweep';
export const CONFORMITY_SWEEP_JOB_ID = 'document-conformity-sweep-singleton';
export const CONFORMITY_POLL_JOB_NAME = 'document-conformity-poll';

export function readConformitySweepIntervalMs(): number {
  return parseInt(process.env.DOCUMENT_CONFORMITY_SWEEP_INTERVAL_MS ?? '60000', 10);
}

/** Default 7 days — long enough that a genuinely slow platform is never given up on prematurely, short
 *  enough that a document nobody will ever hear back about (a platform-side incident, a channel this
 *  build's own poller mis-targets) does not poll FOREVER, silently, at the sweep's own cadence. */
export function readMaxPollAgeMs(): number {
  return parseInt(process.env.DOCUMENT_CONFORMITY_MAX_POLL_AGE_MS ?? `${7 * 24 * 60 * 60 * 1000}`, 10);
}

/** See this file's own header — a wall-clock window, not a stored per-document due date. */
export function buildConformityPollJobId(documentId: string, now: Date, intervalMs: number): string {
  const window = Math.floor(now.getTime() / intervalMs);
  return `conformity-${documentId}-${window}`;
}

export interface ConformityCandidateRow {
  id: string;
  companyId: string;
  transportRef: string;
  channelProviderId: string;
  /** A proxy for "when this document was actually sent" — `DocumentInstance.updatedAt` at fetch
   *  time. Not a dedicated `sentAt` column (this task adds none): in practice, nothing touches a
   *  "sent" document's own row again except the archive write that happens SYNCHRONOUSLY, in the same
   *  call, immediately after "sent" is persisted (`archive/archive-on-send.ts`) — so this proxy is
   *  accurate to within milliseconds of the real send time, which is ample precision against a
   *  multi-day max-poll-age budget. */
  sentAt: Date;
  /** Every `statusCode` already journaled for THIS document, from ANY provider — fetched once by the
   *  runner (a join, not N extra queries) so this decision needs no database access of its own. */
  existingStatusCodes: string[];
}

export type ConformityDecision = { action: 'poll' } | { action: 'gave-up' } | { action: 'skip' };

/**
 * Pure eligibility — see this file's own header for the three outcomes. `isTerminal` is THIS
 * document's OWN provider's own terminal predicate (`AuthorityStatusPoller.isTerminal` —
 * `pollers/pdp-status-poller.ts`/`pollers/ksef-status-poller.ts` each know their own vocabulary),
 * passed in rather than looked up here so this function stays free of any registry/provider
 * knowledge at all — a plain function of data already in hand, exactly like its recurrence-sweep
 * counterpart (`schedules/schedule-sweep.ts#selectDueSchedules`).
 */
export function decideConformityAction(
  candidate: ConformityCandidateRow,
  isTerminal: (statusCode: string) => boolean,
  now: Date,
  maxPollAgeMs: number,
): ConformityDecision {
  const alreadyTerminal =
    candidate.existingStatusCodes.includes(GAVE_UP_STATUS_CODE) ||
    candidate.existingStatusCodes.some((code) => isTerminal(code));
  if (alreadyTerminal) return { action: 'skip' };

  if (now.getTime() - candidate.sentAt.getTime() > maxPollAgeMs) {
    return { action: 'gave-up' };
  }

  return { action: 'poll' };
}

/** One poll job's own data — deliberately narrow (never the whole `DocumentInstance`): the job
 *  handler re-resolves the poller and credentials fresh (`conformity-sweep-runner.ts`'s own
 *  `runPoll`), the same "never trust a value cached at enqueue time" discipline
 *  `schedule-sweep-runner.ts`'s own `runOccurrence` already holds for a schedule's re-read source
 *  document. */
export interface ConformityPollJobData {
  companyId: string;
  documentId: string;
  providerId: string;
  transportRef: string;
  /**
   * TODO_PRODUIT.md T1 / PLAN-V2 R8 — carried through so `ConformitySweepRunner.runPoll` can publish
   * a `{documentId, typeId, kind: 'authority-event'}` SSE nudge once a poll journals something new
   * (see that method's own header); the frontend's own query keys need BOTH `typeId` and `documentId`
   * to invalidate the right cache entry. OPTIONAL: several EXISTING specs construct this shape by hand
   * without it, and the publish call itself simply no-ops without a typeId (see `runPoll`'s own
   * header) — production (`ConformitySweepRunner.runSweep`, conformity-sweep-runner.ts) always sets
   * it from the candidate row it just read.
   */
  typeId?: string;
}

/** What one raw event maps to for the journal's own dedup key — re-exported here purely so
 *  `authority-events.persistence.ts` and `conformity-sweep-runner.ts` share one import path for the
 *  provider-facing shape, without either needing to import from the other. */
export type { RawAuthorityEvent };
