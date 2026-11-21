import { Module } from '@nestjs/common';
import { WebhookSecretMigrationService } from './webhook-secret-migration.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksCoreModule } from './webhooks-core.module';

/**
 * The HTTP half of outbound webhooks: CRUD plus the WEBHOOK_* lifecycle events. Re-exporting
 * `WebhooksCoreModule` (Nest cannot re-export a single provider from an imported module) keeps its
 * importers resolving `WebhooksService`/`WebhookDispatcherService` unchanged. The secret migration stays
 * here because it needs neither half in particular.
 */
@Module({
  imports: [WebhooksCoreModule],
  controllers: [WebhooksController],
  providers: [WebhookSecretMigrationService],
  exports: [WebhooksCoreModule],
})
export class WebhooksModule {}
