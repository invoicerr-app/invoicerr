import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { QuotesController } from '@/modules/quotes/quotes.controller';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { PluginsModule } from '../plugins/plugins.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule, PluginsModule],
  controllers: [QuotesController],
  providers: [QuotesService, JwtService],
})
export class QuotesModule {}
