import { Module } from '@nestjs/common';
import { WebhookSecretMigrationService } from './webhook-secret-migration.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksCoreModule } from './webhooks-core.module';

/**
 * The HTTP half of outbound webhooks — CRUD plus the WEBHOOK_* lifecycle events, split from the
 * queue's own providers/consumer (`webhooks-core.module.ts` / `queue/webhooks-queue-worker.module.ts`)
 * the same way `billing.module.ts`/`transfer.module.ts` already are — see `webhooks-core.module.ts`'s
 * own header for what moved and why.
 *
 * `exports: [WebhooksCoreModule]` (re-exporting the WHOLE Core module, never an individual provider
 * token — Nest cannot re-export a token provided by an imported module any other way, the same
 * constraint `documents.module.ts`'s own header documents for `DocumentsCoreModule`) is what lets THIS
 * module's own importers (`company.module.ts`, `clients.module.ts`, `documents-core.module.ts`,
 * `sdi-notifiche.module.ts`) keep resolving `WebhooksService`/`WebhookDispatcherService` exactly as
 * before, unchanged — none of them need `WebhooksController` at all, only the providers Core now holds.
 *
 * `WebhookSecretMigrationService` stays HERE rather than moving to Core: nothing about its own
 * boot-time migration needs to be worker-only or API-only, and it was ALREADY reachable from the
 * worker process before this split existed (`documents-core.module.ts` has always imported
 * `WebhooksModule` directly, and `DocumentsQueueWorkerModule` imports `DocumentsCoreModule`) — moving
 * it would change nothing observable, so it is left where it has always lived.
 */
@Module({
  imports: [WebhooksCoreModule],
  controllers: [WebhooksController],
  providers: [WebhookSecretMigrationService],
  exports: [WebhooksCoreModule],
})
export class WebhooksModule {}
