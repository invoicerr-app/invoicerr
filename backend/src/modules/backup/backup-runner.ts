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
 * insurance, never a second source of truth the application itself ever reads back from — this SWEEP
 * never restores anything automatically; getting objects back out of the bucket is still an
 * operator's own `aws s3 sync`/`mc mirror`. What this module DOES provide is the other half of that:
 * every object it writes is encrypted (`backup-crypto.ts`), and the same file ships the standalone
 * decrypt CLI (`backup-crypto-cli.ts`) an operator runs against whatever they pulled out of the
 * bucket — see `documentation/docs/user-guide/backups.md`'s "Restoring" section for the full
 * procedure.
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
 * READ from are broken — OR `BACKUP_ENCRYPTION_KEY` itself is missing/invalid, checked before either,
 * see below) — a run that reached the per-file loop at all is `COMPLETED`, however many of those files
 * ended up in `errors`; the caller reads `filesFailed`/`errors` for the real signal.
 *
 * ## Encryption key checked FIRST, before a single source is even listed
 * `isBackupEncryptionAvailable()` (`backup-crypto.ts`) gates the whole sweep, the same "fail loud
 * before doing any real work" shape source-enumeration failure already has below. This is deliberate,
 * not incidental: every file this sweep would otherwise upload gets encrypted with the SAME key
 * (`BACKUP_ENCRYPTION_KEY`), so a missing/invalid key is not a per-file problem the existing
 * one-failure-never-aborts policy should absorb — it would just mean the SAME error, once per file,
 * drowning out any REAL per-file failure that happened to occur in the same run. One clear FAILED run
 * with one named error is the loud, honest signal; `backup-crypto.ts`'s own header explains why a
 * missing key fails the run rather than silently disabling the module or uploading in the clear.
 */
import { Injectable } from '@nestjs/common';

import { BackupRunStatus } from '../../../prisma/generated/prisma/client';
import { BACKUP_ENCRYPTION_OVERHEAD_BYTES, isBackupEncryptionAvailable } from './backup-crypto';
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

    if (!isBackupEncryptionAvailable()) {
      // See this file's own header ("Encryption key checked FIRST") and `backup-crypto.ts`'s header
      // for why this is checked before enumerating a single source, and why it fails the run rather
      // than uploading in the clear or silently disabling the module.
      return this.fail(
        runId,
        new Error('BACKUP_ENCRYPTION_KEY is missing or invalid — refusing to upload backups in the clear.'),
        '(backup encryption key)',
      );
    }

    let sources: BackupSourceFile[];
    try {
      sources = [...(await listArchiveBackupSources()), ...(await listInboundBackupSources())];
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
        // The destination holds the ENCRYPTED artifact — always `BACKUP_ENCRYPTION_OVERHEAD_BYTES`
        // (the fixed IV+tag envelope, `backup-crypto.ts`) larger than the source's own plaintext
        // size. Comparing against the raw `file.size` here would re-upload every single file on every
        // single run, forever, since the destination size could then never equal it.
        if (existingSize === file.size + BACKUP_ENCRYPTION_OVERHEAD_BYTES) {
          filesSkipped += 1;
          continue;
        }
        const stream = await file.read();
        await this.destination.upload(file.key, stream);
        filesUploaded += 1;
        // The source's own plaintext size, known up front from listing — never measured from the
        // (streamed, never fully buffered) upload itself.
        bytesUploaded += BigInt(file.size);
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

  private async fail(
    runId: string,
    error: unknown,
    key = '(enumerating backup sources)',
  ): Promise<RunBackupSweepResult> {
    const result: RunBackupSweepResult = {
      runId,
      status: 'FAILED',
      filesScanned: 0,
      filesUploaded: 0,
      filesSkipped: 0,
      filesFailed: 1,
      bytesUploaded: 0n,
      errors: [{ key, message: describeError(error) }],
    };
    await finishBackupRun(runId, result);
    return result;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
