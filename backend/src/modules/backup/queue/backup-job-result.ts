/**
 * The JSON-safe shape the backup-sweep job hands back to BullMQ — the QUEUE boundary's own
 * conversion of `RunBackupSweepResult` (`../backup-runner.ts`), mirroring exactly what
 * `../backup-runs.persistence.ts#BackupRunSummary` already does at the HTTP read boundary.
 *
 * ## Why this exists at all
 * BullMQ persists a job's return value by `JSON.stringify`-ing it into the job hash the moment the
 * handler resolves, and `JSON.stringify` THROWS on a native `bigint` ("Do not know how to serialize
 * a BigInt"). `RunBackupSweepResult.bytesUploaded` is a `bigint` — necessarily, the column behind it
 * is `BigInt` (see `prisma/schema.prisma`'s own note on the `BackupRun` model) — so returning that
 * object verbatim made EVERY sweep fail at the queue level AFTER it had already finished its work
 * and persisted a `COMPLETED` run: the backups were fine and the queue reported them broken, which
 * is worse than either alone, because an operator watching failed jobs learns to ignore them.
 *
 * ## Why a decimal STRING, not `Number(...)`
 * The same representation, for the same reason, `BackupRunSummary.bytesUploaded` already chose: a
 * byte count large enough to need a `BigInt` column in the first place is also large enough to cross
 * `Number.MAX_SAFE_INTEGER`, where a JSON number silently loses precision. A string is exact, and
 * one convention for this one value beats two.
 */
import { RunBackupSweepResult } from '../backup-runner';

export type BackupSweepJobResult = Omit<RunBackupSweepResult, 'bytesUploaded'> & {
  /** Decimal string — see this file's own header on why never a JSON number. */
  bytesUploaded: string;
};

export function toBackupSweepJobResult(result: RunBackupSweepResult): BackupSweepJobResult {
  return { ...result, bytesUploaded: result.bytesUploaded.toString() };
}
