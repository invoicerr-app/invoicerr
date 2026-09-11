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
import { CountryReadinessModule } from './modules/country-readiness/country-readiness.module';
import { ConfigModule } from '@nestjs/config';
import { AccountingExportModule } from './modules/documents/accounting-export/accounting-export.module';
import { DangerModule } from './modules/danger/danger.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PublicDocumentsModule } from './modules/documents/public/public-documents.module';
import { SdiNotificheModule } from './modules/documents/transports/sdi/sdi-notifiche.module';
import { DocumentsQueueWorkerModule } from './modules/documents/queue/document-queue-worker.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MailService } from './mail/mail.service';
import { McpModule } from './modules/mcp/mcp.module';
import { Module } from '@nestjs/common';
import { PluginsModule } from './modules/plugins/plugins.module';
import { ReceivedInvoicesModule } from './modules/documents/received-invoices/received-invoices.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SireneModule } from './modules/sirene/sirene.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { LoggerModule } from './modules/logger/logger.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
    // Root TODO item 13 REDONE — the mandant-flagged NEW dependency: defense in depth on top of the
    // real, mathematical bound `documents/signatures/otp.ts#MAX_FAILED_ATTEMPTS` already gives the
    // signature OTP flow (see that constant's own header). This is a GLOBAL default (every route gets
    // it, `ThrottlerGuard` below is a global `APP_GUARD`); `PublicSignaturesController`'s own two
    // anonymous routes narrow it further with their own `@Throttle()` overrides. `ttl` is
    // MILLISECONDS in this major version (v5+), never seconds — 60_000 = one minute.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
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
    CountryReadinessModule,
    ClientsModule,
    SireneModule,
    CompanyLookupModule,
    DangerModule,
    DocumentsModule,
    // TODO_FEATURES.md rank 4 — the generic accounting CSV export's own controller, deliberately its
    // own module (see accounting-export.module.ts's own header for why it never joins DocumentsModule).
    AccountingExportModule,
    PublicDocumentsModule,
    // Root TODO item 10, SdI wave — the ONE `@Public()` route for the six `TrasmissioneFatture`
    // notifiche SdI pushes at us (see `sdi-notifiche.module.ts`'s own header on why its own module,
    // not folded into `PublicDocumentsModule`).
    SdiNotificheModule,
    ReceivedInvoicesModule,
    ...(workerInline ? [DocumentsQueueWorkerModule] : []),
    McpModule,
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
    // Root TODO item 13 REDONE — global rate limiting, see ThrottlerModule.forRoot's own comment
    // above. A THIRD global APP_GUARD: Nest runs every registered one, ANDing their results, so this
    // adds a check rather than replacing AuthGuard/RolesGuard's own.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
