import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { QuotesController } from '@/modules/quotes/quotes.controller';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { PluginsModule } from '../plugins/plugins.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule, PluginsModule, ComplianceModule],
  controllers: [QuotesController],
  providers: [QuotesService, JwtService],
})
export class QuotesModule {}
