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
import { Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import { archiveRoot } from '@/modules/documents/archive/storage';

import { buildS3ClientFromEnv } from '../s3-client';
import { BackupSourceFile } from './backup-source';

const ARCHIVE_KEY_PREFIX = 'archive';

function toObjectKey(relativePath: string): string {
  return `${ARCHIVE_KEY_PREFIX}/${relativePath.split(sep).join('/')}`;
}

function listLocalArchiveSources(): BackupSourceFile[] {
  const root = archiveRoot();
  const files: BackupSourceFile[] = [];

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // The archive root not existing yet is a fresh instance that has never archived anything
      // locally — an empty pass, never an error (same posture
      // `archive/storage.ts#listArchivedArtifactKeysLocal` already holds).
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // A witness file written by `archive/storage.ts#checkArchiveStorageSharing` — operational
      // bookkeeping, not a document artifact (a fresh one lands under a new name on every boot).
      // Skipped by its own known, named prefix, mirroring how `storage.ts` itself treats it as an
      // exception rather than an ordinary archived file.
      if (entry.name.startsWith('.archive-storage-witness-')) continue;
      const size = statSync(full).size;
      files.push({
        key: toObjectKey(relative(root, full)),
        size,
        read: async () => readFileSync(full),
      });
    }
  };
  walk(root);
  return files;
}

async function listS3ArchiveSources(): Promise<BackupSourceFile[]> {
  const bucket = process.env.ARCHIVE_S3_BUCKET;
  if (!bucket) return [];

  const client = buildS3ClientFromEnv('ARCHIVE_S3');
  const files: BackupSourceFile[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key || object.Size === undefined) continue;
      const key = object.Key;
      files.push({
        key: toObjectKey(key),
        size: object.Size,
        read: async () => {
          const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          if (!result.Body) return Buffer.alloc(0);
          const bytes = await result.Body.transformToByteArray();
          return Buffer.from(bytes);
        },
      });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return files;
}

/**
 * Merges the two halves, deduplicating by object key: a document that was archived locally and later
 * migrated to S3 (or vice versa, mid-life) can legitimately surface the SAME content-hash-addressed
 * key from both listings — since that key can only ever mean identical bytes (see
 * `sources/backup-source.ts`'s own header), the second occurrence is dropped here rather than
 * uploaded twice in the same run.
 */
export async function listArchiveBackupSources(): Promise<BackupSourceFile[]> {
  const seen = new Set<string>();
  const merged: BackupSourceFile[] = [];
  for (const file of [...listLocalArchiveSources(), ...(await listS3ArchiveSources())]) {
    if (seen.has(file.key)) continue;
    seen.add(file.key);
    merged.push(file);
  }
  return merged;
}
