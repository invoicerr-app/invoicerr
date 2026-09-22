/**
 * Enumerates every file this instance holds under the shared inbound-file store — received-invoice
 * uploads (`received-invoices/storage.ts`), enriched-expense attachments
 * (`attachments/attachments.service.ts` reuses the exact same `persistInboundFile`/`readInboundFile`
 * pair), and company logos/branding (`rendering/branding/logo-storage.ts`, same reuse again). There is
 * no way to tell the three apart at this layer — a bare `<companyId>/<sha256>.<ext>` path/key carries
 * no marker of which of the three wrote it — so this walker does not try: it backs up EVERYTHING the
 * store holds, which is exactly "every document-related file the instance holds" outside the legal
 * archive.
 *
 * LOCAL and S3 alike — the same "both providers, best-effort" union `sources/archive-source.ts`
 * already documents its own reason for (an operator who migrated `INBOUND_STORAGE` mid-life has real
 * files sitting in BOTH places, and — unlike the archive — `received-invoices/storage.ts`'s own
 * dispatch is on the CURRENT env var for BOTH read and write, so a file stranded on the
 * provider NOT currently active would otherwise never be backed up again once the switch happened).
 * Local half is UNCONDITIONAL (cheap, no network call); S3 half runs whenever `INBOUND_S3_BUCKET` is
 * set, regardless of the CURRENT `INBOUND_STORAGE` value — same reasoning
 * `documents/archive/storage.ts#listArchivedArtifactKeys`'s own header gives for its own local half.
 */
import { createReadStream, Dirent, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import { inboundRoot } from '@/modules/documents/received-invoices/storage';

import { buildS3ClientFromEnv } from '../s3-client';
import { BackupSourceFile } from './backup-source';

const INBOUND_KEY_PREFIX = 'inbound';

function toObjectKey(relativePath: string): string {
  return `${INBOUND_KEY_PREFIX}/${relativePath.split(sep).join('/')}`;
}

function listLocalInboundSources(): BackupSourceFile[] {
  const root = inboundRoot();
  const files: BackupSourceFile[] = [];

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // The root (or a company subdirectory) not existing yet is a fresh instance that has never
      // stored an inbound file locally — an empty backup pass, never an error.
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const size = statSync(full).size;
      // `split(sep).join('/')`: this app only ever runs in Linux containers (`sep === '/'`), but a
      // developer running vitest on another OS must still get a well-formed S3 key out of this —
      // never a bare, OS-dependent `path.relative` result passed straight through.
      const key = toObjectKey(relative(root, full));
      // `async` even though opening the local stream is synchronous — `BackupSourceFile.read` is a
      // `Promise` by contract (the S3 half below genuinely awaits a network call), so
      // `backup-runner.ts` can treat every source the same way regardless of which walker produced
      // it. A stream, never `readFileSync` — a company's document archive is not a string, see
      // `backup-source.ts`'s own header.
      files.push({ key, size, read: async () => createReadStream(full) });
    }
  };
  walk(root);
  return files;
}

async function listS3InboundSources(): Promise<BackupSourceFile[]> {
  const bucket = process.env.INBOUND_S3_BUCKET;
  if (!bucket) return [];

  const client = buildS3ClientFromEnv('INBOUND_S3');
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
          // See `archive-source.ts`'s identical S3 half for why this is the raw `Body` stream, never
          // `transformToByteArray()` (which reads the whole object into memory first).
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
 * Merges the two halves, deduplicating by object key — same reasoning
 * `sources/archive-source.ts#listArchiveBackupSources`'s own header gives: a key that surfaces from
 * BOTH listings can only ever mean identical bytes (content-hash-addressed by construction), so the
 * second occurrence is dropped here rather than uploaded twice in the same run.
 */
export async function listInboundBackupSources(): Promise<BackupSourceFile[]> {
  const seen = new Set<string>();
  const merged: BackupSourceFile[] = [];
  for (const file of [...listLocalInboundSources(), ...(await listS3InboundSources())]) {
    if (seen.has(file.key)) continue;
    seen.add(file.key);
    merged.push(file);
  }
  return merged;
}
