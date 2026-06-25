import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { QuotesController } from '@/modules/quotes/quotes.controller';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ComplianceModule } from '@/compliance/nest/compliance.module';

@Module({
  imports: [WebhooksModule, ComplianceModule],
  controllers: [QuotesController],
  providers: [QuotesService, JwtService]
})
export class QuotesModule { }
