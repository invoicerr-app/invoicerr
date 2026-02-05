import { Module } from '@nestjs/common';
import { PluginsModule } from '../plugins/plugins.module';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [PluginsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcherService],
  exports: [WebhooksService, WebhookDispatcherService],
})
export class WebhooksModule {}
