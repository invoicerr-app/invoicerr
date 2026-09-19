import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { InstanceOperatorGuard } from '@/guards/instance-operator.guard';

import { BackupStatusService, BackupStatusView } from './backup-status.service';

/**
 * READ-ONLY — deliberately no manual-trigger route here: the sweep is a scheduled, idempotent
 * repeatable, never a user-facing action (out of scope for this module — see its own mission).
 *
 * `InstanceOperatorGuard`, instance-wide even though this app is nominally multi-tenant — this used
 * to be `@Roles(OWNER)` on the theory that any company's OWNER could be trusted with an
 * instance-level read, there being no narrower "instance operator" concept in this app's own model at
 * the time. `modules/instance/**` introduced one (`INSTANCE_OPERATOR_EMAILS`,
 * `lib/instance-operators.ts`) for the reset feature, and this route names EXACTLY the same class of
 * fact a company OWNER has no legitimate business seeing (per-file object keys embedding OTHER
 * tenants' identifiers — see `backup-status.service.ts`'s own header on `PublicBackupRunSummary`) —
 * so it now requires a real instance operator, in BOTH self-hosted and SaaS, rather than "any OWNER".
 * `isBackupEnabled()` still gates whether this whole controller enters the DI graph at all
 * (`backup.module.ts`'s own header) — with no bucket configured, this route 404s like any other
 * unmatched path regardless of who is asking.
 */
@ApiTags('backup')
@Controller('backup')
@UseGuards(InstanceOperatorGuard)
export class BackupController {
  constructor(private readonly status: BackupStatusService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Instance file-backup status',
    description:
      'Last completed/failed sweep of the periodic instance file backup (legal archives plus ' +
      'received-invoice/attachment/logo uploads) to the dedicated BACKUP_S3_* bucket, plus the ' +
      'configured schedule and when the next sweep is due.',
  })
  @ApiResponse({ status: 200, description: 'Backup status' })
  async getStatus(): Promise<BackupStatusView> {
    return this.status.getStatus();
  }
}
