/**
 * Enumerates every archived legal-document artifact this instance holds, LOCAL and S3 alike — the
 * same "both providers, best-effort" union `documents/archive/storage.ts#listArchivedArtifactKeys`
 * already documents its own reason for (an operator who migrated `ARCHIVE_STORAGE` mid-life has real
 * archives sitting in BOTH places). This module does not reuse that function directly: it discards
 * each object's SIZE, which the incremental diff (`backup-runner.ts`) needs to decide "already
 * backed up" without ever re-reading bytes — so this file re-derives the same two listings itself,
 * capturing size at LISTING time instead of paying for a second round trip (a HEAD per file)
 * afterward.
 *
 * Local half: walks `archiveRoot()` (`documents/archive/storage.ts`) — an IMPORTED root, never a
 * re-guessed default, so a test repointing `DOCUMENTS_ARCHIVE_DIR` is honoured here too. Included
 * UNCONDITIONALLY (cheap, no network call), the identical reasoning `listArchivedArtifactKeys`'s own
 * header gives for its own local half.
 *
 * S3 half: included whenever `ARCHIVE_S3_BUCKET` is set, regardless of the CURRENT `ARCHIVE_STORAGE`
 * value — same "the bucket outlives today's env var" reasoning that file's own header gives. Uses
 * `ARCHIVE_S3_*` credentials (`s3-client.ts#buildS3ClientFromEnv('ARCHIVE_S3')`) to READ from the
 * PRIMARY archive bucket — this is the ONLY file in this whole module that ever talks to that bucket;
 * every other file only ever talks to `BACKUP_S3_*`, the destination.
 */
import { archiveRoot } from '@/modules/documents/archive/storage';

import { BackupSourceFile } from './backup-source';
import { listLocalAndS3Sources } from './local-and-s3-source';

/** Local root and `ARCHIVE_S3_*` bucket, merged and deduplicated by `local-and-s3-source.ts`. */
export async function listArchiveBackupSources(): Promise<BackupSourceFile[]> {
  return listLocalAndS3Sources({
    root: archiveRoot(),
    keyPrefix: 'archive',
    bucket: process.env.ARCHIVE_S3_BUCKET,
    s3EnvPrefix: 'ARCHIVE_S3',
    // A witness file written by `archive/storage.ts#checkArchiveStorageSharing`: operational
    // bookkeeping, not a document artifact (a fresh one lands under a new name on every boot).
    // Skipped by its own known, named prefix, mirroring how `storage.ts` itself treats it as an
    // exception rather than an ordinary archived file.
    skipLocalFile: (name) => name.startsWith('.archive-storage-witness-'),
  });
}
