import { Module } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaReportingStore } from '../reporting/prisma-reporting-store';
import { CronLockService } from './cron-lock.service';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { SigningCertificatesModule } from '@/modules/signing-certificates/signing-certificates.module';
import { ChannelCredentialsController } from './channel-credentials.controller';
import { SigningCertificatesController } from './signing-certificates.controller';
import { ChannelSettingsService } from './channel-settings.service';
import { ComplianceCoreModule } from './compliance-core.module';
import { QueueModule } from './queue/queue.module';
import { ComplianceCron } from './compliance.cron';
import { AuditExportController } from './audit-export.controller';
import { ComplianceController } from './compliance.controller';
import { CompliancePipelineController } from './compliance-pipeline.controller';
import { CompliancePipelineService } from './compliance-pipeline.service';
import { RequiredFieldsController } from './required-fields.controller';
import { InboundInvoiceController } from './inbound-invoice.controller';
import { InboundInvoiceService } from '../reception/inbound-invoice.service';
import { InboxPoller } from '../lifecycle/drivers/inbox-poller';
import { NullInboxPort } from '../lifecycle/drivers/inbox-port';

/**
 * QUEUE_IMPL_PLAN.md §5.3 — Phase 2 rewiring. The DI-heavy providers (stores, ApplySignalService,
 * the credentialed TransmissionProviderRegistry, ComplianceExecutor, ComplianceService, …) now live
 * in `ComplianceCoreModule` (no controllers — see its docstring for why) and are reused here via a
 * whole-module re-export. This module keeps: the HTTP controllers, the controller-only support
 * services (ChannelSettingsService, CompliancePipelineService, InboundInvoiceService, InboxPoller),
 * and — UNCHANGED for Phase 2 — `ComplianceCron` + `CronLockService` (Phase 3 removes these once
 * BullMQ repeatables/timer/sweep processors replace the tick-based scan; do NOT remove early).
 */
@Module({
  imports: [ComplianceCoreModule, SigningCertificatesModule, QueueModule],
  controllers: [
    ComplianceController,
    CompliancePipelineController,
    RequiredFieldsController,
    AuditExportController,
    ChannelCredentialsController,
    SigningCertificatesController,
    InboundInvoiceController,
  ],
  providers: [
    // Channel settings (backs ChannelCredentialsController: company config CRUD + required channels)
    ChannelSettingsService,
    // Pipeline summaries (backs CompliancePipelineController: documents + reports read models)
    CompliancePipelineService,
    // CronLockService — distributed lease lock for multi-instance deployments (§13)
    {
      provide: CronLockService,
      useFactory: (prisma: PrismaService) => new CronLockService(prisma),
      inject: [PrismaService],
    },
    // Cron — injects PollScheduler, TimerScheduler, InboundRouter, InboxPoller, ReportingStore, CronLockService
    // (the first four now come from ComplianceCoreModule — unchanged behavior, Phase 3 removes this class).
    {
      provide: ComplianceCron,
      useFactory: (
        pollScheduler: PollScheduler,
        timerScheduler: TimerScheduler,
        inboundRouter: InboundRouter,
        inboxPoller: InboxPoller,
        reportingStore: PrismaReportingStore,
        cronLock: CronLockService,
      ) =>
        new ComplianceCron(
          pollScheduler,
          timerScheduler,
          inboundRouter,
          inboxPoller,
          reportingStore,
          cronLock,
        ),
      inject: [
        PollScheduler,
        TimerScheduler,
        InboundRouter,
        InboxPoller,
        PrismaReportingStore,
        CronLockService,
      ],
    },
    // InboundInvoiceService — parse + store received supplier invoices
    {
      provide: InboundInvoiceService,
      useFactory: (prisma: PrismaService) => new InboundInvoiceService(prisma),
      inject: [PrismaService],
    },
    // InboxPoller — §4 inbox polling driver (SFTP/IMAP).
    // Default: NullInboxPort (offline-safe, no polling without config).
    // Replace 'INBOX_PORTS' with real port instances when credentials are available.
    {
      provide: 'INBOX_PORTS',
      useFactory: () => [new NullInboxPort()],
    },
    {
      provide: InboxPoller,
      useFactory: (router: InboundRouter, ports: InstanceType<typeof NullInboxPort>[]) =>
        new InboxPoller({ router, ports }),
      inject: [InboundRouter, 'INBOX_PORTS'],
    },
  ],
  // Whole-module re-export (Nest cannot re-export an individual token that is only provided by an
  // imported module — see ComplianceCoreModule's docstring): this makes every Core token
  // (ComplianceService, the credentialed TransmissionProviderRegistry, ApplySignalService, the
  // Prisma stores, ComplianceExecutor…) injectable by any module that imports ComplianceModule
  // (e.g. InvoicesModule — QUEUE_IMPL_PLAN.md §5.6, branching EMAIL sync vs ASYNC enqueueTransmit).
  exports: [ComplianceCoreModule],
})
export class ComplianceModule {}
