/**
 * S3-compatible implementation of the archive's byte storage — the WRITE side `storage.ts` routes to
 * when `ARCHIVE_STORAGE=s3`, and the READ/EXISTS/DELETE/LIST side any `s3://` URI (or, for the list,
 * a configured `ARCHIVE_S3_BUCKET`) routes to regardless of the CURRENT value of that env var — see
 * `storage.ts`'s own header on why the URI, not the env var, is the source of truth at read time.
 * None of the exported functions here are imported by anything except `storage.ts` — every other
 * caller in this codebase goes through that facade's provider-agnostic names.
 *
 * Config (`ARCHIVE_S3_BUCKET`, `ARCHIVE_S3_ENDPOINT`, `ARCHIVE_S3_REGION`,
 * `ARCHIVE_S3_ACCESS_KEY_ID`, `ARCHIVE_S3_SECRET_ACCESS_KEY`, `ARCHIVE_S3_FORCE_PATH_STYLE`) is read
 * FRESH on every call — never cached at module load — same discipline as `storage.ts#archiveRoot()`:
 * a test (or a live process reconfigured at runtime) must see a changed env var take effect on the
 * very next call, not on the next process restart.
 *
 * FAILS LOUD on missing config (`requireEnv` below) rather than silently keeping the archive on local
 * disk or on a half-configured client: this is a LEGAL archive, and a silent storage-location switch
 * — writing to the wrong place, or worse, an operator believing they moved to S3 while every write
 * quietly still lands on local disk — would itself be a compliance defect, and a much worse one than
 * a loud boot/write-time crash naming exactly which env var is missing.
 *
 * Key layout mirrors `storage.ts`'s local layout exactly: object key
 * `<documentId>/<contentHash>/<role>.<ext>` (via `extFor`, imported from `storage.ts` — the two
 * modules import each other, which is fine: nothing here calls `extFor` at module-evaluation time,
 * only from inside these functions' bodies, by which point both modules have finished loading).
 * `uri = s3://<bucket>/<documentId>/<contentHash>` — the BUCKET NAME is embedded in the uri (so a
 * read/verify years later is self-contained even if `ARCHIVE_S3_BUCKET` is later repointed at a
 * different bucket), but region/endpoint/credentials are NOT: those are re-derived from CURRENT env
 * at read time, since they are not secrets that belong sitting in a database column.
 *
 * --- Object Lock / WORM — documented, NOT implemented. Three honest points, none of them verified
 * against Scaleway's own documentation this session (two WebFetch attempts against scaleway.com
 * returned only page-navigation chrome, no article body — so nothing Scaleway-specific below is a
 * verified claim):
 *  (a) Standard S3 Object Lock requires bucket VERSIONING and is normally configured as a
 *      BUCKET-LEVEL default retention (`PutObjectLockConfiguration`, done ONCE by the operator
 *      outside this code — e.g. the Scaleway console or `aws s3api put-object-lock-configuration`).
 *      Once that default exists, every plain `PutObjectCommand` this file already issues
 *      automatically inherits it — NO per-call code change is needed for the common case.
 *  (b) Per-object overrides (`ObjectLockMode` / `ObjectLockRetainUntilDate` on `PutObjectCommand`)
 *      are NOT implemented here, because this repo's own call order computes the document's legal
 *      retention window AFTER `persistArtifacts` already ran (`persistence.ts`: `computeRetention`
 *      runs after `persistArtifacts`, inside `createDocumentArchive`) — wiring a per-object retention
 *      date would mean reordering that WORM-critical persistence flow, which is out of scope for this
 *      change. Noted here as explicit FUTURE WORK if per-document (rather than one bucket-wide
 *      default) retention is ever required.
 *  (c) Whether Scaleway's specific Object Storage product actually implements the S3 Object Lock API
 *      end to end was NOT independently verified this session — stated plainly rather than asserted.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { ArchivedArtifactInput, computeContentHash } from './hashing';
import { extFor } from './storage';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `ARCHIVE_STORAGE=s3 (or an s3:// archive is being read) but "${name}" is not set — refusing to ` +
        `silently fall back to local disk, or to a half-configured S3 client, for a legal archive.`,
    );
  }
  return value;
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Everything needed to talk to S3 EXCEPT the bucket name, which for a WRITE comes straight from
 *  `ARCHIVE_S3_BUCKET` and for a READ/EXISTS/DELETE is parsed out of the archive's own `s3://` uri
 *  instead (see `parseS3Uri` below) — see this file's own header on why the bucket travels in the uri
 *  while everything else here is re-read from current env. `ARCHIVE_S3_ENDPOINT` is OPTIONAL: omit it
 *  for real AWS (the SDK resolves the regional endpoint on its own); it is REQUIRED for Scaleway
 *  (`https://s3.<region>.scw.cloud`) and most other S3-compatible providers.
 *  `ARCHIVE_S3_FORCE_PATH_STYLE` is needed by some S3-compatible endpoints (including some Scaleway
 *  setups) that do not support virtual-hosted-style addressing — AWS itself does not need this. */
function buildClient(): S3Client {
  return new S3Client({
    region: requireEnv('ARCHIVE_S3_REGION'),
    endpoint: process.env.ARCHIVE_S3_ENDPOINT || undefined,
    forcePathStyle: isTruthyFlag(process.env.ARCHIVE_S3_FORCE_PATH_STYLE),
    credentials: {
      accessKeyId: requireEnv('ARCHIVE_S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('ARCHIVE_S3_SECRET_ACCESS_KEY'),
    },
  });
}

/** `s3://<bucket>/<documentId>/<contentHash>` -> `{ bucket, prefix }`. Throws (never silently
 *  misparses) on anything that is not that exact shape — a malformed uri here means the DB row itself
 *  is corrupt, which `verifyDocumentArchive`'s caller needs to know about rather than have masked. */
function parseS3Uri(uri: string): { bucket: string; prefix: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) {
    throw new Error(`Not a valid s3:// archive URI: "${uri}"`);
  }
  return { bucket: match[1], prefix: match[2] };
}

function objectKey(prefix: string, role: string, mime: string): string {
  return `${prefix}/${role}.${extFor(mime)}`.toLowerCase();
}

/** True for both flavors of "this object does not exist" the SDK can throw: `GetObjectCommand`
 *  raises a named `NoSuchKey` error, `HeadObjectCommand` raises a named `NotFound` error instead
 *  (same underlying 404, different error shape per S3 API operation) — callers below must treat both
 *  identically as "missing", never as a real failure. */
function isMissingObjectError(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  const statusCode = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404;
}

/** See `storage.ts#persistArtifacts` for the caller-facing contract this mirrors exactly (same
 *  returned shape, same content-hash-first ordering). `ARCHIVE_S3_BUCKET` is required directly here
 *  (rather than folded into `buildClient()`) because a WRITE needs it to build the key/uri, while a
 *  READ/EXISTS/DELETE gets it from the uri instead — see `parseS3Uri`. */
export async function persistArtifactsS3(
  documentId: string,
  artifacts: ArchivedArtifactInput[],
): Promise<{ uri: string; contentHash: string }> {
  const bucket = requireEnv('ARCHIVE_S3_BUCKET');
  const contentHash = computeContentHash(artifacts);
  const prefix = `${documentId}/${contentHash}`;
  const client = buildClient();

  for (const artifact of artifacts) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey(prefix, artifact.role, artifact.mime),
        Body: Buffer.from(artifact.bytes),
        ContentType: artifact.mime,
      }),
    );
  }

  return { uri: `s3://${bucket}/${prefix}`, contentHash };
}

/** See `storage.ts#readArchivedArtifact` for the caller-facing contract: `null` (never a thrown
 *  error) when the object does not exist — the exact same contract the local implementation holds for
 *  a missing file. */
export async function readArchivedArtifactS3(
  uri: string,
  role: string,
  mime: string,
): Promise<Buffer | null> {
  const { bucket, prefix } = parseS3Uri(uri);
  const client = buildClient();
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey(prefix, role, mime) }),
    );
    if (!result.Body) return null;
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}

/** HEAD, not GET — cheaper than reading the bytes just to know whether they exist. */
export async function artifactExistsS3(uri: string, role: string, mime: string): Promise<boolean> {
  const { bucket, prefix } = parseS3Uri(uri);
  const client = buildClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(prefix, role, mime) }));
    return true;
  } catch (err) {
    if (isMissingObjectError(err)) return false;
    throw err;
  }
}

/** Deletes every object under this archive's key prefix — see `storage.ts#deleteArchivedArtifacts`'s
 *  own doc comment on why this exists (interface parity) despite nothing calling it. Paginates
 *  through `ListObjectsV2Command` (an archive with only a handful of artifacts never needs a second
 *  page, but nothing here assumes that) before batch-deleting via `DeleteObjectsCommand`. */
export async function deleteArchivedArtifactsS3(uri: string): Promise<void> {
  const { bucket, prefix } = parseS3Uri(uri);
  const client = buildClient();

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  if (keys.length === 0) return;
  await client.send(
    new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }),
  );
}

/** See `storage.ts#listArchivedArtifactKeys`'s own doc comment for the "read by nothing yet" status
 *  and the "both providers" rationale — this half lists the ENTIRE configured bucket (no prefix
 *  filter: every document this instance ever archived to S3), returned as `s3://<bucket>/<key>`
 *  entries so the combined result stays provider-taggable without the caller having to guess. */
export async function listArchivedArtifactKeysS3(): Promise<string[]> {
  const bucket = requireEnv('ARCHIVE_S3_BUCKET');
  const client = buildClient();

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(`s3://${bucket}/${object.Key}`);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}
