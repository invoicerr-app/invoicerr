/**
 * The HTTP half of hosted billing — imported into `app.module.ts` ONLY when `isBillingEnabled()` reads
 * `true` at process boot (a conditional entry in that file's own `imports` array, the exact same
 * `...(condition ? [Module] : [])` shape `WORKER_INLINE`/`envOidcProvider` already use there). With the
 * flag off, this module is never instantiated: its controllers (so `GET /api/billing/status` 404s,
 * Nest's own default for an unknown route) simply do not exist for the lifetime of the process — the
 * "invisible and inert" guarantee holds structurally, not by a runtime check inside this file.
 *
 * SPLIT from the queue's own providers/consumer (`billing-core.module.ts`/
 * `billing-queue-worker.module.ts`): this module used to ALSO carry `BullModule.forRoot`/
 * `registerQueue`, `BillingLifecycleSweepRunner`/`BillingExportService` and
 * `BillingLifecycleProcessor` directly, and being imported ONLY by `AppModule` (never
 * `worker.module.ts`) meant the billing-lifecycle sweep always ran on an API replica, competing with
 * request serving, while the target topology's dedicated workers never touched it — see
 * `billing-core.module.ts`'s own header for the full account. This module now imports
 * `BillingCoreModule` for what its OWN controllers need (nothing, today — see below) and to keep the
 * providers graph connected for anything added later; the actual queue wiring lives there instead.
 */
import { Module } from '@nestjs/common';

import { BillingCoreModule } from './billing-core.module';
import { BillingController } from './billing.controller';
import { SeatsController } from './seats.controller';

@Module({
  imports: [BillingCoreModule],
  controllers: [BillingController, SeatsController],
})
export class BillingModule {}
