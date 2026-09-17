/**
 * Local half exercised against a real temp directory (same style
 * `documents/archive/storage.spec.ts` already uses); S3 half against a mocked SDK
 * (`jest.spyOn(S3Client.prototype, 'send')`, same style `documents/archive/s3-storage.spec.ts`
 * already uses).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { S3Client } from '@aws-sdk/client-s3';

import { listArchiveBackupSources } from './archive-source';

const ENV_KEYS = [
  'DOCUMENTS_ARCHIVE_DIR',
  'ARCHIVE_S3_BUCKET',
  'ARCHIVE_S3_REGION',
  'ARCHIVE_S3_ACCESS_KEY_ID',
  'ARCHIVE_S3_SECRET_ACCESS_KEY',
] as const;

describe('backup/sources/archive-source', () => {
  let dir: string;
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    dir = mkdtempSync(join(tmpdir(), 'documents-archive-backup-test-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = dir;
    delete process.env.ARCHIVE_S3_BUCKET;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('walks the local archive root and prefixes each key with "archive/"', async () => {
    mkdirSync(join(dir, 'doc-1', 'hash-1'), { recursive: true });
    writeFileSync(join(dir, 'doc-1', 'hash-1', 'pdf.pdf'), 'pdf bytes');

    const files = await listArchiveBackupSources();

    expect(files).toHaveLength(1);
    expect(files[0].key).toBe('archive/doc-1/hash-1/pdf.pdf');
    expect(files[0].size).toBe('pdf bytes'.length);
    await expect(files[0].read()).resolves.toEqual(Buffer.from('pdf bytes'));
  });

  it('skips checkArchiveStorageSharing witness files — bookkeeping, not a document artifact', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.archive-storage-witness-api.json'), '{}');

    expect(await listArchiveBackupSources()).toEqual([]);
  });

  it('returns [] when the archive root does not exist yet — never throws', async () => {
    rmSync(dir, { recursive: true, force: true });
    expect(await listArchiveBackupSources()).toEqual([]);
  });

  it('includes the S3 half whenever ARCHIVE_S3_BUCKET is set, alongside the local half', async () => {
    process.env.ARCHIVE_S3_BUCKET = 'archive-bucket';
    process.env.ARCHIVE_S3_REGION = 'us-east-1';
    process.env.ARCHIVE_S3_ACCESS_KEY_ID = 'ak';
    process.env.ARCHIVE_S3_SECRET_ACCESS_KEY = 'sk';

    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Contents: [{ Key: 'doc-2/hash-2/pdf.pdf', Size: 42 }],
      IsTruncated: false,
    } as never);

    const files = await listArchiveBackupSources();

    expect(files).toEqual([expect.objectContaining({ key: 'archive/doc-2/hash-2/pdf.pdf', size: 42 })]);
    sendSpy.mockRestore();
  });

  it('dedups an identical key seen from BOTH the local and S3 halves', async () => {
    mkdirSync(join(dir, 'doc-3', 'hash-3'), { recursive: true });
    writeFileSync(join(dir, 'doc-3', 'hash-3', 'pdf.pdf'), 'x');

    process.env.ARCHIVE_S3_BUCKET = 'archive-bucket';
    process.env.ARCHIVE_S3_REGION = 'us-east-1';
    process.env.ARCHIVE_S3_ACCESS_KEY_ID = 'ak';
    process.env.ARCHIVE_S3_SECRET_ACCESS_KEY = 'sk';
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Contents: [{ Key: 'doc-3/hash-3/pdf.pdf', Size: 1 }],
      IsTruncated: false,
    } as never);

    const files = await listArchiveBackupSources();

    expect(files.filter((f) => f.key === 'archive/doc-3/hash-3/pdf.pdf')).toHaveLength(1);
    sendSpy.mockRestore();
  });
});
