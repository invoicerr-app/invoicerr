import { Module } from '@nestjs/common';
import { SigningCertificatesModule } from '@/modules/signing-certificates/signing-certificates.module';
import { ChannelCredentialsController } from './channel-credentials.controller';
import { SigningCertificatesController } from './signing-certificates.controller';
import { ChannelSettingsService } from './channel-settings.service';
import { ComplianceCoreModule } from './compliance-core.module';
import { QueueModule } from './queue/queue.module';
import { AuditExportController } from './audit-export.controller';
import { ComplianceController } from './compliance.controller';
import { CompliancePipelineController } from './compliance-pipeline.controller';
import { CompliancePipelineService } from './compliance-pipeline.service';
import { RequiredFieldsController } from './required-fields.controller';
import { InboundInvoiceController } from './inbound-invoice.controller';

/**
 * QUEUE_IMPL_PLAN.md §5.3 — Phase 2 rewiring, Phase 3 cron/lock removal (§5.8). The DI-heavy
 * providers (stores, ApplySignalService, the credentialed TransmissionProviderRegistry,
 * ComplianceExecutor, ComplianceService, InboxPoller, …) live in `ComplianceCoreModule` (no
 * controllers — see its docstring for why) and are reused here via a whole-module re-export. This
 * module keeps only the HTTP controllers and the controller-only support services
 * (ChannelSettingsService, CompliancePipelineService).
 *
 * `ComplianceCron` + `CronLockService` are GONE (Phase 3): the tick-based scan (poll/timer/inbox
 * ticks, the 12h reconcile, the daily reporting-close) is replaced by BullMQ processors
 * (`timer.processor.ts`/`report.processor.ts`/`sweep.processor.ts`, wired in
 * `ComplianceWorkerModule`) + repeatable jobs (`ComplianceQueueDispatcher.registerRepeatables()`).
 * No distributed lock is needed any more: BullMQ dedups repeatables by their repeat key, and
 * poll/timer jobs dedup by their deterministic `jobId` — a single consumer per job, natively.
 *
 * `InboundInvoiceService` (parse + store received supplier invoices) now lives in
 * `ComplianceCoreModule` — `InboxPoller`'s `documentSink` (KSeF purchase-invoice reception,
 * M-6/F-15) needs it too, and Core is reachable from both the worker and this module, so it's
 * reused via the whole-module re-export below rather than provided twice.
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
  ],
  // Whole-module re-export (Nest cannot re-export an individual token that is only provided by an
  // imported module — see ComplianceCoreModule's docstring): this makes every Core token
  // (ComplianceService, the credentialed TransmissionProviderRegistry, ApplySignalService, the
  // Prisma stores, ComplianceExecutor, InboxPoller…) injectable by any module that imports
  // ComplianceModule (e.g. InvoicesModule — QUEUE_IMPL_PLAN.md §5.6, branching EMAIL sync vs ASYNC
  // enqueueTransmit).
  exports: [ComplianceCoreModule],
})
export class ComplianceModule {}
