/**
 * REAL round-trip against a REAL MinIO container — same discipline as
 * `documents/archive/s3-storage.live.spec.ts` (read that file first if touching this one): a
 * `docker info` pre-check, `-P` random host-port publishing, a poll-until-ready loop, and an
 * `afterAll` that removes the container.
 *
 * Gated `BACKUP_S3_LIVE=1` (`documents/transports/live-gate.ts`), deliberately with NO required
 * credential env var — this spec brings its own MinIO server rather than depending on a
 * pre-existing bucket/credentials. Run with:
 *
 *   BACKUP_S3_LIVE=1 npx vitest run src/modules/backup/backup-destination.live.spec.ts
 *
 * Also carries this module's RESTORE proof (see `backup-crypto.ts`'s own header on why encryption
 * without a proven restore path is worse than no backup at all): what actually lands in the real
 * bucket is downloaded back with a BARE `S3Client` — never `BackupDestination`, which never exposes a
 * read/download method on purpose (see that file's own header) — and decrypted with nothing but
 * `BACKUP_ENCRYPTION_KEY` and the downloaded bytes, exactly the two things an operator restoring onto
 * a brand new instance would have. And a large-artifact test that proves the upload genuinely streams
 * (multiple real `UploadPartCommand`s over the wire), not merely that the API accepts a stream.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { vi } from 'vitest';

import { CreateBucketCommand, GetObjectCommand, S3Client, UploadPartCommand } from '@aws-sdk/client-s3';

import { liveDescribe } from '@/modules/documents/transports/live-gate';

import { BACKUP_ENCRYPTION_OVERHEAD_BYTES, createBackupDecryptStream } from './backup-crypto';
import { BackupDestination } from './backup-destination';

const MINIO_IMAGE = 'quay.io/minio/minio:latest';
const MINIO_ROOT_USER = 'minioadmin';
const MINIO_ROOT_PASSWORD = 'minioadmin';

function isDockerUsable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const flagDescribe = liveDescribe('BACKUP_S3_LIVE');
const dockerUsable = flagDescribe === describe ? isDockerUsable() : false;
if (flagDescribe === describe && !dockerUsable) {
  process.stderr.write(
    '[live-gate] BACKUP_S3_LIVE=1 but `docker info` failed (no usable Docker daemon) — suite skipped.\n',
  );
}
const describeLive = flagDescribe === describe && dockerUsable ? describe : describe.skip;

describeLive('backup/BackupDestination — real round-trip against a real MinIO container', () => {
  const containerName = `invoicerr-backup-s3-live-${randomUUID().slice(0, 8)}`;
  const bucket = `backup-live-${randomUUID().slice(0, 8)}`;
  let minioUrl: string;

  const ENV_KEYS = [
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_REGION',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
    'BACKUP_S3_FORCE_PATH_STYLE',
    'BACKUP_ENCRYPTION_KEY',
  ] as const;
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeAll(async () => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--rm',
        '-P',
        '-e',
        `MINIO_ROOT_USER=${MINIO_ROOT_USER}`,
        '-e',
        `MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}`,
        '--name',
        containerName,
        MINIO_IMAGE,
        'server',
        '/data',
        '--console-address',
        ':9090',
      ],
      { timeout: 30_000 },
    );

    const portMapping = execFileSync('docker', ['port', containerName, '9000/tcp'], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    const port = portMapping.split(':').pop();
    if (!port) throw new Error(`could not determine the published port from "${portMapping}"`);
    minioUrl = `http://127.0.0.1:${port}`;

    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const res = await fetch(`${minioUrl}/minio/health/live`);
        if (res.ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`${MINIO_IMAGE} never became ready at ${minioUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    process.env.BACKUP_S3_BUCKET = bucket;
    process.env.BACKUP_S3_ENDPOINT = minioUrl;
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY_ID = MINIO_ROOT_USER;
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = MINIO_ROOT_PASSWORD;
    process.env.BACKUP_S3_FORCE_PATH_STYLE = '1';
    process.env.BACKUP_ENCRYPTION_KEY = '6'.repeat(64); // 64 hex chars — decodes to exactly 32 bytes

    const bootstrapClient = new S3Client({
      region: 'us-east-1',
      endpoint: minioUrl,
      forcePathStyle: true,
      credentials: { accessKeyId: MINIO_ROOT_USER, secretAccessKey: MINIO_ROOT_PASSWORD },
    });
    await bootstrapClient.send(new CreateBucketCommand({ Bucket: bucket }));
  }, 60_000);

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    try {
      execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore', timeout: 15_000 });
    } catch {
      // best-effort cleanup — `--rm` above already removes it on its own once stopped
    }
  });

  it('existingSize is null before upload, then reflects the real (encrypted) byte count after', async () => {
    const destination = new BackupDestination();
    expect(await destination.existingSize('archive/doc-1/hash/pdf.pdf')).toBeNull();

    await destination.upload('archive/doc-1/hash/pdf.pdf', Readable.from(Buffer.from('%PDF real bytes')));

    // The object sitting in the REAL bucket is larger than the source by exactly the fixed IV+tag
    // envelope — proof, against a real server, that what was uploaded is not the plaintext.
    expect(await destination.existingSize('archive/doc-1/hash/pdf.pdf')).toBe(
      Buffer.byteLength('%PDF real bytes') + BACKUP_ENCRYPTION_OVERHEAD_BYTES,
    );
  });

  it('a re-upload under the same key overwrites — the bytes actually change on the real bucket', async () => {
    const destination = new BackupDestination();
    await destination.upload('archive/doc-2/hash/pdf.pdf', Readable.from(Buffer.from('v1')));
    expect(await destination.existingSize('archive/doc-2/hash/pdf.pdf')).toBe(
      2 + BACKUP_ENCRYPTION_OVERHEAD_BYTES,
    );

    await destination.upload('archive/doc-2/hash/pdf.pdf', Readable.from(Buffer.from('a longer v2')));
    expect(await destination.existingSize('archive/doc-2/hash/pdf.pdf')).toBe(
      11 + BACKUP_ENCRYPTION_OVERHEAD_BYTES,
    );
  });

  it(
    'RESTORE PROOF: an object downloaded with a bare S3Client (never BackupDestination) decrypts ' +
      'with only BACKUP_ENCRYPTION_KEY and the bytes — no access to this process’s own app state',
    async () => {
      const destination = new BackupDestination();
      const plaintext = Buffer.from(
        'this is what a restored document would actually contain — legal archive PDF bytes, in spirit',
      );
      await destination.upload('archive/restore-proof/doc.pdf', Readable.from(plaintext));

      // A BRAND NEW, independent S3Client — built from nothing but the same endpoint/credentials an
      // operator's own `aws`/`mc` CLI would use, never `BackupDestination` or anything else this
      // module exports. This is the "no access to the running application's state" half of the proof:
      // the only things touched below are the downloaded bytes and `BACKUP_ENCRYPTION_KEY`.
      const bareClient = new S3Client({
        region: 'us-east-1',
        endpoint: minioUrl,
        forcePathStyle: true,
        credentials: { accessKeyId: MINIO_ROOT_USER, secretAccessKey: MINIO_ROOT_PASSWORD },
      });
      const downloaded = await bareClient.send(
        new GetObjectCommand({ Bucket: bucket, Key: 'archive/restore-proof/doc.pdf' }),
      );
      if (!downloaded.Body) throw new Error('expected a body');

      const decrypted: Buffer[] = [];
      const decryptStream = (downloaded.Body as Readable).pipe(createBackupDecryptStream());
      for await (const chunk of decryptStream) decrypted.push(chunk as Buffer);

      expect(Buffer.concat(decrypted)).toEqual(plaintext);
    },
  );

  it('a large artifact genuinely streams over the wire — real multipart UploadPartCommands, never one whole buffer', async () => {
    const destination = new BackupDestination();
    // 18 MiB: comfortably past the 5 MiB default part size, so @aws-sdk/lib-storage's `Upload` MUST
    // take its multipart path (>=4 real parts) rather than the small-body single-PUT optimization —
    // see `backup-destination.ts`'s own header on why `Upload` was chosen at all.
    const chunkSize = 1024 * 1024; // 1 MiB per generated chunk
    const chunkCount = 18;
    const sha256 = createHash('sha256');
    let produced = 0;

    // Generated ON DEMAND, one 1 MiB chunk at a time — this test never builds an 18 MiB buffer of its
    // own; the running hash is how it checks correctness without keeping the plaintext around either.
    async function* generate() {
      while (produced < chunkCount) {
        produced += 1;
        const chunk = randomBytes(chunkSize);
        sha256.update(chunk);
        yield chunk;
      }
    }

    const sendSpy = vi.spyOn(S3Client.prototype, 'send'); // observes real calls, changes nothing
    await destination.upload('inbound/large-artifact.bin', Readable.from(generate()));
    const uploadPartCalls = sendSpy.mock.calls.filter((call) => call[0] instanceof UploadPartCommand);
    sendSpy.mockRestore();

    expect(uploadPartCalls.length).toBeGreaterThanOrEqual(4); // real network calls, not a single PUT
    expect(await destination.existingSize('inbound/large-artifact.bin')).toBe(
      chunkCount * chunkSize + BACKUP_ENCRYPTION_OVERHEAD_BYTES,
    );

    // Download and decrypt independently (same restore posture as the proof above) and check the hash
    // rather than holding the whole 18 MiB plaintext a second time for a byte-for-byte comparison.
    const bareClient = new S3Client({
      region: 'us-east-1',
      endpoint: minioUrl,
      forcePathStyle: true,
      credentials: { accessKeyId: MINIO_ROOT_USER, secretAccessKey: MINIO_ROOT_PASSWORD },
    });
    const downloaded = await bareClient.send(
      new GetObjectCommand({ Bucket: bucket, Key: 'inbound/large-artifact.bin' }),
    );
    if (!downloaded.Body) throw new Error('expected a body');

    const restoredHash = createHash('sha256');
    for await (const chunk of (downloaded.Body as Readable).pipe(createBackupDecryptStream())) {
      restoredHash.update(chunk as Buffer);
    }
    expect(restoredHash.digest('hex')).toBe(sha256.digest('hex'));
  }, 60_000);
});
