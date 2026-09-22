/**
 * The metronome for the storage-erasure journal — pure decisions here (the cadence and the job
 * constants), the Prisma-touching half in `storage-erasure-sweep-runner.ts`: the same "pure core, thin
 * persistence shell" split every other sweep in this codebase already holds
 * (`conformity-sweep.ts`/`conformity-sweep-runner.ts`, `src/logger/log-purge-sweep.ts`, …).
 *
 * ## The gap this closes
 * `company-storage-erasure.ts` already erases every byte a deleted company owned, and already leaves
 * pending anything a statute still requires kept — carrying the date the obligation ends and the
 * citation that imposes it (⚖ that file's own header). What it had no second caller for was the
 * AFTERWARDS: `drainStorageErasureJournal` ran at deletion time and nowhere else, so a row whose
 * `retentionUntil` falls two years out simply stayed on the volume for ever. Nothing was ever going to
 * come back for it — by then the company row, the documents and the archive rows are all gone, which is
 * exactly why the journal exists in the first place, and every one of the drain's own properties
 * (durable inventory, idempotent, restartable, never throws) was written for a caller that did not
 * exist yet. This sweep is that caller.
 *
 * It is also what makes a promise already made to customers — those files ARE erased once the
 * retention period passes, not merely eligible to be — true by mechanism rather than by an operator
 * remembering, the same relationship the `Log` purge sweep has to this product's own stated log
 * retention (`src/logger/log-purge-sweep.ts`'s own header).
 *
 * ## Why a day, and why a day is already generous
 * The boundary this sweep watches is `PendingStorageErasure.retentionUntil` — a date produced by a
 * statutory duration measured in YEARS, counted from an origin the law itself names (⚖ `retention/`).
 * A daily pass therefore notices that boundary within 24h of it passing, which is finer resolution than
 * the obligation it discharges has to begin with: being a day late erasing bytes a statute held for six
 * to ten years is legally, contractually and practically nil, while being a day EARLY would be the
 * actual defect. Sweeping more often would only re-scan a journal that is empty on the overwhelming
 * majority of instances — rows exist only between a company deletion and its own inline drain, plus
 * whatever a statute is currently holding.
 *
 * That is the same reasoning the `Log` purge makes for its own hourly cadence (a day-granularity
 * boundary needs a cadence chosen for steady throughput, never for how fast a single row disappears),
 * one order of magnitude coarser because this boundary is one order of magnitude coarser.
 */

export const STORAGE_ERASURE_SWEEP_JOB_NAME = 'storage-erasure-sweep';
export const STORAGE_ERASURE_SWEEP_JOB_ID = 'storage-erasure-sweep-singleton';

/** Default 24h — see this file's own header for why a day is already far more often than a
 *  years-long retention boundary needs. Configurable the same way every sibling sweep's interval is
 *  (`readReminderSweepIntervalMs`, `readLogPurgeSweepIntervalMs`, …): one env var, read fresh on every
 *  call so a test can drive it, never cached at module level. */
export function readStorageErasureSweepIntervalMs(): number {
  return parseInt(process.env.STORAGE_ERASURE_SWEEP_INTERVAL_MS ?? `${24 * 60 * 60 * 1000}`, 10);
}
