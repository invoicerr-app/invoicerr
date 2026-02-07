import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MailModule } from "@/mail/mail.module";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { RecurringInvoicesCronService } from "@/modules/recurring-invoices/cron.service";
import { RecurringInvoicesController } from "@/modules/recurring-invoices/recurring-invoices.controller";
import { RecurringInvoicesService } from "@/modules/recurring-invoices/recurring-invoices.service";
import { WebhooksModule } from "../webhooks/webhooks.module";

@Module({
	imports: [WebhooksModule, MailModule],
	controllers: [RecurringInvoicesController],
	providers: [
		RecurringInvoicesService,
		RecurringInvoicesCronService,
		InvoicesService,
		JwtService,
	],
	exports: [RecurringInvoicesService, RecurringInvoicesCronService],
})
export class RecurringInvoicesModule {}
