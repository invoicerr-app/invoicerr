/**
 * Unit coverage for `s3-storage.ts` — the AWS SDK is MOCKED throughout (no real network, no MinIO
 * container). See `s3-storage.live.spec.ts` for the real round-trip against a real MinIO container:
 * a green suite here proves the request/response WIRING, never that a real S3-compatible endpoint
 * actually accepts these calls — the same distinction this repo's own live-testing doc draws for
 * every other external integration.
 *
 * `S3Client.prototype.send` is spied on directly (no `aws-sdk-client-mock` dependency — not already
 * present in this package, and a manual spy is enough for the handful of commands this module
 * issues). Using a real `function` (never an arrow function) for each `mockImplementation` matters
 * for the FORCE_PATH_STYLE test below: the SDK always calls `client.send(command)`, so `this` inside
 * a real function is the actual `S3Client` instance `buildClient()` constructed — reading
 * `this.config.forcePathStyle` there proves the env var actually reached the constructed client,
 * without needing to mock the `S3Client` constructor separately.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  artifactExistsS3,
  deleteArchivedArtifactsS3,
  listArchivedArtifactKeysS3,
  persistArtifactsS3,
  readArchivedArtifactS3,
} from './s3-storage';

const ENV_KEYS = [
  'ARCHIVE_S3_BUCKET',
  'ARCHIVE_S3_ENDPOINT',
  'ARCHIVE_S3_REGION',
  'ARCHIVE_S3_ACCESS_KEY_ID',
  'ARCHIVE_S3_SECRET_ACCESS_KEY',
  'ARCHIVE_S3_FORCE_PATH_STYLE',
] as const;

describe('archive/s3-storage — S3-compatible implementation (SDK mocked, no real network)', () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.ARCHIVE_S3_BUCKET = 'test-bucket';
    process.env.ARCHIVE_S3_REGION = 'us-east-1';
    process.env.ARCHIVE_S3_ACCESS_KEY_ID = 'test-access-key';
    process.env.ARCHIVE_S3_SECRET_ACCESS_KEY = 'test-secret-key';
    delete process.env.ARCHIVE_S3_ENDPOINT;
    delete process.env.ARCHIVE_S3_FORCE_PATH_STYLE;

    sendSpy = jest.spyOn(S3Client.prototype, 'send');
  });

  afterEach(() => {
    sendSpy.mockRestore();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe('persistArtifactsS3', () => {
    it('writes each artifact to the right bucket/key and returns a self-contained uri', async () => {
      sendSpy.mockResolvedValue({});

      const artifacts = [
        { role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-fake') },
        { role: 'facturx', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-facturx') },
      ];
      const { uri, contentHash } = await persistArtifactsS3('doc-1', artifacts);

      expect(uri).toBe(`s3://test-bucket/doc-1/${contentHash}`);
      expect(sendSpy).toHaveBeenCalledTimes(2);

      const firstCommand = sendSpy.mock.calls[0][0] as PutObjectCommand;
      expect(firstCommand).toBeInstanceOf(PutObjectCommand);
      expect(firstCommand.input).toEqual(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: `doc-1/${contentHash}/pdf.pdf`,
          ContentType: 'application/pdf',
        }),
      );

      const secondCommand = sendSpy.mock.calls[1][0] as PutObjectCommand;
      expect(secondCommand.input.Key).toBe(`doc-1/${contentHash}/facturx.pdf`);
    });

    it('throws naming ARCHIVE_S3_BUCKET when it is missing — never silently falls back to local disk', async () => {
      delete process.env.ARCHIVE_S3_BUCKET;
      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
      await expect(persistArtifactsS3('doc-1', artifacts)).rejects.toThrow(/ARCHIVE_S3_BUCKET/);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('throws naming ARCHIVE_S3_REGION when it is missing', async () => {
      delete process.env.ARCHIVE_S3_REGION;
      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
      await expect(persistArtifactsS3('doc-1', artifacts)).rejects.toThrow(/ARCHIVE_S3_REGION/);
    });

    it('throws naming ARCHIVE_S3_ACCESS_KEY_ID when it is missing', async () => {
      delete process.env.ARCHIVE_S3_ACCESS_KEY_ID;
      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
      await expect(persistArtifactsS3('doc-1', artifacts)).rejects.toThrow(/ARCHIVE_S3_ACCESS_KEY_ID/);
    });

    it('throws naming ARCHIVE_S3_SECRET_ACCESS_KEY when it is missing', async () => {
      delete process.env.ARCHIVE_S3_SECRET_ACCESS_KEY;
      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
      await expect(persistArtifactsS3('doc-1', artifacts)).rejects.toThrow(/ARCHIVE_S3_SECRET_ACCESS_KEY/);
    });

    it('ARCHIVE_S3_FORCE_PATH_STYLE="1" flows into the constructed client config', async () => {
      process.env.ARCHIVE_S3_FORCE_PATH_STYLE = '1';
      let observedForcePathStyle: unknown;
      sendSpy.mockImplementation(function (this: S3Client) {
        observedForcePathStyle = this.config.forcePathStyle;
        return Promise.resolve({});
      });

      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
      await persistArtifactsS3('doc-1', artifacts);

      expect(observedForcePathStyle).toBe(true);
    });

    it('omitting ARCHIVE_S3_FORCE_PATH_STYLE resolves to false — AWS itself never needs it', async () => {
      let observedForcePathStyle: unknown;
      sendSpy.mockImplementation(function (this: S3Client) {
        observedForcePathStyle = this.config.forcePathStyle;
        return Promise.resolve({});
      });

      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
      await persistArtifactsS3('doc-1', artifacts);

      expect(observedForcePathStyle).toBe(false);
    });
  });

  describe('readArchivedArtifactS3', () => {
    it('returns the bytes of an existing object, via GET', async () => {
      sendSpy.mockResolvedValue({
        Body: { transformToByteArray: () => Promise.resolve(new TextEncoder().encode('archived bytes')) },
      });

      const bytes = await readArchivedArtifactS3('s3://test-bucket/doc-1/hash123', 'pdf', 'application/pdf');

      expect(bytes?.toString('utf-8')).toBe('archived bytes');
      const command = sendSpy.mock.calls[0][0] as GetObjectCommand;
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual(
        expect.objectContaining({ Bucket: 'test-bucket', Key: 'doc-1/hash123/pdf.pdf' }),
      );
    });

    it('returns null (never throws) on a NoSuchKey error', async () => {
      sendSpy.mockRejectedValue(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));
      const bytes = await readArchivedArtifactS3('s3://test-bucket/doc-1/hash123', 'pdf', 'application/pdf');
      expect(bytes).toBeNull();
    });

    it('returns null on a plain 404 $metadata even without a NoSuchKey name', async () => {
      sendSpy.mockRejectedValue(Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } }));
      const bytes = await readArchivedArtifactS3('s3://test-bucket/doc-1/hash123', 'pdf', 'application/pdf');
      expect(bytes).toBeNull();
    });

    it('re-throws any other error — never masks a real failure as "missing"', async () => {
      sendSpy.mockRejectedValue(new Error('access denied'));
      await expect(
        readArchivedArtifactS3('s3://test-bucket/doc-1/hash123', 'pdf', 'application/pdf'),
      ).rejects.toThrow('access denied');
    });
  });

  describe('artifactExistsS3', () => {
    it('uses HEAD, not GET, and returns true when the object exists', async () => {
      sendSpy.mockResolvedValue({});
      const exists = await artifactExistsS3('s3://test-bucket/doc-1/hash123', 'pdf', 'application/pdf');
      expect(exists).toBe(true);
      expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    });

    it('returns false on a NotFound error (HEAD’s own name for a missing object)', async () => {
      sendSpy.mockRejectedValue(Object.assign(new Error('not found'), { name: 'NotFound' }));
      const exists = await artifactExistsS3('s3://test-bucket/doc-1/hash123', 'pdf', 'application/pdf');
      expect(exists).toBe(false);
    });

    it('re-throws any other error', async () => {
      sendSpy.mockRejectedValue(new Error('access denied'));
      await expect(
        artifactExistsS3('s3://test-bucket/doc-1/hash123', 'pdf', 'application/pdf'),
      ).rejects.toThrow('access denied');
    });
  });

  describe('deleteArchivedArtifactsS3', () => {
    it('lists the key prefix then issues one DeleteObjectsCommand for everything found', async () => {
      sendSpy.mockImplementation((command: unknown) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({
            Contents: [{ Key: 'doc-1/hash123/pdf.pdf' }, { Key: 'doc-1/hash123/facturx.pdf' }],
            IsTruncated: false,
          });
        }
        if (command instanceof DeleteObjectsCommand) {
          return Promise.resolve({});
        }
        throw new Error(
          `unexpected command: ${(command as { constructor: { name: string } }).constructor.name}`,
        );
      });

      await deleteArchivedArtifactsS3('s3://test-bucket/doc-1/hash123');

      const listCall = sendSpy.mock.calls.find(([cmd]) => cmd instanceof ListObjectsV2Command);
      expect(listCall?.[0].input).toEqual(
        expect.objectContaining({ Bucket: 'test-bucket', Prefix: 'doc-1/hash123/' }),
      );
      const deleteCall = sendSpy.mock.calls.find(([cmd]) => cmd instanceof DeleteObjectsCommand);
      expect(deleteCall?.[0].input.Delete.Objects).toEqual([
        { Key: 'doc-1/hash123/pdf.pdf' },
        { Key: 'doc-1/hash123/facturx.pdf' },
      ]);
    });

    it('issues no DeleteObjectsCommand when nothing is found under the prefix', async () => {
      sendSpy.mockResolvedValue({ Contents: [], IsTruncated: false });

      await deleteArchivedArtifactsS3('s3://test-bucket/doc-1/hash123');

      expect(sendSpy.mock.calls.some(([cmd]) => cmd instanceof DeleteObjectsCommand)).toBe(false);
    });
  });

  describe('listArchivedArtifactKeysS3', () => {
    it('paginates through ListObjectsV2Command and tags every key with its s3:// uri', async () => {
      sendSpy
        .mockResolvedValueOnce({
          Contents: [{ Key: 'doc-1/hash123/pdf.pdf' }],
          IsTruncated: true,
          NextContinuationToken: 'page-2',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'doc-2/hash456/pdf.pdf' }],
          IsTruncated: false,
        });

      const keys = await listArchivedArtifactKeysS3();

      expect(keys).toEqual([
        's3://test-bucket/doc-1/hash123/pdf.pdf',
        's3://test-bucket/doc-2/hash456/pdf.pdf',
      ]);
      expect((sendSpy.mock.calls[1][0] as ListObjectsV2Command).input.ContinuationToken).toBe('page-2');
    });
  });
});
