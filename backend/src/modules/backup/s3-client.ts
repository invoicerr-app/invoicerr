/**
 * The backup module's S3 clients, built by the shared `lib/s3-client.ts` builder (the same one the
 * archive and inbound stores use) with this module's own missing-config message, so this module can
 * build TWO independent clients from two
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
import { buildS3ClientFromEnv as buildS3ClientFromPrefix } from '@/lib/s3-client';

/** `envPrefix` is `'ARCHIVE_S3'`, `'BACKUP_S3'` or `'INBOUND_S3'`; see `lib/s3-client.ts` for the
 *  five variables read under it. */
export function buildS3ClientFromEnv(envPrefix: 'ARCHIVE_S3' | 'BACKUP_S3' | 'INBOUND_S3'): S3Client {
  return buildS3ClientFromPrefix(
    envPrefix,
    (name) => `"${name}" is not set — the instance backup module needs it to reach S3.`,
  );
}
