import { Module } from '@nestjs/common';

import { BackupCoreModule } from './backup-core.module';
import { BackupController } from './backup.controller';
import { BackupStatusService } from './backup-status.service';

/**
 * HTTP half of the instance file-backup module — `GET /api/backup/status` only. Imported from
 * `app.module.ts` ONLY when `isBackupEnabled()` (`BACKUP_S3_BUCKET` set) — see that file's own
 * `backupEnabled` comment, the SAME "invisible and inert without its flag" contract `BillingModule`
 * already holds for hosted billing: with no bucket configured, this module never enters the graph at
 * all — no controller (so `GET /api/backup/status` 404s, Nest's own default for an unmatched route),
 * no BullMQ queue, no repeatable, nothing.
 *
 * Re-exports `BackupCoreModule` for the same reason `DocumentsModule` re-exports
 * `DocumentsCoreModule` (Nest cannot re-export an individual token provided by an imported module) —
 * kept for shape consistency with the rest of this codebase's Core/HTTP split even though nothing
 * outside this module currently needs to import it for that.
 */
@Module({
  imports: [BackupCoreModule],
  controllers: [BackupController],
  providers: [BackupStatusService],
  exports: [BackupCoreModule],
})
export class BackupModule {}
