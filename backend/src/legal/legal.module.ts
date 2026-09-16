import { Module } from '@nestjs/common';

import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * Always imported into `AppModule`, unlike `BillingModule` — `GET /api/legal/documents` stays
 * reachable on every instance (self-hosted included, per this feature's own product brief: there is
 * nothing to accept there, but the documents themselves are still public information worth serving).
 * `LegalService`/the acceptance-writing paths (`legal-acceptance.ts`) already no-op behind
 * `isBillingEnabled()` on their own, the same "the flag gates BEHAVIOR, not the route" shape a few
 * other always-mounted modules in this codebase use.
 */
@Module({
  controllers: [LegalController],
  providers: [LegalService],
})
export class LegalModule {}
