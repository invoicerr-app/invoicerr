/**
 * The instance file-backup sweep's own runtime — the RUNTIME half the queue's own processor calls
 * (`queue/backup.processor.ts`), the same split every other periodic sweep in this codebase already
 * holds (`ConformitySweepRunner`, `DocumentScheduleSweepRunner`, `ReminderSweepRunner`, …).
 *
 * ## Why a SECOND bucket, separate from `ARCHIVE_STORAGE=s3`
 * `documents/archive/storage.ts`'s own `ARCHIVE_STORAGE=s3` is the PRIMARY store for legal archives —
 * the one `verifyDocumentArchive` re-hashes against, the one a multi-replica deployment actually
 * NEEDS (see `deploy/helm/invoicerr/values.yaml`'s own header on why `local` silently breaks past
 * replicaCount 1). This module is a periodic, SECONDARY copy of every document-related file the
 * instance holds — legal archives (whichever provider currently holds them,
 * `sources/archive-source.ts`) and everything under `DOCUMENTS_INBOUND_DIR` (received-invoice
 * uploads, enriched-expense attachments, company logos — see `sources/inbound-source.ts`'s own header
 * for why those three are indistinguishable at this layer and backed up together) — to a bucket an
 * operator controls independently of whatever backs the primary store. This is disaster-recovery
 * insurance, never a second source of truth the application itself ever reads back from — nothing in
 * this module offers a restore path; that is an operator's own `aws s3 sync`/`mc mirror` against the
 * bucket directly.
 *
 * No database dump lives here, deliberately: Postgres has its own backup story, entirely outside this
 * module's scope — this sweeps FILES only.
 *
 * ## Incremental, by construction
 * Every source this module walks (`sources/*.ts`) is ALREADY content-hash-addressed — an archived
 * artifact's own path segment IS its `contentHash` (`archive/storage.ts#archiveDir` /
 * `s3-storage.ts`'s own key layout), and an inbound file's path IS its own SHA-256
 * (`received-invoices/storage.ts#persistInboundFile`). So the SAME key at the destination can only
 * ever hold IDENTICAL bytes — a defensive SIZE comparison (`BackupDestination#existingSize`) on top
 * of that invariant is what turns "the key already exists, same size" into "already backed up, skip",
 * without ever re-reading a byte that has not changed. Nothing here computes a fresh hash of its own:
 * the content-addressing this whole app already relies on for storage IS the fingerprint.
 *
 * ## One failed file never aborts the run
 * Every source file is uploaded (or skipped) independently, inside its own try/catch — a single
 * unreadable/corrupt file is recorded in `errors` and counted in `filesFailed`, and the sweep moves on
 * to the next one. The alternative (one failure aborting the whole sweep) would mean a single
 * transient S3 hiccup silently stops EVERY other file from ever being backed up that day — worse than
 * a partial, honestly-reported run. `status` only ever turns `FAILED` when the sweep could not even
 * START (source enumeration itself threw, e.g. the `ARCHIVE_S3_*` credentials this run also needs to
 * READ from are broken) — a run that reached the per-file loop at all is `COMPLETED`, however many of
 * those files ended up in `errors`; the caller reads `filesFailed`/`errors` for the real signal.
 */
import { Injectable } from '@nestjs/common';

import { BackupRunStatus } from '../../../prisma/generated/prisma/client';
import { BackupDestination } from './backup-destination';
import { BackupRunError, finishBackupRun, startBackupRun } from './backup-runs.persistence';
import { listArchiveBackupSources } from './sources/archive-source';
import { BackupSourceFile } from './sources/backup-source';
import { listInboundBackupSources } from './sources/inbound-source';

export interface RunBackupSweepResult {
  runId: string;
  status: BackupRunStatus;
  filesScanned: number;
  filesUploaded: number;
  filesSkipped: number;
  filesFailed: number;
  bytesUploaded: bigint;
  errors: BackupRunError[];
}

@Injectable()
export class BackupRunner {
  constructor(private readonly destination: BackupDestination) {}

  async runSweep(): Promise<RunBackupSweepResult> {
    const runId = await startBackupRun();

    let sources: BackupSourceFile[];
    try {
      sources = [...(await listArchiveBackupSources()), ...listInboundBackupSources()];
    } catch (error) {
      // Enumerating the sources themselves failed before a single file was even attempted — a single
      // named error, rather than a run silently reporting zero files scanned with no explanation. See
      // this file's own header on why this is the ONE case that reaches `FAILED`.
      return this.fail(runId, error);
    }

    let filesUploaded = 0;
    let filesSkipped = 0;
    let bytesUploaded = 0n;
    const errors: BackupRunError[] = [];

    for (const file of sources) {
      try {
        const existingSize = await this.destination.existingSize(file.key);
        if (existingSize === file.size) {
          filesSkipped += 1;
          continue;
        }
        const bytes = await file.read();
        await this.destination.upload(file.key, bytes);
        filesUploaded += 1;
        bytesUploaded += BigInt(bytes.length);
      } catch (error) {
        errors.push({ key: file.key, message: describeError(error) });
      }
    }

    const result: RunBackupSweepResult = {
      runId,
      status: 'COMPLETED',
      filesScanned: sources.length,
      filesUploaded,
      filesSkipped,
      filesFailed: errors.length,
      bytesUploaded,
      errors,
    };
    await finishBackupRun(runId, result);
    return result;
  }

  private async fail(runId: string, error: unknown): Promise<RunBackupSweepResult> {
    const result: RunBackupSweepResult = {
      runId,
      status: 'FAILED',
      filesScanned: 0,
      filesUploaded: 0,
      filesSkipped: 0,
      filesFailed: 1,
      bytesUploaded: 0n,
      errors: [{ key: '(enumerating backup sources)', message: describeError(error) }],
    };
    await finishBackupRun(runId, result);
    return result;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
