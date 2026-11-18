/**
 * Enumerates every file this instance holds under the shared inbound-file store — received-invoice
 * uploads (`received-invoices/storage.ts`), enriched-expense attachments
 * (`attachments/attachments.service.ts` reuses the exact same `persistInboundFile`/`readInboundFile`
 * pair), and company logos/branding (`rendering/branding/logo-storage.ts`, same reuse again). There is
 * no way to tell the three apart at this layer — a bare `<companyId>/<sha256>.<ext>` path/key carries
 * no marker of which of the three wrote it — so this walker does not try: it backs up EVERYTHING the
 * store holds, which is exactly "every document-related file the instance holds" outside the legal
 * archive.
 *
 * LOCAL and S3 alike — the same "both providers, best-effort" union `sources/archive-source.ts`
 * already documents its own reason for (an operator who migrated `INBOUND_STORAGE` mid-life has real
 * files sitting in BOTH places, and — unlike the archive — `received-invoices/storage.ts`'s own
 * dispatch is on the CURRENT env var for BOTH read and write, so a file stranded on the
 * provider NOT currently active would otherwise never be backed up again once the switch happened).
 * Local half is UNCONDITIONAL (cheap, no network call); S3 half runs whenever `INBOUND_S3_BUCKET` is
 * set, regardless of the CURRENT `INBOUND_STORAGE` value — same reasoning
 * `documents/archive/storage.ts#listArchivedArtifactKeys`'s own header gives for its own local half.
 */
import { inboundRoot } from '@/modules/documents/received-invoices/storage';

import { BackupSourceFile } from './backup-source';
import { listLocalAndS3Sources } from './local-and-s3-source';

/** Local root and `INBOUND_S3_*` bucket, merged and deduplicated by `local-and-s3-source.ts`. */
export async function listInboundBackupSources(): Promise<BackupSourceFile[]> {
  return listLocalAndS3Sources({
    root: inboundRoot(),
    keyPrefix: 'inbound',
    bucket: process.env.INBOUND_S3_BUCKET,
    s3EnvPrefix: 'INBOUND_S3',
  });
}
