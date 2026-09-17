import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { BackupStatusService, BackupStatusView } from './backup-status.service';

/**
 * READ-ONLY — deliberately no manual-trigger route here: the sweep is a scheduled, idempotent
 * repeatable, never a user-facing action (out of scope for this module — see its own mission).
 *
 * `@Roles(OWNER)`, instance-wide even though this app is nominally multi-tenant — the same posture
 * `danger.controller.ts`'s own `reset/all` already holds for an instance-level action: any company's
 * OWNER is trusted with this, there being no narrower "instance operator" role in this app's own
 * model. This whole controller only ever enters the DI graph when `isBackupEnabled()` is true — see
 * `backup.module.ts`'s own header — so there is no "disabled but visible" state to additionally guard
 * against here: with no bucket configured, this route 404s like any other unmatched path.
 */
@ApiTags('backup')
@Controller('backup')
@Roles(CompanyRole.OWNER)
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
