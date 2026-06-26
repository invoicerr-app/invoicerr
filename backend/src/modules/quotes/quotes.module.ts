import { InvoicesModule } from '@/modules/invoices/invoices.module';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { QuotesController } from '@/modules/quotes/quotes.controller';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ComplianceModule } from '@/compliance/nest/compliance.module';
import { NumberingService } from '@/utils/numbering';

@Module({
  imports: [WebhooksModule, ComplianceModule, InvoicesModule],
  controllers: [QuotesController],
  providers: [QuotesService, JwtService, NumberingService],
  exports: [QuotesService],
})
export class QuotesModule { }
