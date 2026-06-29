import { Module } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../persistence/prisma-scheduled-job-store';
import { PrismaCallbackStore } from '../persistence/prisma-callback-store';
import { PrismaReportingStore } from '../reporting/prisma-reporting-store';
import { ReportingRegistry } from '../reporting/registry';
import { NullIdentifierExistenceClient } from '../canonical/identifier-existence.port';
import { CachedExistenceClient } from '../canonical/cached-existence-client';
import { CronLockService } from './cron-lock.service';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { ComplianceService } from '../operations/compliance-service';
import { ComplianceExecutor } from '../execution/executor';
import { FormatProviderRegistry } from '../providers/format/registry';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { defaultTransmissionRegistry } from '../providers/transmission/registry';
import { SigningProviderRegistry } from '../providers/signing/registry';
import { InvoiceRenderingModule } from '@/modules/invoice-rendering/invoice-rendering.module';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { InvoiceMailGateway } from '@/modules/invoice-rendering/invoice-mail.gateway';
import { ChannelCredentialsModule } from '@/modules/channel-credentials/channel-credentials.module';
import { ChannelCredentialsService } from '@/modules/channel-credentials/channel-credentials.service';
import { SigningCertificatesModule } from '@/modules/signing-certificates/signing-certificates.module';
import { SigningCertificatesService } from '@/modules/signing-certificates/signing-certificates.service';
import { ChannelCredentialsController } from './channel-credentials.controller';
import { SigningCertificatesController } from './signing-certificates.controller';
import { ChannelSettingsService } from './channel-settings.service';
import { ApplySignalService } from './apply-signal';
import { ComplianceCron } from './compliance.cron';
import { AuditExportController } from './audit-export.controller';
import { ComplianceController } from './compliance.controller';
import { RequiredFieldsController } from './required-fields.controller';
import { InboundInvoiceController } from './inbound-invoice.controller';
import { InboundInvoiceService } from '../reception/inbound-invoice.service';
import { InboxPoller } from '../lifecycle/drivers/inbox-poller';
import { NullInboxPort } from '../lifecycle/drivers/inbox-port';

@Module({
  imports: [InvoiceRenderingModule, ChannelCredentialsModule, SigningCertificatesModule],
  controllers: [ComplianceController, RequiredFieldsController, AuditExportController, ChannelCredentialsController, SigningCertificatesController, InboundInvoiceController],
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
    // TransmissionProviderRegistry with real mail port + credentials port
    {
      provide: TransmissionProviderRegistry,
      useFactory: (mail: InvoiceMailGateway, credentials: ChannelCredentialsService) =>
        new TransmissionProviderRegistry({ mail, credentials }),
      inject: [InvoiceMailGateway, ChannelCredentialsService],
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
      inject: [FormatProviderRegistry, SigningProviderRegistry, TransmissionProviderRegistry, ReportingRegistry, 'IDENTIFIER_EXISTENCE_CLIENT'],
    },
    // ComplianceService (facade) with Prisma store + wired executor
    {
      provide: ComplianceService,
      useFactory: (docStore: PrismaComplianceDocumentStore, executor: ComplianceExecutor) =>
        new ComplianceService({ store: docStore, executor }),
      inject: [PrismaComplianceDocumentStore, ComplianceExecutor],
    },
    // Channel settings (backs ChannelCredentialsController: company config CRUD + required channels)
    ChannelSettingsService,
    // CronLockService — distributed lease lock for multi-instance deployments (§13)
    {
      provide: CronLockService,
      useFactory: (prisma: PrismaService) => new CronLockService(prisma),
      inject: [PrismaService],
    },
    // IdentifierExistencePort — offline-safe default (NullIdentifierExistenceClient wrapped in cache) (§7)
    // To enable live checks: replace NullIdentifierExistenceClient with ViesExistenceClient /
    // SireneExistenceClient and set EXISTENCE_CHECK_ENABLED=true in the environment.
    {
      provide: 'IDENTIFIER_EXISTENCE_CLIENT',
      useFactory: () => new CachedExistenceClient(new NullIdentifierExistenceClient()),
    },
    // Cron — injects PollScheduler, TimerScheduler, InboundRouter, InboxPoller, ReportingStore, CronLockService
    {
      provide: ComplianceCron,
      useFactory: (
        pollScheduler: PollScheduler,
        timerScheduler: TimerScheduler,
        inboundRouter: InboundRouter,
        inboxPoller: InboxPoller,
        reportingStore: PrismaReportingStore,
        cronLock: CronLockService,
      ) => new ComplianceCron(pollScheduler, timerScheduler, inboundRouter, inboxPoller, reportingStore, cronLock),
      inject: [PollScheduler, TimerScheduler, InboundRouter, InboxPoller, PrismaReportingStore, CronLockService],
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
  exports: [ComplianceService],
})
export class ComplianceModule {}
