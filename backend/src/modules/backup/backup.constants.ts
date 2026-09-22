/**
 * Env-var surface for the instance file-backup module (`backend/src/modules/backup`) — a periodic
 * sweep that copies every document-related file this instance holds (legal archives, plus everything
 * under `DOCUMENTS_INBOUND_DIR`) to a SECONDARY, dedicated S3 bucket, entirely separate from
 * `documents/archive/storage.ts`'s own `ARCHIVE_STORAGE=s3` (the PRIMARY store — see
 * `backup-runner.ts`'s own header for the full "why two buckets" account). Read fresh on every call,
 * never cached at module load — the same discipline `archive/storage.ts#archiveRoot()` already
 * documents, for the same reason: a test (or a live process reconfigured at runtime) must see a
 * changed env var take effect on the very next call, not on the next restart.
 */

export function backupS3Bucket(): string | undefined {
  return process.env.BACKUP_S3_BUCKET || undefined;
}

/**
 * The module is entirely inert without a destination bucket — `app.module.ts`/`worker.module.ts`
 * both read this ONCE, at boot, to decide whether the backup module enters the graph at all (no
 * controller, no BullMQ queue, no repeatable — the same "invisible and inert" contract
 * `app.module.ts`'s own `billingEnabled` already holds for hosted billing). Re-read at every boot,
 * never at runtime after that: unlike `ARCHIVE_STORAGE` (re-read per call because a single process
 * dispatches per-write), whether this whole module exists in the DI graph is a boot-time decision by
 * construction — Nest does not support adding/removing a module from an already-running app.
 */
export function isBackupEnabled(): boolean {
  return !!backupS3Bucket();
}

/** Stripped of any trailing slash so `backup-destination.ts` can always join it with `/` itself,
 *  rather than trusting every call site to avoid a doubled-up separator. `''` (never `undefined`)
 *  when unset — the common case, an unprefixed bucket. */
export function backupS3Prefix(): string {
  const raw = process.env.BACKUP_S3_PREFIX;
  if (!raw) return '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * Default: every day at 03:00 UTC — a sober cadence for a SECONDARY copy of data that already has a
 * primary (local disk, or `ARCHIVE_STORAGE=s3`'s own bucket) and, for archived artifacts, is
 * WORM/immutable once written in the first place. BullMQ's own cron support
 * (`repeat: { pattern, tz }`, `queue/backup-queue.dispatcher.ts`) is used directly — never
 * `@nestjs/schedule`'s cron decorators and never a hand-rolled distributed lock: this repo's own
 * CLAUDE.md is explicit that every periodic job in `documents/queue` is a BullMQ repeatable with
 * idempotent, cluster-wide registration instead, and this module follows the identical discipline.
 */
export function readBackupScheduleCron(): string {
  return process.env.BACKUP_S3_SCHEDULE ?? '0 3 * * *';
}
