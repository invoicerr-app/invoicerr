import { Module } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../persistence/prisma-scheduled-job-store';
import { PrismaCallbackStore } from '../persistence/prisma-callback-store';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { ComplianceService } from '../operations/compliance-service';
import { ComplianceExecutor } from '../execution/executor';
import { FormatProviderRegistry } from '../providers/format/registry';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { defaultTransmissionRegistry } from '../providers/transmission/registry';
import { InvoiceRenderingModule } from '@/modules/invoice-rendering/invoice-rendering.module';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { InvoiceMailGateway } from '@/modules/invoice-rendering/invoice-mail.gateway';
import { ApplySignalService } from './apply-signal';
import { ComplianceCron } from './compliance.cron';
import { AuditExportController } from './audit-export.controller';
import { ComplianceController } from './compliance.controller';
import { RequiredFieldsController } from './required-fields.controller';

@Module({
  imports: [InvoiceRenderingModule],
  controllers: [ComplianceController, RequiredFieldsController, AuditExportController],
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
    // ApplySignalService (bridge) — owns its own transaction-scoped Prisma stores internally.
    {
      provide: ApplySignalService,
      useFactory: (prisma: PrismaService) => new ApplySignalService(prisma),
      inject: [PrismaService],
    },
    // Schedulers & Router
    {
      provide: PollScheduler,
      useFactory: (
        applySignal: ApplySignalService,
        pollStore: PrismaPollJobStore,
      ) => new PollScheduler({
        applySignal: (id, signal, log) => applySignal.apply(id, signal, log),
        store: pollStore,
        txRegistry: defaultTransmissionRegistry,
      }),
      inject: [ApplySignalService, PrismaPollJobStore],
    },
    {
      provide: TimerScheduler,
      useFactory: (
        applySignal: ApplySignalService,
        timerStore: PrismaTimerJobStore,
      ) => new TimerScheduler({
        applySignal: (id, signal, log) => applySignal.apply(id, signal, log),
        store: timerStore,
      }),
      inject: [ApplySignalService, PrismaTimerJobStore],
    },
    {
      provide: InboundRouter,
      useFactory: (
        applySignal: ApplySignalService,
        callbackStore: PrismaCallbackStore,
      ) => new InboundRouter({
        applySignal: (id, signal, log) => applySignal.apply(id, signal, log),
        store: callbackStore,
      }),
      inject: [ApplySignalService, PrismaCallbackStore],
    },
    // FormatProviderRegistry with real rendering port (InvoiceRenderingService)
    {
      provide: FormatProviderRegistry,
      useFactory: (rendering: InvoiceRenderingService) => new FormatProviderRegistry({ artifacts: rendering }),
      inject: [InvoiceRenderingService],
    },
    // TransmissionProviderRegistry with real mail port (InvoiceMailGateway)
    {
      provide: TransmissionProviderRegistry,
      useFactory: (mail: InvoiceMailGateway) => new TransmissionProviderRegistry({ mail }),
      inject: [InvoiceMailGateway],
    },
    // ComplianceExecutor with wired format + transmission registries
    {
      provide: ComplianceExecutor,
      useFactory: (formats: FormatProviderRegistry, transmission: TransmissionProviderRegistry) =>
        new ComplianceExecutor({ formats, transmission }),
      inject: [FormatProviderRegistry, TransmissionProviderRegistry],
    },
    // ComplianceService (facade) with Prisma store + wired executor
    {
      provide: ComplianceService,
      useFactory: (docStore: PrismaComplianceDocumentStore, executor: ComplianceExecutor) =>
        new ComplianceService({ store: docStore, executor }),
      inject: [PrismaComplianceDocumentStore, ComplianceExecutor],
    },
    // Cron
    ComplianceCron,
  ],
  exports: [ComplianceService],
})
export class ComplianceModule {}
