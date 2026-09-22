/**
 * Unit coverage for `backup-destination.ts` — the AWS SDK is MOCKED throughout (no real network, no
 * MinIO container), the same `vi.spyOn(S3Client.prototype, 'send')` style
 * `documents/archive/s3-storage.spec.ts` already uses. See `backup-destination.live.spec.ts` for the
 * real round-trip against a real MinIO container — including the one thing this mocked suite CANNOT
 * prove: that what actually reaches the wire decrypts back with only the key and the bytes.
 */

import { vi, type MockInstance } from 'vitest';

import { Readable } from 'node:stream';

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { BACKUP_ENCRYPTION_OVERHEAD_BYTES, createBackupDecryptStream } from './backup-crypto';
import { BackupDestination } from './backup-destination';

const ENV_KEYS = [
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_PREFIX',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_ENCRYPTION_KEY',
] as const;

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('backup/BackupDestination', () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  let sendSpy: MockInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.BACKUP_S3_BUCKET = 'backup-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY_ID = 'ak';
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'sk';
    process.env.BACKUP_ENCRYPTION_KEY = '2'.repeat(64); // 64 hex chars — decodes to exactly 32 bytes
    delete process.env.BACKUP_S3_PREFIX;

    sendSpy = vi.spyOn(S3Client.prototype, 'send');
  });

  afterEach(() => {
    sendSpy.mockRestore();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe('existingSize', () => {
    it('returns the ContentLength for an object that exists', async () => {
      sendSpy.mockResolvedValue({ ContentLength: 1234 });

      const size = await new BackupDestination().existingSize('archive/doc-1/hash/pdf.pdf');

      expect(size).toBe(1234);
      expect(sendSpy).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
      const command = sendSpy.mock.calls[0][0] as HeadObjectCommand;
      expect(command.input).toEqual({ Bucket: 'backup-bucket', Key: 'archive/doc-1/hash/pdf.pdf' });
    });

    it('returns null (never throws) for a missing key', async () => {
      const error = Object.assign(new Error('not found'), { name: 'NotFound' });
      sendSpy.mockRejectedValue(error);

      await expect(new BackupDestination().existingSize('missing/key')).resolves.toBeNull();
    });

    it('propagates a REAL error (e.g. wrong credentials) rather than treating it as missing', async () => {
      sendSpy.mockRejectedValue(new Error('AccessDenied'));

      await expect(new BackupDestination().existingSize('archive/x')).rejects.toThrow('AccessDenied');
    });

    it('joins BACKUP_S3_PREFIX onto the key when configured', async () => {
      process.env.BACKUP_S3_PREFIX = 'instance-1';
      sendSpy.mockResolvedValue({ ContentLength: 1 });

      await new BackupDestination().existingSize('inbound/company/hash.pdf');

      const command = sendSpy.mock.calls[0][0] as HeadObjectCommand;
      expect(command.input.Key).toBe('instance-1/inbound/company/hash.pdf');
    });
  });

  describe('upload', () => {
    it('never sends the plaintext — what reaches PutObjectCommand is the encrypted envelope', async () => {
      sendSpy.mockResolvedValue({});
      const plaintext = Buffer.from('hello');

      // A small enough body that @aws-sdk/lib-storage's `Upload` takes its single-PUT path rather
      // than multipart — see `backup-destination.ts`'s own header on why `Upload` is used at all.
      await new BackupDestination().upload('archive/doc-1/hash/pdf.pdf', Readable.from(plaintext));

      const putCall = sendSpy.mock.calls
        .map((call) => call[0])
        .find((cmd) => cmd instanceof PutObjectCommand);
      expect(putCall).toBeDefined();
      const command = putCall as PutObjectCommand;
      expect(command.input.Bucket).toBe('backup-bucket');
      expect(command.input.Key).toBe('archive/doc-1/hash/pdf.pdf');

      const ciphertext = command.input.Body as Buffer;
      expect(ciphertext).not.toEqual(plaintext);
      expect(ciphertext.length).toBe(plaintext.length + BACKUP_ENCRYPTION_OVERHEAD_BYTES);

      // Proves the bytes that were actually about to leave the process decrypt back correctly —
      // never a round-trip through the SAME in-memory `Buffer`/stream object under test.
      const decrypted = await drain(Readable.from(ciphertext).pipe(createBackupDecryptStream()));
      expect(decrypted).toEqual(plaintext);
    });

    it('fails loud BEFORE a single byte reaches the network when BACKUP_ENCRYPTION_KEY is missing', async () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      sendSpy.mockResolvedValue({});

      await expect(
        new BackupDestination().upload('archive/doc-1/hash/pdf.pdf', Readable.from(Buffer.from('hello'))),
      ).rejects.toThrow('BACKUP_ENCRYPTION_KEY');
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  it('fails loud when BACKUP_S3_BUCKET is unset — never a silent no-op', async () => {
    delete process.env.BACKUP_S3_BUCKET;

    await expect(new BackupDestination().existingSize('x')).rejects.toThrow('BACKUP_S3_BUCKET is not set');
  });
});
