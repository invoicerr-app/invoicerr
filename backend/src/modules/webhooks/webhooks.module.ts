import { Module } from '@nestjs/common';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookSecretMigrationService } from './webhook-secret-migration.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcherService, WebhookSecretMigrationService],
  exports: [WebhooksService, WebhookDispatcherService],
})
export class WebhooksModule {}
