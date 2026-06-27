import { Module } from '@nestjs/common';
import { InvoiceRenderingService } from './invoice-rendering.service';
import { InvoiceMailGateway } from './invoice-mail.gateway';
import { MailService } from '@/mail/mail.service';

@Module({
  providers: [InvoiceRenderingService, MailService, InvoiceMailGateway],
  exports: [InvoiceRenderingService, InvoiceMailGateway],
})
export class InvoiceRenderingModule {}
