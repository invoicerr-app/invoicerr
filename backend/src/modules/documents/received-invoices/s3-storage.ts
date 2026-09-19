/**
 * S3-compatible implementation of the inbound file store — `storage.ts` routes every one of the four
 * functions below to here whenever `INBOUND_STORAGE=s3`. Read that file's own header FIRST: unlike
 * `archive/s3-storage.ts` (dispatch on the archive's OWN `s3://`/`file://` uri at read time, because
 * `DocumentArchive.uri` is a persisted DB column), nothing calling into THIS store ever keeps a uri
 * around — every caller re-derives the read path from `(companyId, sha256, mime)` alone — so
 * `storage.ts`'s dispatch (both write AND read) is on the CURRENT `INBOUND_STORAGE` value, never on a
 * uri scheme. None of the exported functions here are imported by anything except `storage.ts`.
 *
 * Config (`INBOUND_S3_BUCKET`, `INBOUND_S3_ENDPOINT`, `INBOUND_S3_REGION`,
 * `INBOUND_S3_ACCESS_KEY_ID`, `INBOUND_S3_SECRET_ACCESS_KEY`, `INBOUND_S3_FORCE_PATH_STYLE`) is read
 * FRESH on every call — never cached at module load — same discipline `archive/s3-storage.ts#
 * buildClient` and `storage.ts#inboundRoot()` both already hold: a test (or a live process
 * reconfigured at runtime) must see a changed env var take effect on the very next call.
 *
 * FAILS LOUD on missing config (`requireEnv` below), same reasoning `archive/s3-storage.ts`'s own
 * header gives for the legal archive: a silent fallback to local disk, or to a half-configured
 * client, would itself be the defect — an uploaded supplier invoice or a company logo silently NOT
 * durably stored is exactly the failure mode this guards against, not merely a legal-archive concern.
 *
 * Key layout mirrors `storage.ts`'s local layout exactly: object key `<companyId>/<sha256>.<ext>`
 * (via `extFor`, imported from `storage.ts` — the two modules import each other, which is fine:
 * neither calls the other at module-evaluation time, only from inside these functions' bodies, by
 * which point both modules have finished loading — same note `archive/s3-storage.ts`'s own header
 * makes for its own `storage.ts` import). `uri = s3://<bucket>/<companyId>/<sha256>.<ext>`, returned
 * by `persistInboundFileS3` for interface parity with the local implementation — note this uri is
 * NEVER persisted by any caller today (see this file's own header above), so nothing reads it back in.
 *
 * ## Tenant isolation — what an attacker controls, and why it cannot reach another company's object
 * A caller of `readInboundFile`/`persistInboundFile` controls exactly two values: `sha256` (validated
 * by `assertValidContentHash` — exactly 64 lowercase hex characters, hard-refused otherwise, BEFORE it
 * ever becomes part of an object key) and `mime` (mapped through `extFor`'s own small, fixed
 * vocabulary — never interpolated raw). NEITHER can contain `/` (hex digits and the extensions
 * `extFor` returns never do), so neither can ever inject an extra path segment into the key. The
 * REMAINING segment, `companyId`, is never attacker-supplied in the first place: every caller
 * (`received-invoices.controller.ts`, `documents.controller.ts#downloadAttachment`,
 * `branding.controller.ts`) obtains it from `@ActiveCompany()`, resolved server-side from the
 * authenticated session's own company membership — never a request body/query/path parameter a caller
 * could set to a different tenant's id. A malformed or path-traversal-shaped `sha256` (e.g.
 * `"../other-company/deadbeef..."`) is refused by `assertValidContentHash` before `objectKey` is ever
 * called, so it never reaches `PutObjectCommand`/`GetObjectCommand` at all — the same "validated
 * before it becomes part of a key" guarantee `storage.ts`'s own local implementation holds for a
 * filesystem path.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { assertValidContentHash, extFor } from './storage';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `INBOUND_STORAGE=s3 but "${name}" is not set — refusing to silently fall back to local disk, or ` +
        `to a half-configured S3 client, for an uploaded inbound file.`,
    );
  }
  return value;
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Everything needed to talk to S3 EXCEPT the bucket name — see `archive/s3-storage.ts#buildClient`'s
 *  own header for why `INBOUND_S3_ENDPOINT` is optional (real AWS resolves its own regional endpoint)
 *  while `INBOUND_S3_FORCE_PATH_STYLE` exists for providers (some Scaleway/MinIO setups included) that
 *  need path-style addressing. */
function buildClient(): S3Client {
  return new S3Client({
    region: requireEnv('INBOUND_S3_REGION'),
    endpoint: process.env.INBOUND_S3_ENDPOINT || undefined,
    forcePathStyle: isTruthyFlag(process.env.INBOUND_S3_FORCE_PATH_STYLE),
    credentials: {
      accessKeyId: requireEnv('INBOUND_S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('INBOUND_S3_SECRET_ACCESS_KEY'),
    },
  });
}

/** `<companyId>/<sha256>.<ext>` — lowercased, exactly like `archive/s3-storage.ts#objectKey`'s own
 *  role/mime pairing. Callers below MUST call `assertValidContentHash(sha256)` before this, never
 *  after — see this file's own header on why that ordering is the actual tenant-isolation guarantee
 *  for the hash half of this key. */
function objectKey(companyId: string, sha256: string, mime: string): string {
  return `${companyId}/${sha256}.${extFor(mime)}`.toLowerCase();
}

/** True for both flavors of "this object does not exist" the SDK can throw — see
 *  `archive/s3-storage.ts#isMissingObjectError`'s own header for why GET and HEAD name the "missing"
 *  case differently under the hood despite both being a plain 404. */
function isMissingObjectError(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  const statusCode = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404;
}

/** See `storage.ts#persistInboundFile` for the caller-facing contract. `assertValidContentHash` runs
 *  FIRST, before `objectKey`/`requireEnv`/any network call — a malformed hash must never reach the S3
 *  client at all, exactly like the local implementation's own ordering. */
export async function persistInboundFileS3(
  companyId: string,
  sha256: string,
  mime: string,
  bytes: Uint8Array,
): Promise<string> {
  assertValidContentHash(sha256);
  const bucket = requireEnv('INBOUND_S3_BUCKET');
  const key = objectKey(companyId, sha256, mime);
  const client = buildClient();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(bytes), ContentType: mime }),
  );
  return `s3://${bucket}/${key}`;
}

/** See `storage.ts#readInboundFile` for the caller-facing contract: `null` (never a thrown error) both
 *  for a missing object AND for a `sha256` that fails `assertValidContentHash` — the identical "a
 *  traversal-shaped or malformed hash is a MISS, never a crash" contract
 *  `storage.ts#readInboundFileLocal` already holds for the exact same reason (`sha256` reaches this
 *  function straight off an HTTP route param in more than one caller, never validated there). */
export async function readInboundFileS3(
  companyId: string,
  sha256: string,
  mime: string,
): Promise<Buffer | null> {
  try {
    assertValidContentHash(sha256);
  } catch {
    return null;
  }
  const bucket = requireEnv('INBOUND_S3_BUCKET');
  const client = buildClient();
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey(companyId, sha256, mime) }),
    );
    if (!result.Body) return null;
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}

/** Lists then batch-deletes every key under `prefix` (or the WHOLE bucket when `prefix` is
 *  `undefined` — `deleteAllInboundObjectsS3`'s own case). `DeleteObjectsCommand` caps at 1000 keys per
 *  call, so the delete step is chunked exactly like the list step already paginates — an
 *  instance-wide wipe (no prefix at all) is the one caller here actually likely to exceed that in a
 *  real deployment. */
async function deleteAllUnderPrefix(
  client: S3Client,
  bucket: string,
  prefix: string | undefined,
): Promise<void> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }),
    );
  }
}

/** See `storage.ts#deleteInboundFilesForCompany` for the caller-facing contract — every object under
 *  this ONE company's own `<companyId>/` prefix, never a different tenant's. */
export async function deleteInboundFilesForCompanyS3(companyId: string): Promise<void> {
  const bucket = requireEnv('INBOUND_S3_BUCKET');
  const client = buildClient();
  await deleteAllUnderPrefix(client, bucket, `${companyId}/`);
}

/** See `storage.ts#wipeAllInboundFiles` for the caller-facing contract — every object in the WHOLE
 *  configured bucket, every company at once. Safe as a full-bucket operation under the same assumption
 *  `archive.s3.bucket` already carries for the legal archive: `INBOUND_S3_BUCKET` is a bucket DEDICATED
 *  to this store, never one this app shares with something else it must not touch. */
export async function deleteAllInboundObjectsS3(): Promise<void> {
  const bucket = requireEnv('INBOUND_S3_BUCKET');
  const client = buildClient();
  await deleteAllUnderPrefix(client, bucket, undefined);
}
