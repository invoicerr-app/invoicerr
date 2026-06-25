import { InvoicesModule } from '@/modules/invoices/invoices.module';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/mail/mail.service';
import { Module } from '@nestjs/common';
import { RecurringInvoicesController } from '@/modules/recurring-invoices/recurring-invoices.controller';
import { RecurringInvoicesCronService } from '@/modules/recurring-invoices/cron.service';
import { RecurringInvoicesService } from '@/modules/recurring-invoices/recurring-invoices.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule, InvoicesModule],
  controllers: [RecurringInvoicesController],
  providers: [
    RecurringInvoicesService,
    RecurringInvoicesCronService,
    MailService,
    JwtService,
  ],
  exports: [RecurringInvoicesService, RecurringInvoicesCronService],
})
export class RecurringInvoicesModule { }
