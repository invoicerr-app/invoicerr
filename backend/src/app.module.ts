import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CompanyContextInterceptor } from '@/interceptors/company-context.interceptor';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { AuthExtendedModule } from './modules/auth-extended/auth-extended.module';
import { BackupModule } from './modules/backup/backup.module';
import { BackupQueueWorkerModule } from './modules/backup/backup-queue-worker.module';
import { isBackupEnabled } from './modules/backup/backup.constants';
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
import { InstanceModule } from './modules/instance/instance.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { LegalModule } from './legal/legal.module';
import { MailService } from './mail/mail.service';
import { McpModule } from './modules/mcp/mcp.module';
import { TransferModule } from './modules/company/transfer/transfer.module';
import { TransferQueueWorkerModule } from './modules/company/transfer/transfer-queue-worker.module';
import { Module } from '@nestjs/common';
import { OcrExtractorModule } from './plugins';
import { ReceivedInvoicesModule } from './modules/documents/received-invoices/received-invoices.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SireneModule } from './modules/sirene/sirene.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WebhooksQueueWorkerModule } from './modules/webhooks/queue/webhooks-queue-worker.module';
import { LoggerModule } from './modules/logger/logger.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { createLibRedisClient } from './lib/redis-connection';
import { auth } from './lib/auth';
import { BillingModule } from './modules/billing/billing.module';
import { BillingQueueWorkerModule } from './modules/billing/billing-queue-worker.module';
import { CompanyWriteGuard } from './modules/billing/company-write.guard';
import { isBillingEnabled } from './modules/billing/billing-flag';
import { LegalAcceptanceGuard } from './legal/legal-acceptance.guard';

/**
 * Hosted billing (product decision 2026-09-15) — `BillingModule` is imported ONLY when
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` is set. With it unset (the self-hosted default), this
 * module simply never enters the graph: no `BillingController` (so `GET /api/billing/status` 404s,
 * Nest's own default for an unmatched route), no BullMQ queue/repeatable sweep job, nothing. See that
 * module's own header for the full "invisible and inert" guarantee this is the structural half of.
 */
const billingEnabled = isBillingEnabled();

/**
 * Instance file backup (`backend/src/modules/backup`) — a periodic sweep to a SECONDARY,
 * operator-owned S3 bucket, entirely separate from `documents/archive/storage.ts`'s own
 * `ARCHIVE_STORAGE=s3` (see `backup-runner.ts`'s own header for the "why two buckets" account).
 * `BackupModule` (the `GET /api/backup/status` route) is imported ONLY when this is true — the same
 * "invisible and inert without its flag" contract `billingEnabled` above already holds for hosted
 * billing: with no `BACKUP_S3_BUCKET` set, the module never enters the graph at all.
 */
const backupEnabled = isBackupEnabled();

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
    //
    // `storage`: a Redis-backed `ThrottlerStorage`, NEVER this package's own in-memory
    // default — three API replicas behind a load balancer would otherwise each keep their own
    // counter, so "120 requests/minute" silently becomes "120/minute PER REPLICA", and which replica
    // a request lands on decides whether it is throttled. `@nest-lab/throttler-storage-redis` is the
    // maintained companion package for exactly this (a single atomic Lua-scripted `INCR`+expiry+block
    // round trip against `ThrottlerStorage`'s own interface) — deliberately NOT a hand-rolled Lua
    // script here: this package already replicates `ThrottlerStorageService`'s own sliding
    // hit-decay/block semantics exactly, which a bespoke fixed-window counter (the shape
    // `lib/auth-rate-limit.ts`'s OWN, much simpler store uses) would not. `createLibRedisClient()`
    // opens its own dedicated connection — a plain, stateless `ioredis` instance, cheap to open a
    // second time — rather than sharing one with anything the documents module owns, keeping this
    // global, always-on module free of any dependency on `DocumentQueueModule` ever being imported.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      storage: new ThrottlerStorageRedisService(createLibRedisClient()),
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
    CountryReadinessModule,
    ClientsModule,
    SireneModule,
    CompanyLookupModule,
    DangerModule,
    // Instance-wide, cross-tenant actions (today: wiping the whole deployment) — always imported,
    // unlike BillingModule/BackupModule right below: the SaaS refusal AND the
    // INSTANCE_OPERATOR_EMAILS allowlist are both enforced dynamically, per request, by
    // InstanceOperatorGuard — see that guard's own header — so there is no build-time flag this
    // module itself needs gating on.
    InstanceModule,
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
    // The authenticated client portal — its own module, importing
    // `DocumentsCoreModule` directly, the same "never the HTTP `DocumentsModule`" reasoning
    // `PublicDocumentsModule`/`DocumentsQueueWorkerModule` already document. See
    // `client-portal.module.ts`'s own header for why this feature does not need a Core/HTTP split of
    // its own.
    ClientPortalModule,
    // Time tracking & project invoicing — self-contained, no
    // dependency on DocumentsCoreModule (see time-tracking.module.ts's own header).
    TimeTrackingModule,
    // Bank reconciliation via statement import — its own module,
    // importing DocumentsCoreModule directly so its one write path (reconciling a line) can call the
    // real "record-payment" action rather than a second one (see bank-reconciliation.module.ts's own
    // header).
    BankReconciliationModule,
    // Online payment — its own module, importing DocumentsCoreModule
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
    // Instance file backup — see this file's own `backupEnabled` comment above. `[]` with no
    // `BACKUP_S3_BUCKET` configured, the module's own default.
    ...(backupEnabled ? [BackupModule] : []),
    // ExpenseCategoriesModule is registered further up, BEFORE DocumentsModule — see that entry's own
    // comment for why (HTTP route-shadowing, not DI).
    ...(workerInline ? [DocumentsQueueWorkerModule] : []),
    // Same `workerInline` gate as `DocumentsQueueWorkerModule` right above, ANDed with `backupEnabled`:
    // a scaled deployment (`WORKER_INLINE=false`) wants only dedicated `ROLE=worker` processes
    // consuming the backup-sweep repeatable too, never the API — see `backup-queue-worker.module.ts`'s
    // own header.
    ...(backupEnabled && workerInline ? [BackupQueueWorkerModule] : []),
    // Same `workerInline` gate, ANDed with `billingEnabled`: BEFORE this split,
    // `BillingLifecycleProcessor`/its repeatable lived inside `BillingModule` itself with no
    // `workerInline` gate at all, so a scaled deployment (`WORKER_INLINE=false`, dedicated workers)
    // would never consume `Q_BILLING_LIFECYCLE` — see `billing-core.module.ts`'s own header.
    ...(billingEnabled && workerInline ? [BillingQueueWorkerModule] : []),
    McpModule,
    OcrExtractorModule,
    WebhooksModule,
    // Same `workerInline` gate as `DocumentsQueueWorkerModule`/`BillingQueueWorkerModule`/
    // `TransferQueueWorkerModule` above, never conditioned on a feature flag (webhooks work in
    // self-hosted mode too) — see `webhooks-core.module.ts`'s own header for the defect this closes:
    // outbound webhook delivery used to run inline wherever `dispatch()` was called, so a dedicated
    // worker process never touched it regardless of how many were running.
    ...(workerInline ? [WebhooksQueueWorkerModule] : []),
    InvitationsModule,
    // Company ownership transfer — always imported (self-hosted-friendly, same posture as
    // InvitationsModule/LegalModule right above), never conditioned on `billingEnabled` — see
    // `transfer.module.ts`'s own header.
    TransferModule,
    // Same `workerInline` gate as `DocumentsQueueWorkerModule`/`BillingQueueWorkerModule`
    // above, never conditioned on `billingEnabled` (transfer has no such flag) — see
    // `transfer-core.module.ts`'s own header for the defect this closes.
    ...(workerInline ? [TransferQueueWorkerModule] : []),
    // Terms of Service / Privacy Policy / DPA / Legal Notice / Cookies — always imported (see this
    // module's own header for why, unlike BillingModule right above, this one is never conditioned on
    // `billingEnabled`).
    LegalModule,
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
    // Request-scoped `companyId` for every `Log` write this request triggers — see
    // `@/interceptors/company-context.interceptor.ts`'s own header for why this has to be an
    // Interceptor (runs after every `APP_GUARD` above, `AuthGuard` included) rather than folded into
    // `AuthGuard` itself. Registered early in this list on purpose: Nest runs interceptors in
    // registration order, and nothing else here needs to run BEFORE the company context exists.
    {
      provide: APP_INTERCEPTOR,
      useClass: CompanyContextInterceptor,
    },
    // Hosted billing's read-only gate (product decision 2026-09-15) — refuses every WRITE from a
    // `blocked`/`zipped` company. Registered ONLY under the flag, like `BillingModule` right above:
    // with it unset, this guard doesn't merely no-op, it never enters the graph at all. See
    // `billing/write-gate.ts`'s own header for the full exemption list (GET/HEAD/OPTIONS, no active
    // company, `/api/auth/*` bypassing Nest routing entirely). `send-gate.ts#assertCanSend` (the
    // narrower, TRIAL-only gate on `send` specifically) stays a direct call from
    // `documents.service.ts#runAction` — unrelated, not duplicated here.
    ...(billingEnabled ? [{ provide: APP_GUARD, useClass: CompanyWriteGuard }] : []),
    // Refuses every write from a caller with a pending legal-document re-acceptance — named
    // `LEGAL_ACCEPTANCE_REQUIRED`. Registered ONLY under the same flag as `CompanyWriteGuard` right
    // above, for the identical reason: self-hosted has nothing to accept in the first place. See
    // `legal/legal-acceptance.guard.ts`'s own header for the full exemption list.
    ...(billingEnabled ? [{ provide: APP_GUARD, useClass: LegalAcceptanceGuard }] : []),
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
