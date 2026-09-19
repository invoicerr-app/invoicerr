/**
 * REAL round-trip against a REAL MinIO container — same discipline as
 * `archive/s3-storage.live.spec.ts` (read that file first if touching this one): a `docker info`
 * pre-check, `-P` random host-port publishing (never a hard-coded port this test could collide with),
 * a poll-until-ready loop (never a fixed sleep), and an `afterAll` that removes the container.
 *
 * Image: `quay.io/minio/minio:latest`, NOT `minio/minio` on Docker Hub — see
 * `archive/s3-storage.live.spec.ts`'s own header for why (anonymous Docker Hub pulls of that image are
 * denied; the `quay.io` mirror is not).
 *
 * Gated `INBOUND_S3_LIVE=1` (`../transports/live-gate.ts`, same shape every sibling live spec uses),
 * deliberately with NO required credential env var — this spec BRINGS its own MinIO server rather than
 * depending on a pre-existing bucket/credentials the operator would otherwise have to supply.
 *
 *   INBOUND_S3_LIVE=1 npx vitest run s3-storage.live
 *
 * The AWS SDK itself creates the test bucket (`CreateBucketCommand`) — no `mc` CLI dependency. Every
 * `INBOUND_S3_*` / `INBOUND_STORAGE` env var this spec sets is restored (or deleted) in `afterAll`, so
 * nothing leaks `INBOUND_STORAGE=s3` into any test file that happens to run afterward in the same
 * worker.
 *
 * Exercises `storage.ts`'s own public dispatch functions (`persistInboundFile` / `readInboundFile` /
 * `deleteInboundFilesForCompany` / `wipeAllInboundFiles`) — never `s3-storage.ts`'s internals directly
 * (`s3-storage.spec.ts` already covers those with a mocked SDK) — so this proves the FACADE'S real
 * `INBOUND_STORAGE=s3` dispatch, not just the S3 module in isolation. Covers the four properties this
 * store is required to preserve: a byte-for-byte round-trip, dedup-by-hash (the same content stored
 * twice never creates a second object), and a read scoped to the WRONG company finding nothing — the
 * fourth (a malformed hash refused before any call) is covered by `s3-storage.spec.ts`'s own mocked
 * suite instead, where "no network call happened" can actually be asserted against a spy; a live MinIO
 * round-trip cannot prove a negative about calls that were never made any more precisely than that.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { liveDescribe } from '../transports/live-gate';
import {
  deleteInboundFilesForCompany,
  persistInboundFile,
  readInboundFile,
  wipeAllInboundFiles,
} from './storage';

const MINIO_IMAGE = 'quay.io/minio/minio:latest';
const MINIO_ROOT_USER = 'minioadmin';
const MINIO_ROOT_PASSWORD = 'minioadmin';

/** `docker info` (never just `docker --version`) — the daemon must actually be reachable, not merely
 *  the CLI present, for `docker run` below to have any chance of working. Same check, same reasoning,
 *  as `archive/s3-storage.live.spec.ts#isDockerUsable`. */
function isDockerUsable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const flagDescribe = liveDescribe('INBOUND_S3_LIVE');
const dockerUsable = flagDescribe === describe ? isDockerUsable() : false;
if (flagDescribe === describe && !dockerUsable) {
  process.stderr.write(
    '[live-gate] INBOUND_S3_LIVE=1 but `docker info` failed (no usable Docker daemon in this ' +
      'environment) — suite will be skipped.\n',
  );
}
const describeLive = flagDescribe === describe && dockerUsable ? describe : describe.skip;

describeLive('received-invoices/s3-storage — real round-trip against a real MinIO container', () => {
  const containerName = `invoicerr-inbound-s3-live-${randomUUID().slice(0, 8)}`;
  const bucket = `inbound-live-${randomUUID().slice(0, 8)}`;
  let minioUrl: string;

  const ENV_KEYS = [
    'INBOUND_STORAGE',
    'INBOUND_S3_BUCKET',
    'INBOUND_S3_ENDPOINT',
    'INBOUND_S3_REGION',
    'INBOUND_S3_ACCESS_KEY_ID',
    'INBOUND_S3_SECRET_ACCESS_KEY',
    'INBOUND_S3_FORCE_PATH_STYLE',
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

    // Point the inbound store at this MinIO instance, s3 mode, BEFORE creating the bucket — env is
    // read fresh on every call (storage.ts / s3-storage.ts's own documented discipline), so setting it
    // once here is enough for every test below.
    process.env.INBOUND_STORAGE = 's3';
    process.env.INBOUND_S3_BUCKET = bucket;
    process.env.INBOUND_S3_ENDPOINT = minioUrl;
    process.env.INBOUND_S3_REGION = 'us-east-1'; // MinIO does not care about the region value itself
    process.env.INBOUND_S3_ACCESS_KEY_ID = MINIO_ROOT_USER;
    process.env.INBOUND_S3_SECRET_ACCESS_KEY = MINIO_ROOT_PASSWORD;
    process.env.INBOUND_S3_FORCE_PATH_STYLE = '1'; // MinIO needs path-style addressing

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

  const HASH_A = 'a'.repeat(64);

  it('persists a file to S3 and reads back the exact same bytes through storage.ts', async () => {
    const uri = await persistInboundFile(
      'live-company-1',
      HASH_A,
      'application/pdf',
      new TextEncoder().encode('%PDF real inbound bytes'),
    );

    expect(uri).toBe(`s3://${bucket}/live-company-1/${HASH_A}.pdf`);

    const read = await readInboundFile('live-company-1', HASH_A, 'application/pdf');
    expect(read?.toString('utf-8')).toBe('%PDF real inbound bytes');
  });

  it('storing the SAME content twice for the SAME company deduplicates — one object, still readable', async () => {
    const bytes = new TextEncoder().encode('duplicate upload, identical bytes');
    const first = await persistInboundFile('live-company-2', HASH_A, 'application/pdf', bytes);
    const second = await persistInboundFile('live-company-2', HASH_A, 'application/pdf', bytes);

    expect(second).toBe(first); // same bucket/key — a re-upload overwrites the SAME object, never a new one

    const read = await readInboundFile('live-company-2', HASH_A, 'application/pdf');
    expect(read?.toString('utf-8')).toBe('duplicate upload, identical bytes');
  });

  it('a read scoped to the WRONG company finds nothing — real cross-tenant isolation, not a mock', async () => {
    await persistInboundFile(
      'live-victim-company',
      HASH_A,
      'application/pdf',
      new TextEncoder().encode('victim-only bytes'),
    );

    expect(await readInboundFile('live-attacker-company', HASH_A, 'application/pdf')).toBeNull();
    // The victim's own read still works — this is isolation, not a store that simply lost the file.
    expect((await readInboundFile('live-victim-company', HASH_A, 'application/pdf'))?.toString('utf-8')).toBe(
      'victim-only bytes',
    );
  });

  it("deleteInboundFilesForCompany removes only that company's own objects", async () => {
    await persistInboundFile('live-company-3', HASH_A, 'application/pdf', new TextEncoder().encode('mine'));
    await persistInboundFile('live-company-4', HASH_A, 'application/pdf', new TextEncoder().encode('theirs'));

    await deleteInboundFilesForCompany('live-company-3');

    expect(await readInboundFile('live-company-3', HASH_A, 'application/pdf')).toBeNull();
    expect((await readInboundFile('live-company-4', HASH_A, 'application/pdf'))?.toString('utf-8')).toBe(
      'theirs',
    );
  });

  it('wipeAllInboundFiles removes every object in the bucket, every company at once', async () => {
    await persistInboundFile('live-company-5', HASH_A, 'application/pdf', new TextEncoder().encode('a'));
    await persistInboundFile('live-company-6', HASH_A, 'application/pdf', new TextEncoder().encode('b'));

    await wipeAllInboundFiles();

    expect(await readInboundFile('live-company-5', HASH_A, 'application/pdf')).toBeNull();
    expect(await readInboundFile('live-company-6', HASH_A, 'application/pdf')).toBeNull();
  });
});
