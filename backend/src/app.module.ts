import { APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { AuthExtendedModule } from './modules/auth-extended/auth-extended.module';
import { AuthGuard } from '@/guards/auth.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { ClientPortalModule } from './modules/client-portal/client-portal.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { CompanyLookupModule } from './modules/company-lookup/company-lookup.module';
import { CompanyModule } from './modules/company/company.module';
import { CountryReadinessModule } from './modules/country-readiness/country-readiness.module';
import { ConfigModule } from '@nestjs/config';
import { AccountingExportModule } from './modules/documents/accounting-export/accounting-export.module';
import { BankReconciliationModule } from './modules/documents/bank-reconciliation/bank-reconciliation.module';
import { PaymentsModule } from './modules/documents/payments/payments.module';
import { PaymentMethodsModule } from './modules/documents/payment-methods/payment-methods.module';
import { CompanyCustomFieldsModule } from './modules/documents/company-custom-fields/company-custom-fields.module';
import { ExpenseCategoriesModule } from './modules/documents/expense-categories/expense-categories.module';
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
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { LoggerModule } from './modules/logger/logger.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { auth } from './lib/auth';
import { BillingModule } from './modules/billing/billing.module';
import { isBillingEnabled } from './modules/billing/billing-flag';

/**
 * Hosted billing (product decision 2026-09-15) — `BillingModule` is imported ONLY when
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` is set. With it unset (the self-hosted default), this
 * module simply never enters the graph: no `BillingController` (so `GET /api/billing/status` 404s,
 * Nest's own default for an unmatched route), no BullMQ queue/repeatable sweep job, nothing. See that
 * module's own header for the full "invisible and inert" guarantee this is the structural half of.
 */
const billingEnabled = isBillingEnabled();

/**
 * `DocumentsModule` (via `DocumentsCoreModule`) always imports the document-action queue's
 * enqueue-capable half (`DocumentQueueModule`, `@Global()`) — the API process can always ENQUEUE a
 * job, and Redis being required to boot at all (see `DocumentQueueRedisRequiredGuard`) applies
 * regardless of this flag. What THIS flag gates is only whether the API process ALSO CONSUMES —
 * imports `DocumentsQueueWorkerModule`, the processors themselves (on the exact
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
    // Defense in depth on top of the
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
    // Registered BEFORE `DocumentsModule` deliberately — NOT for DI (Nest resolves the module graph
    // regardless of array order; both this module and `DocumentsModule` import the shared
    // `DocumentsCoreModule` independently, instantiated once either way), but for HTTP ROUTE
    // registration order. `DocumentsController` (`@Controller('documents')`) declares a catch-all
    // `@Get(':id')` — Nest's default Express adapter tries routes in REGISTRATION order, so a bare
    // `GET /api/documents/expense-categories` (no further segment) would otherwise be swallowed by
    // that `:id` route (matching `id: "expense-categories"`) before Express ever reaches
    // `ExpenseCategoriesController`'s own identically-shaped `documents/expense-categories` path.
    // Proven live (not merely by a passing jest suite, which never boots a real HTTP server) on
    // 2026-09-15: moving this entry here is what makes `GET /api/documents/expense-categories`
    // actually reach `ExpenseCategoriesController` rather than `DocumentsController`'s 404 ("Document
    // \"expense-categories\" not found for type \"undefined\""). Every OTHER `documents/<feature>`
    // controller in this codebase (`received-invoices/`) avoids the same trap structurally instead —
    // by declaring no BARE, zero-extra-segment route at all (`documents/received-invoices/upload`,
    // `documents/received-invoices/:id/file`) — this module needed the reorder instead because its own
    // settings-screen `GET`/`POST` are deliberately the bare list/create routes the task asked for.
    ExpenseCategoriesModule,
    DocumentsModule,
    // The generic accounting CSV export's own controller, deliberately its
    // own module (see accounting-export.module.ts's own header for why it never joins DocumentsModule).
    AccountingExportModule,
    PublicDocumentsModule,
    // The ONE `@Public()` route for the six `TrasmissioneFatture`
    // notifiche SdI pushes at us (see `sdi-notifiche.module.ts`'s own header on why its own module,
    // not folded into `PublicDocumentsModule`).
    SdiNotificheModule,
    ReceivedInvoicesModule,
    // The authenticated client portal (TODO_FEATURES.md rank 3) — its own module, importing
    // `DocumentsCoreModule` directly, the same "never the HTTP `DocumentsModule`" reasoning
    // `PublicDocumentsModule`/`DocumentsQueueWorkerModule` already document. See
    // `client-portal.module.ts`'s own header for why this feature does not need a Core/HTTP split of
    // its own.
    ClientPortalModule,
    // TODO_FEATURES.md rank 11 ("suivi du temps & facturation de projets") — self-contained, no
    // dependency on DocumentsCoreModule (see time-tracking.module.ts's own header).
    TimeTrackingModule,
    // TODO_FEATURES.md rank 5 ("rapprochement bancaire par import de relevé") — its own module,
    // importing DocumentsCoreModule directly so its one write path (reconciling a line) can call the
    // real "record-payment" action rather than a second one (see bank-reconciliation.module.ts's own
    // header).
    BankReconciliationModule,
    // TODO_FEATURES.md rank 1 ("paiement en ligne") — its own module, importing DocumentsCoreModule
    // directly for the exact same reason BankReconciliationModule does just above (its webhook path
    // calls the real "record-payment" action, never a second write path — see
    // payment-sessions.service.ts's own header). Carries the ONE public route this feature adds
    // outside the client-portal boundary (the provider webhook itself, which is not a client — see
    // payments-webhook.controller.ts's own header on why its URL segment is a routing hint, not a
    // credential) plus the staff-facing session read; the client-facing "open a checkout session"
    // route lives inside ClientPortalModule instead (this feature's own brief: "sit inside that same
    // boundary, not beside it").
    PaymentsModule,
    // A company's own accepted payment methods (bank transfer, PayPal, cash, cheque, Stripe) — its
    // own top-level nav entity (next to Clients/Articles), never a settings-screen tab. Same
    // "type-adjacent, standalone module, importing DocumentsCoreModule directly" placement as
    // PaymentsModule right above — see payment-methods.module.ts's own header.
    PaymentMethodsModule,
    CompanyCustomFieldsModule,
    // Hosted billing (product decision 2026-09-15) — see this file's own `billingEnabled` comment
    // right above the class. `[]` for the self-hosted default.
    ...(billingEnabled ? [BillingModule] : []),
    // ExpenseCategoriesModule is registered further up, BEFORE DocumentsModule — see that entry's own
    // comment for why (HTTP route-shadowing, not DI).
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
    // Global rate limiting, see ThrottlerModule.forRoot's own comment
    // above. A THIRD global APP_GUARD: Nest runs every registered one, ANDing their results, so this
    // adds a check rather than replacing AuthGuard/RolesGuard's own.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
