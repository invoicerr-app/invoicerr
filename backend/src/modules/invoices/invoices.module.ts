import { InvoicesController } from "@/modules/invoices/invoices.controller";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { JwtService } from "@nestjs/jwt";
import { MailService } from "@/mail/mail.service";
import { Module } from "@nestjs/common";
import { PluginsService } from "@/modules/plugins/plugins.service";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { ComplianceModule } from "@/compliance/nest/compliance.module";
import { NumberingService } from "@/utils/numbering";

@Module({
  imports: [WebhooksModule, ComplianceModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, MailService, JwtService, PluginsService, NumberingService]
})
export class InvoicesModule { }
