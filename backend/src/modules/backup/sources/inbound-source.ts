/**
 * Enumerates every file under `DOCUMENTS_INBOUND_DIR`
 * (`documents/received-invoices/storage.ts#inboundRoot()`) — the ONE shared, content-hash-addressed
 * root that already stores THREE of this module's brief's categories: received-invoice uploads
 * (`received-invoices/storage.ts`), enriched-expense attachments
 * (`attachments/attachments.service.ts` reuses the exact same `persistInboundFile`/`readInboundFile`
 * pair), and company logos/branding (`rendering/branding/logo-storage.ts`, same reuse again). There
 * is no way to tell the three apart at this layer — a bare `<companyId>/<sha256>.<ext>` path carries
 * no marker of which of the three wrote it — so this walker does not try: it backs up the WHOLE root,
 * which is exactly "every document-related file the instance holds" outside the legal archive.
 *
 * Local disk ONLY, by construction — `inboundRoot()` has no S3 counterpart today (see that file's own
 * header): this is the one and only place these bytes can live, so unlike `archive-source.ts` there
 * is no "both providers" union to do here.
 */
import { Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { inboundRoot } from '@/modules/documents/received-invoices/storage';

import { BackupSourceFile } from './backup-source';

const INBOUND_KEY_PREFIX = 'inbound';

export function listInboundBackupSources(): BackupSourceFile[] {
  const root = inboundRoot();
  const files: BackupSourceFile[] = [];

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // The root (or a company subdirectory) not existing yet is a fresh instance that has never
      // stored an inbound file — an empty backup pass, never an error.
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const size = statSync(full).size;
      // `split(sep).join('/')`: this app only ever runs in Linux containers (`sep === '/'`), but a
      // developer running jest on another OS must still get a well-formed S3 key out of this — never
      // a bare, OS-dependent `path.relative` result passed straight through.
      const key = `${INBOUND_KEY_PREFIX}/${relative(root, full).split(sep).join('/')}`;
      // `async` even though the local read is synchronous — `BackupSourceFile.read` is a `Promise`
      // by contract (`archive-source.ts`'s own S3-backed sources genuinely await a network call), so
      // `backup-runner.ts` can treat every source the same way regardless of which walker produced it.
      files.push({ key, size, read: async () => readFileSync(full) });
    }
  };
  walk(root);
  return files;
}
