import { Module } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';
import { LegalController } from './legal.controller';
import { LegalReleaseBootService } from './legal-release-boot.service';
import { LegalService } from './legal.service';

/**
 * Always imported into `AppModule`, unlike `BillingModule` — `GET /api/legal/documents` stays
 * reachable on every instance (self-hosted included, per this feature's own product brief: there is
 * nothing to accept there, but the documents themselves are still public information worth serving).
 * `LegalService`/the acceptance-writing paths (`legal-acceptance.ts`) already no-op behind
 * `isBillingEnabled()` on their own, the same "the flag gates BEHAVIOR, not the route" shape a few
 * other always-mounted modules in this codebase use. `LegalReleaseBootService` follows the exact same
 * posture — its `OnModuleInit` records release history on every instance, and gates only its own
 * SaaS-only email step behind the flag (`legal-release-boot.service.ts`'s own header).
 *
 * `MailService` is provided directly here rather than imported from a shared mail module — a leaf,
 * empty-constructor provider, the same "declare it locally" choice `billing.module.ts`'s own comment
 * on `MailService` explains (there is no app-wide `MailModule` to import instead).
 */
@Module({
  controllers: [LegalController],
  providers: [LegalService, MailService, LegalReleaseBootService],
})
export class LegalModule {}
