import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MailModule } from "@/mail/mail.module";
import { InvoicesController } from "@/modules/invoices/invoices.controller";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { PluginsService } from "@/modules/plugins/plugins.service";
import { WebhooksModule } from "../webhooks/webhooks.module";

@Module({
	imports: [WebhooksModule, MailModule],
	controllers: [InvoicesController],
	providers: [InvoicesService, JwtService, PluginsService],
})
export class InvoicesModule {}
