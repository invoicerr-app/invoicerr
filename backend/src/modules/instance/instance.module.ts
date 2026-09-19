import { Module } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';

import { InstanceController } from './instance.controller';
import { InstancePreflightService } from './instance-preflight.service';
import { InstanceResetService } from './instance-reset.service';

/**
 * Instance-wide, cross-tenant actions — today, just the "reset this whole deployment" flow. Always
 * imported into `AppModule` (unlike `BillingModule`/`BackupModule`, never conditionally): the SaaS
 * refusal and the operator allowlist are BOTH enforced dynamically, per request, by the two guards
 * `InstanceController` stacks (`InstanceResetSaasGuard`, `InstanceOperatorGuard` — see their own
 * headers), so there is no build-time flag this module itself needs to be gated on. Neither guard is
 * listed below as a provider — same "referenced via `@UseGuards()`, resolved by Nest without needing
 * to be a registered provider" pattern `client-portal.module.ts` already uses for `PortalAuthGuard`.
 */
@Module({
  controllers: [InstanceController],
  providers: [InstancePreflightService, InstanceResetService, MailService],
})
export class InstanceModule {}
