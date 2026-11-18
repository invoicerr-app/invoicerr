/**
 * The one walker both backup sources (`archive-source.ts`, `inbound-source.ts`) run: a LOCAL half
 * over a store's root directory and an S3 half over its bucket, merged and deduplicated by object
 * key. The two sources differ only in their root, their key prefix, their env-var family and the
 * archive's witness file; read each source's own header for why it lists both providers.
 *
 * Sizes are captured at LISTING time: the incremental diff (`backup-runner.ts`) needs them to decide
 * "already backed up" without ever re-reading bytes or paying for a HEAD per file afterward.
 */
import { createReadStream, Dirent, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import { buildS3ClientFromEnv } from '../s3-client';
import { BackupSourceFile } from './backup-source';

export interface LocalAndS3SourceConfig {
  /** The store's local root, IMPORTED from the store itself, never a re-guessed default, so a test
   *  repointing the store's directory env var is honoured here too. */
  root: string;
  /** First segment of every backup object key (`archive`, `inbound`). */
  keyPrefix: string;
  /** The store's bucket, or undefined when no bucket is configured (the S3 half is then skipped). */
  bucket: string | undefined;
  /** The env-var family whose credentials READ the store's bucket. */
  s3EnvPrefix: 'ARCHIVE_S3' | 'INBOUND_S3';
  /** Local file names that are not store content and must not be backed up. */
  skipLocalFile?: (name: string) => boolean;
}

function listLocalSources(config: LocalAndS3SourceConfig): BackupSourceFile[] {
  const { root } = config;
  const files: BackupSourceFile[] = [];

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // The root (or a subdirectory) not existing yet is a fresh instance that has never stored
      // anything locally: an empty backup pass, never an error (same posture
      // `archive/storage.ts#listArchivedArtifactKeysLocal` already holds).
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (config.skipLocalFile?.(entry.name)) continue;
      const size = statSync(full).size;
      // `split(sep).join('/')`: this app only ever runs in Linux containers (`sep === '/'`), but a
      // developer running vitest on another OS must still get a well-formed S3 key out of this,
      // never a bare, OS-dependent `path.relative` result passed straight through.
      const key = `${config.keyPrefix}/${relative(root, full).split(sep).join('/')}`;
      // `async` even though opening the local stream is synchronous: `BackupSourceFile.read` is a
      // `Promise` by contract (the S3 half below genuinely awaits a network call), so
      // `backup-runner.ts` can treat every source the same way regardless of which walker produced
      // it. A stream, never `readFileSync`: a company's document archive is not a string, see
      // `backup-source.ts`'s own header.
      files.push({ key, size, read: async () => createReadStream(full) });
    }
  };
  walk(root);
  return files;
}

async function listS3Sources(config: LocalAndS3SourceConfig): Promise<BackupSourceFile[]> {
  const { bucket } = config;
  if (!bucket) return [];

  const client = buildS3ClientFromEnv(config.s3EnvPrefix);
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
        key: `${config.keyPrefix}/${key.split(sep).join('/')}`,
        size: object.Size,
        read: async () => {
          const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          // `result.Body` is already a Node `Readable` at runtime (the SDK's own stream mixin): no
          // `transformToByteArray()`/`Buffer.from` here, since that helper reads the ENTIRE object
          // into memory before returning, exactly what streaming this file into
          // `backup-destination.ts#upload` exists to avoid.
          if (!result.Body) throw new Error(`GetObject ${key} returned no body`);
          return result.Body as Readable;
        },
      });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return files;
}

/**
 * Merges the two halves, deduplicating by object key: a file stored locally and later migrated to S3
 * (or vice versa, mid-life) can legitimately surface the SAME content-hash-addressed key from both
 * listings. Since that key can only ever mean identical bytes (see `sources/backup-source.ts`'s own
 * header), the second occurrence is dropped here rather than uploaded twice in the same run.
 */
export async function listLocalAndS3Sources(config: LocalAndS3SourceConfig): Promise<BackupSourceFile[]> {
  const seen = new Set<string>();
  const merged: BackupSourceFile[] = [];
  for (const file of [...listLocalSources(config), ...(await listS3Sources(config))]) {
    if (seen.has(file.key)) continue;
    seen.add(file.key);
    merged.push(file);
  }
  return merged;
}
