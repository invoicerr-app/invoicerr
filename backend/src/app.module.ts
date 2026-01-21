import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthExtendedModule } from './modules/auth-extended/auth-extended.module';
import { AuthGuard } from '@/guards/auth.guard';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { ClientsModule } from './modules/clients/clients.module';
import { CompanyModule } from './modules/company/company.module';
import { ConfigModule } from '@nestjs/config';
import { DangerModule } from './modules/danger/danger.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { MailService } from './mail/mail.service';
import { Module } from '@nestjs/common';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { PluginsModule } from './modules/plugins/plugins.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { StatsModule } from './modules/stats/stats.module'
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { LoggerModule } from './modules/logger/logger.module';
import { auth } from "./lib/auth"

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    AuthModule.forRoot({
      auth
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
    MailService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule { }
