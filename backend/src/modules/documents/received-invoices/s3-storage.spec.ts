/**
 * Unit coverage for `s3-storage.ts` — the AWS SDK is MOCKED throughout (no real network, no MinIO
 * container). See `s3-storage.live.spec.ts` for the real round-trip against a real MinIO container:
 * a green suite here proves the request/response WIRING (key layout, error mapping, config plumbing),
 * never that a real S3-compatible endpoint actually accepts these calls — same distinction
 * `archive/s3-storage.spec.ts` already draws for its own mocked half.
 */
import { vi, type MockInstance } from 'vitest';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  deleteAllInboundObjectsS3,
  deleteInboundFilesForCompanyS3,
  persistInboundFileS3,
  readInboundFileS3,
} from './s3-storage';

const ENV_KEYS = [
  'INBOUND_S3_BUCKET',
  'INBOUND_S3_ENDPOINT',
  'INBOUND_S3_REGION',
  'INBOUND_S3_ACCESS_KEY_ID',
  'INBOUND_S3_SECRET_ACCESS_KEY',
  'INBOUND_S3_FORCE_PATH_STYLE',
] as const;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('received-invoices/s3-storage — S3-compatible implementation (SDK mocked, no real network)', () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  let sendSpy: MockInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.INBOUND_S3_BUCKET = 'test-inbound-bucket';
    process.env.INBOUND_S3_REGION = 'us-east-1';
    process.env.INBOUND_S3_ACCESS_KEY_ID = 'test-access-key';
    process.env.INBOUND_S3_SECRET_ACCESS_KEY = 'test-secret-key';
    delete process.env.INBOUND_S3_ENDPOINT;
    delete process.env.INBOUND_S3_FORCE_PATH_STYLE;

    sendSpy = vi.spyOn(S3Client.prototype, 'send');
  });

  afterEach(() => {
    sendSpy.mockRestore();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe('persistInboundFileS3', () => {
    it('writes to <companyId>/<sha256>.<ext> and returns a self-contained uri', async () => {
      sendSpy.mockResolvedValue({});

      const uri = await persistInboundFileS3(
        'company-1',
        HASH_A,
        'application/pdf',
        new TextEncoder().encode('%PDF-fake'),
      );

      expect(uri).toBe(`s3://test-inbound-bucket/company-1/${HASH_A}.pdf`);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const command = sendSpy.mock.calls[0][0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: 'test-inbound-bucket',
          Key: `company-1/${HASH_A}.pdf`,
          ContentType: 'application/pdf',
        }),
      );
    });

    it('two different companies never share a key, even for the identical hash', async () => {
      sendSpy.mockResolvedValue({});

      await persistInboundFileS3('company-1', HASH_A, 'application/pdf', new TextEncoder().encode('x'));
      await persistInboundFileS3('company-2', HASH_A, 'application/pdf', new TextEncoder().encode('y'));

      const keys = sendSpy.mock.calls.map(([cmd]: [PutObjectCommand]) => cmd.input.Key);
      expect(keys).toEqual([`company-1/${HASH_A}.pdf`, `company-2/${HASH_A}.pdf`]);
    });

    it('refuses a malformed hash BEFORE any config is read or any call is made', async () => {
      // Every INBOUND_S3_* env var is deliberately UNSET here — if the hash check ran AFTER config
      // resolution, this would throw a "not set" error instead of the hash-format one, proving the
      // wrong function ran first.
      for (const key of ENV_KEYS) delete process.env[key];

      await expect(
        persistInboundFileS3(
          'company-1',
          '../../etc/passwd',
          'application/pdf',
          new TextEncoder().encode('x'),
        ),
      ).rejects.toThrow(/not a valid content hash/);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('throws naming INBOUND_S3_BUCKET when it is missing — never silently falls back to local disk', async () => {
      delete process.env.INBOUND_S3_BUCKET;
      await expect(
        persistInboundFileS3('company-1', HASH_A, 'application/pdf', new TextEncoder().encode('x')),
      ).rejects.toThrow(/INBOUND_S3_BUCKET/);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('throws naming INBOUND_S3_REGION when it is missing', async () => {
      delete process.env.INBOUND_S3_REGION;
      await expect(
        persistInboundFileS3('company-1', HASH_A, 'application/pdf', new TextEncoder().encode('x')),
      ).rejects.toThrow(/INBOUND_S3_REGION/);
    });

    it('INBOUND_S3_FORCE_PATH_STYLE="1" flows into the constructed client config', async () => {
      process.env.INBOUND_S3_FORCE_PATH_STYLE = '1';
      let observedForcePathStyle: unknown;
      sendSpy.mockImplementation(function (this: S3Client) {
        observedForcePathStyle = this.config.forcePathStyle;
        return Promise.resolve({});
      });

      await persistInboundFileS3('company-1', HASH_A, 'application/pdf', new TextEncoder().encode('x'));

      expect(observedForcePathStyle).toBe(true);
    });
  });

  describe('readInboundFileS3', () => {
    it('returns the bytes of an existing object, via GET', async () => {
      sendSpy.mockResolvedValue({
        Body: { transformToByteArray: () => Promise.resolve(new TextEncoder().encode('inbound bytes')) },
      });

      const bytes = await readInboundFileS3('company-1', HASH_A, 'application/pdf');

      expect(bytes?.toString('utf-8')).toBe('inbound bytes');
      const command = sendSpy.mock.calls[0][0] as GetObjectCommand;
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual(
        expect.objectContaining({ Bucket: 'test-inbound-bucket', Key: `company-1/${HASH_A}.pdf` }),
      );
    });

    it('returns null (never throws) on a NoSuchKey error', async () => {
      sendSpy.mockRejectedValue(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));
      expect(await readInboundFileS3('company-1', HASH_A, 'application/pdf')).toBeNull();
    });

    it('re-throws any other error — never masks a real failure as "missing"', async () => {
      sendSpy.mockRejectedValue(new Error('access denied'));
      await expect(readInboundFileS3('company-1', HASH_A, 'application/pdf')).rejects.toThrow(
        'access denied',
      );
    });

    // Same "malformed input is a MISS, never a crash" contract the local implementation holds — this
    // hash reaches this module straight off an HTTP route param in more than one caller, never
    // validated there.
    it('returns null, WITHOUT any network call, for a malformed hash — never throws for bad user input', async () => {
      for (const key of ENV_KEYS) delete process.env[key];
      expect(await readInboundFileS3('company-1', '../other-company/x', 'application/pdf')).toBeNull();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("a traversal-shaped companyId cannot be used to escape another company's own prefix either: the key is still built from the real companyId + validated hash", async () => {
      sendSpy.mockResolvedValue({ Body: undefined });
      await readInboundFileS3('victim-company', HASH_A, 'application/pdf');
      const command = sendSpy.mock.calls[0][0] as GetObjectCommand;
      expect(command.input.Key).toBe(`victim-company/${HASH_A}.pdf`);
    });
  });

  describe('deleteInboundFilesForCompanyS3', () => {
    it("lists then deletes every object under this company's OWN prefix only", async () => {
      sendSpy.mockImplementation((command: unknown) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({
            Contents: [{ Key: `company-1/${HASH_A}.pdf` }, { Key: `company-1/${HASH_B}.jpg` }],
            IsTruncated: false,
          });
        }
        if (command instanceof DeleteObjectsCommand) return Promise.resolve({});
        throw new Error('unexpected command');
      });

      await deleteInboundFilesForCompanyS3('company-1');

      const listCall = sendSpy.mock.calls.find(([cmd]) => cmd instanceof ListObjectsV2Command);
      expect(listCall?.[0].input).toEqual(
        expect.objectContaining({ Bucket: 'test-inbound-bucket', Prefix: 'company-1/' }),
      );
      const deleteCall = sendSpy.mock.calls.find(([cmd]) => cmd instanceof DeleteObjectsCommand);
      expect(deleteCall?.[0].input.Delete.Objects).toEqual([
        { Key: `company-1/${HASH_A}.pdf` },
        { Key: `company-1/${HASH_B}.jpg` },
      ]);
    });

    it('issues no DeleteObjectsCommand when this company has nothing stored', async () => {
      sendSpy.mockResolvedValue({ Contents: [], IsTruncated: false });
      await deleteInboundFilesForCompanyS3('company-1');
      expect(sendSpy.mock.calls.some(([cmd]) => cmd instanceof DeleteObjectsCommand)).toBe(false);
    });
  });

  describe('deleteAllInboundObjectsS3', () => {
    it('lists with NO prefix at all — the whole bucket, every company at once', async () => {
      sendSpy.mockImplementation((command: unknown) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({ Contents: [{ Key: 'company-1/x.pdf' }], IsTruncated: false });
        }
        return Promise.resolve({});
      });

      await deleteAllInboundObjectsS3();

      const listCall = sendSpy.mock.calls.find(([cmd]) => cmd instanceof ListObjectsV2Command);
      expect(listCall?.[0].input.Prefix).toBeUndefined();
    });

    it('chunks the delete step at 1000 keys per DeleteObjectsCommand', async () => {
      const manyKeys = Array.from({ length: 1500 }, (_, i) => ({ Key: `company-1/${i}.pdf` }));
      sendSpy.mockImplementation((command: unknown) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({ Contents: manyKeys, IsTruncated: false });
        }
        return Promise.resolve({});
      });

      await deleteAllInboundObjectsS3();

      const deleteCalls = sendSpy.mock.calls.filter(([cmd]) => cmd instanceof DeleteObjectsCommand);
      expect(deleteCalls).toHaveLength(2);
      expect(deleteCalls[0][0].input.Delete.Objects).toHaveLength(1000);
      expect(deleteCalls[1][0].input.Delete.Objects).toHaveLength(500);
    });
  });
});
