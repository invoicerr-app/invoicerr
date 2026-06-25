import { Module } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../persistence/prisma-scheduled-job-store';
import { PrismaCallbackStore } from '../persistence/prisma-callback-store';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { ComplianceService } from '../operations/compliance-service';
import { defaultTransmissionRegistry } from '../providers/transmission/registry';
import { ApplySignalService } from './apply-signal';
import { ComplianceCron } from './compliance.cron';
import { AuditExportController } from './audit-export.controller';
import { ComplianceController } from './compliance.controller';
import { RequiredFieldsController } from './required-fields.controller';

@Module({
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
    // ComplianceService (facade) with Prisma store
    {
      provide: ComplianceService,
      useFactory: (docStore: PrismaComplianceDocumentStore) => new ComplianceService({ store: docStore }),
      inject: [PrismaComplianceDocumentStore],
    },
    // Cron
    ComplianceCron,
  ],
  exports: [ComplianceService],
})
export class ComplianceModule {}
