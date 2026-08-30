import { APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { AuthExtendedModule } from './modules/auth-extended/auth-extended.module';
import { AuthGuard } from '@/guards/auth.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { ClientsModule } from './modules/clients/clients.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { CompanyLookupModule } from './modules/company-lookup/company-lookup.module';
import { CompanyModule } from './modules/company/company.module';
import { ConfigModule } from '@nestjs/config';
import { DangerModule } from './modules/danger/danger.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MailService } from './mail/mail.service';
import { Module } from '@nestjs/common';
import { PluginsModule } from './modules/plugins/plugins.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SireneModule } from './modules/sirene/sirene.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { LoggerModule } from './modules/logger/logger.module';
import { auth } from './lib/auth';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    AuthModule.forRoot({
      auth,
      // We register our own global AuthGuard (src/guards/auth.guard.ts) which already replicates
      // this library's session check (and the @Public() bypass) plus an API key fallback. Without
      // this flag, the library's own guard runs in parallel and rejects API-key requests since it
      // has no knowledge of API keys.
      disableGlobalAuthGuard: true,
    }),
    AuthExtendedModule,
    ApiKeysModule,
    ArticlesModule,
    CompaniesModule,
    CompanyModule,
    ClientsModule,
    SireneModule,
    CompanyLookupModule,
    DangerModule,
    DocumentsModule,
    PluginsModule,
    WebhooksModule,
    InvitationsModule,
    HealthModule,
    PrismaModule,
    LoggerModule,
    // QueueModule is always imported so the API can *enqueue* (via ComplianceQueueDispatcher)
    // imported when WORKER_INLINE !== 'false' (default: inline/mono) — NestJS only instantiates
    // `@Processor()` classes reachable from an imported module, so gating this import gates
    // consumption. In a scaled ("giga") deployment the API sets WORKER_INLINE=false and only the
    // avoiding double-consumption. See QUEUE_IMPL_PLAN.md §5.5 / Décision 4.
  ],
  controllers: [],
  providers: [
    MailService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
