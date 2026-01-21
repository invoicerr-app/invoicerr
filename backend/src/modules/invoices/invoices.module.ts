import { InvoicesController } from "@/modules/invoices/invoices.controller";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { JwtService } from "@nestjs/jwt";
import { MailService } from "@/mail/mail.service";
import { Module } from "@nestjs/common";
import { PluginsService } from "@/modules/plugins/plugins.service";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { ComplianceModule } from "../compliance/compliance.module";

@Module({
  imports: [WebhooksModule, ComplianceModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, MailService, JwtService, PluginsService]
})
export class InvoicesModule { }
