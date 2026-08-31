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
import { DocumentsQueueWorkerModule } from './modules/documents/queue/document-queue-worker.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MailService } from './mail/mail.service';
import { Module } from '@nestjs/common';
import { PluginsModule } from './modules/plugins/plugins.module';
import { ReceivedInvoicesModule } from './modules/documents/received-invoices/received-invoices.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SireneModule } from './modules/sirene/sirene.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { LoggerModule } from './modules/logger/logger.module';
import { auth } from './lib/auth';

/**
 * `DocumentsModule` (via `DocumentsCoreModule`) always imports the document-action queue's
 * enqueue-capable half (`DocumentQueueModule`, `@Global()`) — the API process can always ENQUEUE a
 * job, and Redis being required to boot at all (see `DocumentQueueRedisRequiredGuard`) applies
 * regardless of this flag. What THIS flag gates is only whether the API process ALSO CONSUMES —
 * imports `DocumentsQueueWorkerModule`, the processors themselves (TODO.md item 22, on the exact
 * model the pre-refonte compliance engine used for its own `WORKER_INLINE`, git tag
 * `avant-refonte-documents`).
 *
 * Default `true` (inline/mono): a single-container deployment (docker-compose.yml) needs no separate
 * worker process for a document's "send" to actually leave the queue. Set `WORKER_INLINE=false` in a
 * scaled ("giga") deployment (docker-compose.scale.yml) so the API only enqueues and dedicated
 * `ROLE=worker` container(s) (worker.ts) are the only ones consuming — avoiding double-processing.
 */
const workerInline = process.env.WORKER_INLINE !== 'false';

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
    ReceivedInvoicesModule,
    ...(workerInline ? [DocumentsQueueWorkerModule] : []),
    PluginsModule,
    WebhooksModule,
    InvitationsModule,
    HealthModule,
    PrismaModule,
    LoggerModule,
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
