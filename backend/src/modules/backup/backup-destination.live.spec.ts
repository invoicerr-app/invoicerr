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
 *   BACKUP_S3_LIVE=1 npx jest backup-destination.live --no-coverage --forceExit
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { liveDescribe } from '@/modules/documents/transports/live-gate';

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

  it('existingSize is null before upload, then reflects the real byte count after', async () => {
    const destination = new BackupDestination();
    expect(await destination.existingSize('archive/doc-1/hash/pdf.pdf')).toBeNull();

    await destination.upload('archive/doc-1/hash/pdf.pdf', Buffer.from('%PDF real bytes'));

    expect(await destination.existingSize('archive/doc-1/hash/pdf.pdf')).toBe(
      Buffer.byteLength('%PDF real bytes'),
    );
  });

  it('a re-upload under the same key overwrites — the bytes actually change on the real bucket', async () => {
    const destination = new BackupDestination();
    await destination.upload('archive/doc-2/hash/pdf.pdf', Buffer.from('v1'));
    expect(await destination.existingSize('archive/doc-2/hash/pdf.pdf')).toBe(2);

    await destination.upload('archive/doc-2/hash/pdf.pdf', Buffer.from('a longer v2'));
    expect(await destination.existingSize('archive/doc-2/hash/pdf.pdf')).toBe(11);
  });
});
