import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { AuthGuard } from "@/guards/auth.guard";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { auth } from "./lib/auth";
import { MailModule } from "./mail/mail.module";
import { AuthExtendedModule } from "./modules/auth-extended/auth-extended.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { CompanyModule } from "./modules/company/company.module";
import { DangerModule } from "./modules/danger/danger.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DirectoryModule } from "./modules/directory/directory.module";
import { InvitationsModule } from "./modules/invitations/invitations.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { LoggerModule } from "./modules/logger/logger.module";
import { PaymentMethodsModule } from "./modules/payment-methods/payment-methods.module";
import { PluginsModule } from "./modules/plugins/plugins.module";
import { QuotesModule } from "./modules/quotes/quotes.module";
import { ReceiptsModule } from "./modules/receipts/receipts.module";
import { RecurringInvoicesModule } from "./modules/recurring-invoices/recurring-invoices.module";
import { SignaturesModule } from "./modules/signatures/signatures.module";
import { StatsModule } from "./modules/stats/stats.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		ScheduleModule.forRoot(),
		MailModule,
		AuthModule.forRoot({
			auth,
		}),
		AuthExtendedModule,
		CompanyModule,
		ClientsModule,
		QuotesModule,
		InvoicesModule,
		ReceiptsModule,
		DashboardModule,
		SignaturesModule,
		DangerModule,
		DirectoryModule,
		PluginsModule,
		RecurringInvoicesModule,
		PaymentMethodsModule,
		StatsModule,
		WebhooksModule,
		InvitationsModule,
		PrismaModule,
		LoggerModule,
	],
	controllers: [AppController],
	providers: [
		AppService,
		{
			provide: APP_GUARD,
			useClass: AuthGuard,
		},
	],
})
export class AppModule {}
