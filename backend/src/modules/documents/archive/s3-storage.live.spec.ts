/**
 * REAL round-trip against a REAL MinIO container — same discipline as
 * `../../../ocr-service/local-client.live.spec.ts` (read that file first if touching this one): a
 * `docker info` pre-check, `-P` random host-port publishing (never a hard-coded port this test could
 * collide with), a poll-until-ready loop (never a fixed sleep), and an `afterAll` that removes the
 * container.
 *
 * Image: `quay.io/minio/minio:latest`, NOT `minio/minio` on Docker Hub — Docker Hub now denies
 * anonymous pulls of `minio/minio` ("pull access denied ... requires docker login"), confirmed live
 * against this repo's own Docker daemon while writing this spec; `quay.io/minio/minio` is MinIO's own
 * mirror and pulls anonymously without issue.
 *
 * Gated `ARCHIVE_S3_LIVE=1` (`../transports/live-gate.ts`, same shape every sibling live spec uses),
 * deliberately with NO required credential env var — this spec BRINGS its own MinIO server rather
 * than depending on a pre-existing bucket/credentials the operator would otherwise have to supply
 * (the exact same reason `LOCAL_OCR_LIVE` needs none). The one real requirement is a usable Docker
 * daemon, checked at load time exactly like `local-client.live.spec.ts` does; if the flag is set but
 * Docker is not usable here, the suite is SKIPPED with a one-line stderr warning.
 *
 *   ARCHIVE_S3_LIVE=1 npx jest s3-storage.live --no-coverage --forceExit
 *
 * The AWS SDK itself creates the test bucket (`CreateBucketCommand`) — no `mc` CLI dependency. Every
 * `ARCHIVE_S3_*` / `ARCHIVE_STORAGE` env var this spec sets is restored (or deleted) in `afterAll`, so
 * nothing leaks `ARCHIVE_STORAGE=s3` into any test file that happens to run afterward in the same
 * worker.
 *
 * VERIFIED, LIVE (while writing this spec, ad hoc, before wiring it into jest): a real
 * `docker run` of `quay.io/minio/minio`, then `CreateBucketCommand` + `PutObjectCommand` +
 * `GetObjectCommand` (bytes round-tripped correctly) + `HeadObjectCommand` (200 for an existing key)
 * + a missing key producing a real `NoSuchKey`/404 on GET and a real `NotFound`/404 on HEAD +
 * `DeleteObjectCommand`, all against this exact image with `forcePathStyle: true` and
 * `region: 'us-east-1'`. THIS spec proves the same round-trip through `storage.ts`'s own public
 * dispatch functions (`persistArtifacts` / `readArchivedArtifact` / `artifactExists` /
 * `deleteArchivedArtifacts`), automatically, on every `ARCHIVE_S3_LIVE=1` run — not just
 * `s3-storage.ts`'s internals, which `s3-storage.spec.ts` already covers with a mocked SDK.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { liveDescribe } from '../transports/live-gate';
import { artifactExists, deleteArchivedArtifacts, persistArtifacts, readArchivedArtifact } from './storage';

const MINIO_IMAGE = 'quay.io/minio/minio:latest';
const MINIO_ROOT_USER = 'minioadmin';
const MINIO_ROOT_PASSWORD = 'minioadmin';

/** `docker info` (never just `docker --version`) — the daemon must actually be reachable, not merely
 *  the CLI present, for `docker run` below to have any chance of working. Same check,
 *  same reasoning, as `local-client.live.spec.ts#isDockerUsable`. */
function isDockerUsable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const flagDescribe = liveDescribe('ARCHIVE_S3_LIVE');
const dockerUsable = flagDescribe === describe ? isDockerUsable() : false;
if (flagDescribe === describe && !dockerUsable) {
  process.stderr.write(
    '[live-gate] ARCHIVE_S3_LIVE=1 but `docker info` failed (no usable Docker daemon in this ' +
      'environment) — suite will be skipped.\n',
  );
}
const describeLive = flagDescribe === describe && dockerUsable ? describe : describe.skip;

describeLive('archive/s3-storage — real round-trip against a real MinIO container', () => {
  const containerName = `invoicerr-archive-s3-live-${randomUUID().slice(0, 8)}`;
  const bucket = `archive-live-${randomUUID().slice(0, 8)}`;
  let minioUrl: string;

  // Every ARCHIVE_S3_* / ARCHIVE_STORAGE var this suite touches, so afterAll can restore exactly
  // what was there before — see this file's own header on why leaking ARCHIVE_STORAGE=s3 into a
  // later test file in the same worker would be a real hazard, not just untidy.
  const ENV_KEYS = [
    'ARCHIVE_STORAGE',
    'ARCHIVE_S3_BUCKET',
    'ARCHIVE_S3_ENDPOINT',
    'ARCHIVE_S3_REGION',
    'ARCHIVE_S3_ACCESS_KEY_ID',
    'ARCHIVE_S3_SECRET_ACCESS_KEY',
    'ARCHIVE_S3_FORCE_PATH_STYLE',
  ] as const;
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeAll(async () => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

    // `-P`: publish every EXPOSEd port (9000 for the S3 API, 9090 for the console) to random free
    // host ports — never a hard-coded port this test could collide with on the machine running it.
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
    // `.split(':').pop()` rather than parsing a single line: `docker port` prints BOTH the IPv4
    // (`0.0.0.0:PORT`) and IPv6 (`[::]:PORT`) mappings, one per line — every line still ends with
    // `:PORT`, so taking the last colon-delimited chunk is robust to either shape. Same idiom
    // `local-client.live.spec.ts` already uses for the exact same `docker port` output.
    const port = portMapping.split(':').pop();
    if (!port) throw new Error(`could not determine the published port from "${portMapping}"`);
    minioUrl = `http://127.0.0.1:${port}`;

    // Poll `/minio/health/live` rather than assuming readiness — same "never a fixed sleep"
    // discipline as `local-client.live.spec.ts`.
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

    // Point the archive at this MinIO instance, s3 mode, BEFORE creating the bucket — env is read
    // fresh on every call (storage.ts / s3-storage.ts's own documented discipline), so setting it
    // once here is enough for every test below.
    process.env.ARCHIVE_STORAGE = 's3';
    process.env.ARCHIVE_S3_BUCKET = bucket;
    process.env.ARCHIVE_S3_ENDPOINT = minioUrl;
    process.env.ARCHIVE_S3_REGION = 'us-east-1'; // MinIO does not care about the region value itself
    process.env.ARCHIVE_S3_ACCESS_KEY_ID = MINIO_ROOT_USER;
    process.env.ARCHIVE_S3_SECRET_ACCESS_KEY = MINIO_ROOT_PASSWORD;
    process.env.ARCHIVE_S3_FORCE_PATH_STYLE = '1'; // MinIO needs path-style addressing

    // The AWS SDK itself creates the bucket — no `mc` CLI dependency, and no code under test yet
    // (persistArtifacts never creates its own bucket — an operator provisions it up front, exactly
    // like they would for a real S3/Scaleway deployment).
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

  it('persists an artifact to S3 and reads the exact same bytes back through storage.ts', async () => {
    const artifacts = [
      { role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF real bytes') },
    ];
    const { uri, contentHash } = await persistArtifacts('live-doc-1', artifacts);

    expect(uri).toBe(`s3://${bucket}/live-doc-1/${contentHash}`);

    const read = await readArchivedArtifact(uri, 'pdf', 'application/pdf');
    expect(read?.toString('utf-8')).toBe('%PDF real bytes');
  });

  it('artifactExists is true for a written artifact and false for one never written (real HEAD)', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
    const { uri } = await persistArtifacts('live-doc-2', artifacts);

    expect(await artifactExists(uri, 'pdf', 'application/pdf')).toBe(true);
    expect(await artifactExists(uri, 'facturx', 'application/pdf')).toBe(false);
  });

  it('readArchivedArtifact returns a real null (never throws) for a missing key', async () => {
    const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('x') }];
    const { uri } = await persistArtifacts('live-doc-3', artifacts);

    expect(await readArchivedArtifact(uri, 'facturx', 'application/pdf')).toBeNull();
  });

  it('deleteArchivedArtifacts really removes the object — exists/read both reflect it afterward', async () => {
    const artifacts = [
      { role: 'pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('to be deleted') },
    ];
    const { uri } = await persistArtifacts('live-doc-4', artifacts);
    expect(await artifactExists(uri, 'pdf', 'application/pdf')).toBe(true);

    await deleteArchivedArtifacts(uri);

    expect(await artifactExists(uri, 'pdf', 'application/pdf')).toBe(false);
    expect(await readArchivedArtifact(uri, 'pdf', 'application/pdf')).toBeNull();
  });
});
