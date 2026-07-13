import { Module } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../persistence/prisma-scheduled-job-store';
import { PrismaCallbackStore } from '../persistence/prisma-callback-store';
import { PrismaReportingStore } from '../reporting/prisma-reporting-store';
import { ReportingRegistry } from '../reporting/registry';
import { NullIdentifierExistenceClient } from '../canonical/identifier-existence.port';
import { CachedExistenceClient } from '../canonical/cached-existence-client';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { ComplianceService } from '../operations/compliance-service';
import { ComplianceExecutor } from '../execution/executor';
import { FormatProviderRegistry } from '../providers/format/registry';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { SigningProviderRegistry } from '../providers/signing/registry';
import { InvoiceRenderingModule } from '@/modules/invoice-rendering/invoice-rendering.module';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { InvoiceMailGateway } from '@/modules/invoice-rendering/invoice-mail.gateway';
import { ChannelCredentialsModule } from '@/modules/channel-credentials/channel-credentials.module';
import { ChannelCredentialsService } from '@/modules/channel-credentials/channel-credentials.service';
import { SigningCertificatesModule } from '@/modules/signing-certificates/signing-certificates.module';
import { SigningCertificatesService } from '@/modules/signing-certificates/signing-certificates.service';
import { ApplySignalService } from './apply-signal';
import { ComplianceQueueDispatcher } from './queue/compliance-queue.dispatcher';
import { QueueModule } from './queue/queue.module';

/**
 * QUEUE_IMPL_PLAN.md §4.8/§5.3 — providers-only compliance module, no controllers.
 *
 * Split out of `ComplianceModule` in Phase 2 so `ComplianceWorkerModule` (the dedicated worker
 * process AND the WORKER_INLINE in-process consumer) can reuse the exact same DI-wired,
 * CREDENTIALED instances (TransmissionProviderRegistry, ApplySignalService, the Prisma stores,
 * ComplianceExecutor, ComplianceService) WITHOUT also pulling in:
 *   - the HTTP controllers (ComplianceController, CompliancePipelineController, …), and
 *   - `ComplianceCron` (`@Interval`/`@Cron` — would otherwise start ticking a SECOND time inside
 *     the worker process, duplicating the API process's cron, and requires `ScheduleModule` which
 *     the worker never imports).
 *
 * `ComplianceModule` imports this module and re-exports it (a whole-module re-export — Nest does
 * not allow cherry-picking an individual token that is only provided by an *imported* module,
 * only tokens declared in the importing module's own `providers`, or the whole imported module) so
 * that any other module importing `ComplianceModule` (e.g. `InvoicesModule`, to enqueue transmits
 * based on the channel's feedback model) can inject any of Core's tokens too.
 */
@Module({
  imports: [
    PrismaModule,
    QueueModule,
    InvoiceRenderingModule,
    ChannelCredentialsModule,
    SigningCertificatesModule,
  ],
  providers: [
    // Stores
    {
      provide: PrismaComplianceDocumentStore,
      useFactory: (prisma: PrismaService) => new PrismaComplianceDocumentStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: PrismaPollJobStore,
      useFactory: (prisma: PrismaService) => new PrismaPollJobStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: PrismaTimerJobStore,
      useFactory: (prisma: PrismaService) => new PrismaTimerJobStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: PrismaCallbackStore,
      useFactory: (prisma: PrismaService) => new PrismaCallbackStore(prisma),
      inject: [PrismaService],
    },
    // TransmissionProviderRegistry with real mail port + credentials port (F-3: THE credentialed
    // registry — every consumer below must receive THIS instance, never defaultTransmissionRegistry).
    {
      provide: TransmissionProviderRegistry,
      useFactory: (mail: InvoiceMailGateway, credentials: ChannelCredentialsService) =>
        new TransmissionProviderRegistry({ mail, credentials }),
      inject: [InvoiceMailGateway, ChannelCredentialsService],
    },
    // ApplySignalService (bridge) — F-3/F-2 (Phase 2 slice): credentialed registry + queue dispatcher
    // so SCHEDULE_POLL effects are both persisted (ScheduledJob) AND projected to compliance-poll.
    {
      provide: ApplySignalService,
      useFactory: (
        prisma: PrismaService,
        txRegistry: TransmissionProviderRegistry,
        dispatcher: ComplianceQueueDispatcher,
      ) => new ApplySignalService(prisma, txRegistry, dispatcher),
      inject: [PrismaService, TransmissionProviderRegistry, ComplianceQueueDispatcher],
    },
    // Schedulers & Router — PollScheduler/TimerScheduler back the legacy cron reconcile() (kept
    // through Phase 2; retired in Phase 3). F-3: PollScheduler now also gets the credentialed registry.
    {
      provide: PollScheduler,
      useFactory: (
        applySignal: ApplySignalService,
        pollStore: PrismaPollJobStore,
        txRegistry: TransmissionProviderRegistry,
      ) =>
        new PollScheduler({
          applySignal: (id, signal, log) => applySignal.apply(id, signal, log),
          store: pollStore,
          txRegistry,
        }),
      inject: [ApplySignalService, PrismaPollJobStore, TransmissionProviderRegistry],
    },
    {
      provide: TimerScheduler,
      useFactory: (applySignal: ApplySignalService, timerStore: PrismaTimerJobStore) =>
        new TimerScheduler({
          applySignal: (id, signal, log) => applySignal.apply(id, signal, log),
          store: timerStore,
        }),
      inject: [ApplySignalService, PrismaTimerJobStore],
    },
    {
      provide: InboundRouter,
      useFactory: (applySignal: ApplySignalService, callbackStore: PrismaCallbackStore) =>
        new InboundRouter({
          applySignal: (id, signal, log) => applySignal.apply(id, signal, log),
          store: callbackStore,
        }),
      inject: [ApplySignalService, PrismaCallbackStore],
    },
    // FormatProviderRegistry with real rendering port (InvoiceRenderingService)
    {
      provide: FormatProviderRegistry,
      useFactory: (rendering: InvoiceRenderingService) =>
        new FormatProviderRegistry({ artifacts: rendering }),
      inject: [InvoiceRenderingService],
    },
    // SigningProviderRegistry wired with the real per-company cert store
    {
      provide: SigningProviderRegistry,
      useFactory: (signingCerts: SigningCertificatesService) =>
        new SigningProviderRegistry(undefined, signingCerts),
      inject: [SigningCertificatesService],
    },
    // PrismaReportingStore — idempotence + proof-of-filing persistence
    {
      provide: PrismaReportingStore,
      useFactory: (prisma: PrismaService) => new PrismaReportingStore(prisma),
      inject: [PrismaService],
    },
    // ReportingRegistry wired with the persistent store
    {
      provide: ReportingRegistry,
      useFactory: (store: PrismaReportingStore) => new ReportingRegistry(undefined, store),
      inject: [PrismaReportingStore],
    },
    // ComplianceExecutor with wired format + signing + transmission + reporting registries + existence client
    {
      provide: ComplianceExecutor,
      useFactory: (
        formats: FormatProviderRegistry,
        signing: SigningProviderRegistry,
        transmission: TransmissionProviderRegistry,
        reporting: ReportingRegistry,
        existence: CachedExistenceClient,
      ) => new ComplianceExecutor({ formats, signing, transmission, reporting, existence }),
      inject: [
        FormatProviderRegistry,
        SigningProviderRegistry,
        TransmissionProviderRegistry,
        ReportingRegistry,
        'IDENTIFIER_EXISTENCE_CLIENT',
      ],
    },
    // ComplianceService (facade) with Prisma store + wired executor — also the home of
    // `computeSendOutcome()` (QUEUE_IMPL_PLAN.md §5.1), shared by ComplianceService.send() (direct/test
    // callers) AND TransmitProcessor (the real event-sourced queue path).
    {
      provide: ComplianceService,
      useFactory: (docStore: PrismaComplianceDocumentStore, executor: ComplianceExecutor) =>
        new ComplianceService({ store: docStore, executor }),
      inject: [PrismaComplianceDocumentStore, ComplianceExecutor],
    },
    // IdentifierExistencePort — offline-safe default (NullIdentifierExistenceClient wrapped in cache) (§7)
    // To enable live checks: replace NullIdentifierExistenceClient with ViesExistenceClient /
    // SireneExistenceClient and set EXISTENCE_CHECK_ENABLED=true in the environment.
    {
      provide: 'IDENTIFIER_EXISTENCE_CLIENT',
      useFactory: () => new CachedExistenceClient(new NullIdentifierExistenceClient()),
    },
  ],
  exports: [
    PrismaComplianceDocumentStore,
    PrismaPollJobStore,
    PrismaTimerJobStore,
    PrismaCallbackStore,
    ApplySignalService,
    PollScheduler,
    TimerScheduler,
    InboundRouter,
    FormatProviderRegistry,
    TransmissionProviderRegistry,
    SigningProviderRegistry,
    PrismaReportingStore,
    ReportingRegistry,
    ComplianceExecutor,
    ComplianceService,
  ],
})
export class ComplianceCoreModule {}
