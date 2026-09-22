/**
 * A tiny, env-prefix-parameterized S3 client builder — the same "fail loud on missing config, never
 * silently degrade" style `documents/archive/s3-storage.ts#buildClient` already holds (see that
 * file's own header), generalized so this module can build TWO independent clients from two
 * independent env-var families: `ARCHIVE_S3_*` (read-only here — the PRIMARY archive bucket, when the
 * operator put outbound documents there — see `sources/archive-source.ts`) and `BACKUP_S3_*` (the
 * SECONDARY, dedicated backup bucket this module writes to — see `backup-destination.ts`). Never a
 * shared `S3Client` instance between the two: different credentials, and very often a different
 * endpoint/provider entirely (the whole point of a separate backup destination is surviving the loss
 * of whatever holds the primary one).
 *
 * A third prefix, `INBOUND_S3`, was added alongside `documents/received-invoices/s3-storage.ts`'s own
 * S3 mode — read-only here too (the PRIMARY inbound-file bucket, when `INBOUND_STORAGE=s3` — see
 * `sources/inbound-source.ts`), same "own client, own credentials" isolation from `BACKUP_S3_*`.
 */
import { S3Client } from '@aws-sdk/client-s3';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`"${name}" is not set — the instance backup module needs it to reach S3.`);
  }
  return value;
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/**
 * `envPrefix` is `'ARCHIVE_S3'` or `'BACKUP_S3'` — reads `<envPrefix>_REGION` / `_ENDPOINT` /
 * `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_FORCE_PATH_STYLE`, the exact same five-variable shape
 * `archive/s3-storage.ts#buildClient` already uses for `ARCHIVE_S3_*` alone. `_ENDPOINT` is the one
 * OPTIONAL variable (real AWS resolves its own regional endpoint); every other one is required —
 * `_FORCE_PATH_STYLE` is read as a flag (never required) since most providers, AWS included, default
 * to virtual-hosted-style addressing fine.
 */
export function buildS3ClientFromEnv(envPrefix: 'ARCHIVE_S3' | 'BACKUP_S3' | 'INBOUND_S3'): S3Client {
  return new S3Client({
    region: requireEnv(`${envPrefix}_REGION`),
    endpoint: process.env[`${envPrefix}_ENDPOINT`] || undefined,
    forcePathStyle: isTruthyFlag(process.env[`${envPrefix}_FORCE_PATH_STYLE`]),
    credentials: {
      accessKeyId: requireEnv(`${envPrefix}_ACCESS_KEY_ID`),
      secretAccessKey: requireEnv(`${envPrefix}_SECRET_ACCESS_KEY`),
    },
  });
}
