/**
 * The one S3 client builder every S3-backed store in this codebase uses: the legal archive
 * (`documents/archive/s3-storage.ts`, `ARCHIVE_S3_*`), the inbound file store
 * (`documents/received-invoices/s3-storage.ts`, `INBOUND_S3_*`) and the instance backup module
 * (`backup/s3-client.ts`, which reads `ARCHIVE_S3_*`, `INBOUND_S3_*` and its own `BACKUP_S3_*`).
 * Each family is an env-var prefix, read FRESH on every call (never cached at module load), so a
 * changed env var takes effect on the very next call.
 *
 * FAILS LOUD on missing config: `requireEnv` throws rather than letting a caller silently fall back
 * to local disk or to a half-configured client. The wording of that error belongs to each caller
 * (each one names the setting that made S3 necessary), so it is a parameter here, never a shared
 * sentence. Region and both credentials are required; `_ENDPOINT` is OPTIONAL (real AWS resolves its
 * own regional endpoint; Scaleway and most S3-compatible providers need it); `_FORCE_PATH_STYLE` is a
 * flag for providers that do not support virtual-hosted-style addressing.
 *
 * Never a shared `S3Client` instance between families: different credentials, and very often a
 * different provider entirely (a backup bucket exists to survive the loss of the primary one).
 */
import { S3Client } from '@aws-sdk/client-s3';

/** Builds the error message for a missing env var, from that var's name. */
export type MissingS3EnvMessage = (name: string) => string;

export function requireEnv(name: string, missingMessage: MissingS3EnvMessage): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(missingMessage(name));
  }
  return value;
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Reads `<envPrefix>_REGION` / `_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` /
 *  `_FORCE_PATH_STYLE`. Everything needed to talk to S3 EXCEPT the bucket name, which each caller
 *  resolves itself (from `<envPrefix>_BUCKET` for a write, or from a stored `s3://` uri). */
export function buildS3ClientFromEnv(envPrefix: string, missingMessage: MissingS3EnvMessage): S3Client {
  return new S3Client({
    region: requireEnv(`${envPrefix}_REGION`, missingMessage),
    endpoint: process.env[`${envPrefix}_ENDPOINT`] || undefined,
    forcePathStyle: isTruthyFlag(process.env[`${envPrefix}_FORCE_PATH_STYLE`]),
    credentials: {
      accessKeyId: requireEnv(`${envPrefix}_ACCESS_KEY_ID`, missingMessage),
      secretAccessKey: requireEnv(`${envPrefix}_SECRET_ACCESS_KEY`, missingMessage),
    },
  });
}

/** True for both flavors of "this object does not exist" the SDK can throw: `GetObjectCommand`
 *  raises a named `NoSuchKey` error, `HeadObjectCommand` raises a named `NotFound` error instead
 *  (same underlying 404, different error shape per S3 API operation). Callers must treat both
 *  identically as "missing", never as a real failure. */
export function isMissingObjectError(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  const statusCode = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404;
}
