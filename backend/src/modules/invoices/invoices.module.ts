import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/mail/mail.service';
import { InvoicesController } from '@/modules/invoices/invoices.controller';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { PluginsService } from '@/modules/plugins/plugins.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule, ComplianceModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, MailService, JwtService, PluginsService],
})
export class InvoicesModule {}
