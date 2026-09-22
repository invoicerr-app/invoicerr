/**
 * Runs `checkArchiveStorageSharing` (`storage.ts`) on EVERY backend boot — same `OnModuleInit`-on-
 * every-process shape as `country-policy/boot-reseed.service.ts` (registered alongside it in
 * `documents-core.module.ts`, so both the inline API process AND a dedicated `WORKER_INLINE=false`
 * worker replica run this exactly once per boot, since both import `DocumentsCoreModule`).
 *
 * `storage.ts`'s own header names the failure this guards against precisely: a split API/worker
 * deployment with `ARCHIVE_STORAGE=local` (the default) needs `DOCUMENTS_ARCHIVE_DIR` to resolve to
 * the SAME mounted volume in every container, or `verifyDocumentArchive` (`persistence.ts`) silently
 * reports every archive `{status:'corrupted', actual:null}` from whichever role did not write it — a
 * legal integrity control lying about intact archives. This service is what turns that into a NAMED,
 * loud warning at boot instead of a surprise the first time someone actually runs a verification.
 *
 * NEVER throws, and never blocks boot — deliberately weaker than `CountryPolicyBootReseedService`'s
 * own bounded-retry-then-error escalation: a missing/misconfigured `DOCUMENTS_ARCHIVE_DIR` degrades
 * to "a legal control is unreliable until fixed", not "the country's own document actions 403" — the
 * existing, already-loud failure mode `CountryPolicyBootReseedService`'s own header contrasts against.
 * Refusing to boot over a storage-sharing misconfiguration would take down invoicing entirely for a
 * problem that, today, only affects the INTEGRITY-VERIFICATION endpoint — disproportionate for a
 * WARNING this mechanism exists precisely to surface loudly, not to escalate into an outage.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { checkArchiveStorageSharing } from './storage';

@Injectable()
export class ArchiveStorageSharingBootCheckService implements OnModuleInit {
  private readonly logger = new Logger(ArchiveStorageSharingBootCheckService.name);

  onModuleInit(): void {
    // `ROLE` mirrors `entrypoint.sh`'s own switch (`ROLE=worker` for the dedicated worker process,
    // unset/anything else defaults to `api`) — the same string `checkArchiveStorageSharing` uses to
    // name its own witness file, so an API boot and a worker boot never collide on the SAME filename
    // while still proving they see each other's.
    const role = process.env.ROLE === 'worker' ? 'worker' : 'api';
    let result: ReturnType<typeof checkArchiveStorageSharing>;
    try {
      result = checkArchiveStorageSharing(role);
    } catch (error) {
      // Defensive only — `checkArchiveStorageSharing` itself already catches every filesystem error
      // it can reach and reports `shared: false` with a reason instead of throwing (see its own
      // header). A boot-time check must never be what takes the process down over a storage detail
      // this mechanism exists only to WARN about.
      this.logger.warn(
        `Could not run the archive-storage sharing check at boot — ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (result.shared) {
      this.logger.log(`Archive storage sharing check (${role}): ${result.reason}`);
      return;
    }

    this.logger.warn(
      `Archive storage is NOT confirmed shared between roles (${role}) — legal archive-integrity ` +
        `verification may report false corruption until this is fixed: ${result.reason}`,
    );
  }
}
