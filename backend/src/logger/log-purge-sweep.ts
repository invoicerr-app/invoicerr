/**
 * The `Log` table's own purge sweep — pure decisions (this file) split from the Prisma-touching half
 * (`log-purge-sweep-runner.ts`), the identical "pure core, thin persistence shell" split every other
 * sweep in this codebase already holds (`conformity-sweep.ts`/`conformity-sweep-runner.ts`,
 * `currency-rate-sweep.ts`/`currency-rate-sweep-runner.ts`, …).
 *
 * ## Why age, not database size
 * `Log` is the one table in this schema that grows without bound — everything else is either fixed
 * reference data or proportional to the documents a company actually creates, which is itself bounded
 * by that company's real activity. A SIZE trigger (shrink once the table passes N GB) is unpredictable
 * in exactly the moment the logs matter most: a busy incident is when the table grows fastest, so a
 * size-based purge would delete the freshest evidence of the very incident an operator is trying to
 * diagnose, and WHEN it fires depends on every OTHER company's write volume too, not just the one whose
 * rows get deleted. An AGE-based retention is predictable (an operator can say exactly when a row
 * disappears), explainable to a customer, and matches this product's own privacy policy commitment
 * ("connection & security data… kept only as long as needed for the security and diagnostic purpose…
 * deleted or anonymized on a rolling basis") — this sweep is less a storage optimization than the
 * mechanism that actually DISCHARGES that already-made promise, which a size trigger could not do at
 * all (it says nothing about WHEN any one row goes).
 *
 * ## Why per company, never a global sweep
 * `Log.companyId` (schema.prisma) is a plain string, not a `@relation` — a row can belong to a company
 * that no longer exists, or to no company at all (a genuinely instance-level event). Purging PER
 * COMPANY — one bounded batch per distinct `companyId` value THIS PASS finds with at least one expired
 * row, `log-purge-sweep-runner.ts#runSweep` — is what keeps one tenant's write volume from starving
 * another's: a single company generating far more log volume than every other company combined still
 * only ever consumes ITS OWN batch each pass, and every other company with its own expired backlog gets
 * its own batch in the SAME pass, not "whenever the noisy company's backlog finally empties". A single
 * unscoped `DELETE … WHERE timestamp < cutoff LIMIT N` would have no such guarantee — an ORDER BY
 * needed to make a LIMIT meaningful at all would, absent a companyId in it, simply walk one company's
 * own oldest rows before ever reaching another's.
 *
 * ## Batching and resumability — no cursor to persist
 * Each pass takes AT MOST `LOG_PURGE_BATCH_SIZE` rows per company (select-then-delete-by-id — Prisma's
 * `deleteMany` has no `take`/`orderBy` of its own, so a single unbounded `deleteMany` is not an option;
 * see `log-purge-sweep-runner.ts`). A company whose expired backlog exceeds that cap simply reappears in
 * the NEXT pass's own company list and gets its next batch then — the WHERE clause
 * (`companyId = X AND timestamp < cutoff`) is the entire "where did I leave off" state; nothing needs
 * to be written down between passes, and a pass that crashes partway through has left every company it
 * already touched correctly purged and every company it had not yet reached untouched — exactly as if
 * it had simply not run that tick.
 */

/** How many rows ONE company's own batch deletes AT MOST, per sweep pass — never the whole backlog in
 *  one statement (locks and bloats the table, see this file's own header) and never so small that a
 *  company with a large one-time backlog (e.g. this feature's own first rollout onto a long-unpruned
 *  instance) takes an impractical number of passes to catch up. Same "a plain, exported, non-env
 *  constant" shape `billing/customer-provisioning.ts`'s own `CUSTOMER_PROVISIONING_BATCH_SIZE` already
 *  holds for an identical "bounded round-trip, not a tunable knob" reason. */
export const LOG_PURGE_BATCH_SIZE = 1000;

export const LOG_PURGE_SWEEP_JOB_NAME = 'log-purge-sweep';
export const LOG_PURGE_SWEEP_JOB_ID = 'log-purge-sweep-singleton';

/** Default 1 hour — a retention BOUNDARY is day-granularity (`LOG_RETENTION_DAYS`), so hourly is
 *  already far more resolution than the product needs for any one row's own deletion instant (the
 *  identical cadence argument `billing-queue.constants.ts#readBillingLifecycleSweepIntervalMs` makes
 *  for ITS OWN day-granularity boundaries) — chosen for steady throughput through an ordinary day's
 *  worth of newly-expired rows, not for how quickly a single row disappears once it crosses the
 *  cutoff. */
export function readLogPurgeSweepIntervalMs(): number {
  return parseInt(process.env.LOG_PURGE_SWEEP_INTERVAL_MS ?? `${60 * 60 * 1000}`, 10);
}

/** `LOG_RETENTION_DAYS` — how many days of `Log` history a company keeps before this sweep purges the
 *  rest. Default 90: long enough to cover a slow-burn support investigation ("this started acting up a
 *  couple of months ago") without keeping application-log rows indefinitely, which this product's own
 *  privacy policy already commits NOT to do (see this file's own header). `0` or a negative value
 *  disables the sweep entirely — the explicit "keep everything" escape hatch a self-hosted operator who
 *  wants no automatic deletion at all can reach for, checked by `isLogPurgeEnabled` below rather than
 *  by every call site re-deriving the same `<= 0` test. */
export function readLogRetentionDays(): number {
  return parseInt(process.env.LOG_RETENTION_DAYS ?? '90', 10);
}

/** `false` for `0`, a negative value, or anything `readLogRetentionDays` failed to parse into a
 *  positive number (`parseInt` itself returns `NaN` for a non-numeric value, and `NaN > 0` is always
 *  `false`) — every one of those reads as "never purge", never as "purge everything immediately" or
 *  a crash. */
export function isLogPurgeEnabled(retentionDays: number): boolean {
  return retentionDays > 0;
}

/** Midnight-agnostic, wall-clock cutoff: `now` minus `retentionDays` whole days, in milliseconds —
 *  deliberately NOT truncated to a calendar day boundary, since a `Log` row's own `timestamp` is a
 *  precise instant (`DateTime @default(now())`, schema.prisma) and "kept for N days" reads most
 *  literally as "kept for N x 24h from the moment it was written", not "kept until the Nth following
 *  midnight" (which would let a row written at 23:59 outlive one written at 00:01 the same day by
 *  almost a full extra day for no reason). `now` is a parameter — never `new Date()` inline — for the
 *  same reason every other sweep's own `runSweep(now: Date = new Date())` takes one: a test drives a
 *  deterministic clock instead of racing the real one. */
export function computeLogPurgeCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
