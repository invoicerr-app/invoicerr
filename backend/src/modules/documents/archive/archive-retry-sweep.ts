/**
 * The metronome and the pure decisions of the legal archive's retry — the Prisma-touching half is
 * `archive-retry-sweep-runner.ts`, the same "pure core, thin persistence shell" split every other
 * sweep in this codebase already holds (`storage-erasure-sweep.ts`/`-runner.ts`,
 * `conformity-sweep.ts`/`-runner.ts`, `src/logger/log-purge-sweep.ts`, …).
 *
 * ## The gap this closes
 *
 * `archive-on-send.ts` may not throw — the delivery it archives has already genuinely happened and
 * nothing may call that back into question (see that file's own header, which is right about this).
 * But "never propagates" had silently become "never tried again": the ONE mechanism that could have
 * re-run the archiving step is the send job's own BullMQ retry, and it cannot reach it. A replayed
 * "send" lands on `actions/async-send.ts`'s phase-2 with `deliveryConfirmedAt` already set, takes the
 * resume branch, and hands archiving `artifacts: undefined` — the branch asserts, in a comment, that
 * "whatever could be archived already was", which is exactly the one thing that is false when
 * archiving is what failed. Downstream of that, "send" is only available from "draft"/"send_failed"
 * (each type's own SEND_TRANSITIONS), so a document that was delivered and not archived sits in
 * "sent" and can never re-enter that path either. The result: an invoice the customer believes is
 * preserved for the six-to-ten years its country requires (⚖ `retention/`), with no archive, no
 * retry, and nothing to see but one server log line.
 *
 * ## Why a sweep, and why the bytes are journaled rather than re-derived
 *
 * A delivered artifact is not re-derivable from the document row: what was archived is what was
 * actually SENT — the PDF attached to the mail, the Factur-X deposited at the PDP, the FA(3) pushed
 * to KSeF — produced once, inside the send job, by a pipeline nothing re-runs afterwards (and, for a
 * PAdES-signed PDF, not reproducible byte-for-byte at all). So the retry cannot start from the
 * document; it has to start from the bytes, which is why `PendingDocumentArchive` (schema.prisma)
 * carries them. The sweep is then the ordinary shape this queue already has for "work that must
 * survive the process that discovered it": one cluster-wide repeatable, one consumer per tick,
 * cadence a property of the deployment rather than of how many replicas are running.
 *
 * ## The schedule, and why it is bounded in SILENCE but not in ATTEMPTS
 *
 * Retries back off exponentially from `ARCHIVE_RETRY_BASE_DELAY_MS`, capped at
 * `ARCHIVE_RETRY_MAX_DELAY_MS`, and never stop: giving up would mean deleting the journal row, and
 * that row holds the only surviving copy of an artifact a tax authority is entitled to ask for. An
 * hourly retry against a broken bucket costs one failing request; abandoning it costs the archive.
 *
 * What IS bounded is how long this can stay a machine's problem. After
 * `ARCHIVE_RETRY_ESCALATE_AFTER_ATTEMPTS` failed attempts the row is escalated ONCE: an error-level
 * `Log` row naming the document, and a `DocumentInstance.lastArchiveError` rewritten from a bare
 * driver message into a sentence that says this document has no archive. That threshold is set where
 * it is so an ordinary transient outage — the S3 503 that lasts ten minutes, the volume that is full
 * until the next rotation — recovers inside the schedule and escalates nothing at all. A failure that
 * is visible but harmless is how people learn to ignore failures (the same lesson
 * `queue/backup-job-result.ts` carries for the backup sweep, whose work had succeeded while the queue
 * reported it broken); an archive that is genuinely missing half an hour after a delivery is not
 * harmless, and is the only case that gets loud.
 */

export const ARCHIVE_RETRY_SWEEP_JOB_NAME = 'archive-retry-sweep';
export const ARCHIVE_RETRY_SWEEP_JOB_ID = 'archive-retry-sweep-singleton';

/** Default 5 min — the resolution at which a due row is noticed. Finer than the backoff below at its
 *  shortest, so the schedule is decided by `nextAttemptAt` and not by the tick. Configurable the same
 *  way every sibling sweep's interval is, read fresh on every call so a test can drive it, never
 *  cached at module level. */
export function readArchiveRetrySweepIntervalMs(): number {
  return parseInt(process.env.ARCHIVE_RETRY_SWEEP_INTERVAL_MS ?? `${5 * 60 * 1000}`, 10);
}

/**
 * How many rows one pass may attempt. Bounded — unlike `storage-erasure-sweep-runner.ts`, which
 * deliberately drains its WHOLE pending set — because a row here carries the artifact BYTES: an
 * instance that kept sending through a two-hour outage can hold thousands of pending PDFs, and
 * loading all of them into one pass's memory to retry them would turn a recoverable outage into an
 * out-of-memory worker. The bound is safe against starvation because the query is ordered by
 * `nextAttemptAt` ascending: the oldest deadline is always served first, and a row not reached this
 * pass only falls further past due, which moves it to the head of the next one.
 */
export function readArchiveRetryBatchSize(): number {
  return parseInt(process.env.ARCHIVE_RETRY_SWEEP_BATCH ?? '50', 10);
}

/** First retry one minute after the failure, doubling each time. */
export function readArchiveRetryBaseDelayMs(): number {
  return parseInt(process.env.ARCHIVE_RETRY_BASE_DELAY_MS ?? `${60 * 1000}`, 10);
}

/** The ceiling the doubling stops at — an hour. Past escalation this is the steady cadence a row
 *  keeps for as long as the store stays broken. */
export function readArchiveRetryMaxDelayMs(): number {
  return parseInt(process.env.ARCHIVE_RETRY_MAX_DELAY_MS ?? `${60 * 60 * 1000}`, 10);
}

/** Attempts (INCLUDING the one at send time) after which a row stops being treated as a transient
 *  outage — see this file's own header. Five, with the default backoff, puts the escalation about
 *  half an hour after the delivery. */
export function readArchiveRetryEscalateAfterAttempts(): number {
  return parseInt(process.env.ARCHIVE_RETRY_ESCALATE_AFTER_ATTEMPTS ?? '5', 10);
}

/**
 * When the row that has just failed for the `attempts`-th time may be tried again — exponential in
 * the number of attempts already made, capped. Pure, and given `now` explicitly (never `new Date()`
 * inline) for the same reason every sweep in this codebase takes its clock as a parameter.
 */
export function nextArchiveRetryAt(now: Date, attempts: number): Date {
  const base = readArchiveRetryBaseDelayMs();
  const cap = readArchiveRetryMaxDelayMs();
  // `attempts - 1` so the FIRST retry (scheduled by the send-time failure, which already counts as
  // attempt 1) waits one base delay rather than two.
  const exponent = Math.max(0, attempts - 1);
  // Clamped before the multiplication: 2 ** 1024 is `Infinity`, and `Infinity * base` would produce
  // an invalid Date rather than the capped delay this is supposed to yield for a long-broken store.
  const delay = exponent > 40 ? cap : Math.min(cap, base * 2 ** exponent);
  return new Date(now.getTime() + delay);
}

/** Whether a row that has now failed `attempts` times has crossed the escalation threshold. The
 *  runner only escalates a row whose `escalatedAt` is still null, so this answering true for every
 *  later attempt too costs nothing and keeps the threshold changeable without re-escalating rows. */
export function shouldEscalateArchiveRetry(attempts: number): boolean {
  return attempts >= readArchiveRetryEscalateAfterAttempts();
}

/**
 * What `DocumentInstance.lastArchiveError` says once a row escalates — a full sentence rather than
 * the bare driver message it held until then, because THIS is the text a company reads on its own
 * document screen and it has to state the fact, not a symptom: this document was delivered and is
 * not preserved. Names the document by its own number when it has one (the invoice the customer will
 * look for), and quotes the underlying error last so the cause is still there for whoever can act on
 * it.
 *
 * Deliberately NOT localized: `lastArchiveError` is shown verbatim (the same convention
 * `lastActionError` already follows — see `document-detail.tsx`), and the frontend wraps it in its
 * own translated label.
 */
export function buildEscalatedArchiveError(input: {
  displayNumber: string | null | undefined;
  attempts: number;
  firstFailedAt: Date;
  lastError: string;
}): string {
  const named = input.displayNumber ? `Document ${input.displayNumber}` : 'This document';
  return (
    `${named} was delivered but has NO legal archive: ${input.attempts} archiving attempts have ` +
    `failed since ${input.firstFailedAt.toISOString()}. Retries continue automatically, but the ` +
    `archive store needs attention. Last error: ${input.lastError}`
  );
}
