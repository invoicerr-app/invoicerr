/**
 * The ONE place this module writes to the destination bucket (`BACKUP_S3_*`) — a cheap HEAD-based
 * size check `backup-runner.ts` builds its incremental diff on, then an upload when one is actually
 * needed. Mirrors `documents/archive/s3-storage.ts`'s own HEAD/PUT shape, but this module never needs
 * READ/DELETE against its OWN destination: a backup is written once and left alone — restoring from
 * it is an operator's own download + `backup-crypto-cli.ts decrypt` (see
 * `documentation/docs/user-guide/backups.md`'s "Restoring" section), not a feature this application
 * exposes over its own API.
 *
 * `upload()` never sends the plaintext: every artifact is piped through
 * `createBackupEncryptStream()` (`backup-crypto.ts`) first, and through `@aws-sdk/lib-storage`'s
 * `Upload` rather than a single `PutObjectCommand` — the multipart uploader that already ships with
 * this SDK family, chosen over hand-rolling `CreateMultipartUpload`/`UploadPart`/`CompleteMultipartUpload`
 * ourselves: it accepts a `Readable` of UNKNOWN total length (a `PutObjectCommand` body stream needs a
 * `ContentLength` known up front, which an encrypted stream piped straight from disk/S3 does not have
 * without buffering it first to measure it) and buffers only `partSize × queueSize` at a time (5 MiB ×
 * 4 by default = ~20 MiB), never the whole artifact — the entire reason this module stopped reading
 * each source file into one in-memory `Buffer` before uploading it.
 */
import type { Readable } from 'node:stream';

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Injectable } from '@nestjs/common';

import { createBackupEncryptStream } from './backup-crypto';
import { backupS3Bucket, backupS3Prefix } from './backup.constants';
import { buildS3ClientFromEnv } from './s3-client';

function isMissingObjectError(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  const statusCode = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404;
}

function requireBucket(): string {
  const bucket = backupS3Bucket();
  if (!bucket) {
    // Unreachable in production — `app.module.ts`/`worker.module.ts` only ever wire this module into
    // the graph when `isBackupEnabled()` is true (see `backup.constants.ts`'s own header). A loud,
    // named failure here rather than a silent no-op if that boot-time gate is ever bypassed.
    throw new Error('BACKUP_S3_BUCKET is not set — the backup module should never run without it.');
  }
  return bucket;
}

@Injectable()
export class BackupDestination {
  // Built lazily, once, and reused across every call this run — `backup-runner.ts` calls
  // `existingSize`/`upload` once per source FILE, and constructing a fresh `S3Client` per file (as
  // opposed to per PROCESS) would be pure overhead for zero benefit: config is read fresh only at
  // this lazy-construction point, matching the "no caching across processes, but no re-reading
  // mid-run either" balance the rest of this module already strikes for source enumeration.
  private client: S3Client | undefined;

  private getClient(): S3Client {
    if (!this.client) this.client = buildS3ClientFromEnv('BACKUP_S3');
    return this.client;
  }

  private objectKey(key: string): string {
    const prefix = backupS3Prefix();
    return prefix ? `${prefix}/${key}` : key;
  }

  /** `null` when nothing exists yet at this key — the "missing" half of the incremental diff in
   *  `backup-runner.ts`. A REAL error (wrong credentials, unreachable endpoint, …) propagates —
   *  never silently treated as "missing", which would turn a misconfigured destination into an
   *  instance that re-uploads its entire archive on every single tick without ever saying why. */
  async existingSize(key: string): Promise<number | null> {
    try {
      const result = await this.getClient().send(
        new HeadObjectCommand({ Bucket: requireBucket(), Key: this.objectKey(key) }),
      );
      return result.ContentLength ?? null;
    } catch (err) {
      if (isMissingObjectError(err)) return null;
      throw err;
    }
  }

  /**
   * Encrypts `source` (see `backup-crypto.ts`'s own header for why `BACKUP_ENCRYPTION_KEY`, a key
   * separate from `CREDENTIALS_ENCRYPTION_KEY`, and why a missing/invalid key throws HERE — before a
   * single byte reaches the network — rather than uploading in the clear) and streams the result to
   * the destination as a multipart upload. Never reads `source` or the ciphertext fully into memory:
   * `createBackupEncryptStream()` only ever holds the one chunk it was just handed, and `Upload` only
   * ever holds `partSize × queueSize` bytes (see this file's own header).
   */
  async upload(key: string, source: Readable): Promise<void> {
    const encrypted = createBackupEncryptStream();
    // `Readable#pipe` does NOT forward a source error to its destination — without this, a read
    // error partway through the source file (disk I/O failure, a dropped S3 GetObject) would leave
    // `Upload` waiting on a body stream that silently stalls instead of ever rejecting.
    source.on('error', (err) => encrypted.destroy(err));

    const upload = new Upload({
      client: this.getClient(),
      params: { Bucket: requireBucket(), Key: this.objectKey(key), Body: source.pipe(encrypted) },
    });
    await upload.done();
  }
}
