import { randomUUID } from 'crypto';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ChannelType } from '../types';
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import { assembleLifecycle, phaseContextFromPlan } from '../lifecycle/assembler';
import { ComplianceDocumentRecord } from '../operations/types';
import { Effect, LifecycleRuntime, LifecycleSignal } from '../lifecycle/runtime';
import { createPollJob } from '../lifecycle/drivers/poll-job';
import { createTimerJob } from '../lifecycle/drivers/timer-job';
import { createRegistration } from '../lifecycle/drivers/inbound-job';
import { defaultTransmissionRegistry, TransmissionProviderRegistry } from '../providers/transmission/registry';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { PrismaPollJobStore, PrismaTimerJobStore } from '../persistence/prisma-scheduled-job-store';
import { PrismaCallbackStore } from '../persistence/prisma-callback-store';

let seq = 0;
function genId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/**
 * The real `applySignal` bridge: loads a document's runtime, dispatches the signal, and persists the
 * result. Every write for one signal — the status/event update, cancelling the drivers that guarded
 * the OLD state, and arming the drivers for the NEW state — happens inside a single Prisma
 * transaction, so a partial failure never leaves the document and its scheduled jobs inconsistent.
 *
 * A signal that resolves to a NOOP (stale/duplicate/inapplicable) writes nothing and never opens a
 * transaction — the runtime-level safety (no matching transition ⇒ NOOP) is enough; we don't also need
 * to touch the database for it.
 */
export class ApplySignalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txRegistry: TransmissionProviderRegistry = defaultTransmissionRegistry,
    private readonly log: ComplianceLogger = defaultLogger,
  ) {}

  async apply(documentId: string, signal: LifecycleSignal, log?: ComplianceLogger): Promise<void> {
    const l = log ?? this.log;
    const docStore = new PrismaComplianceDocumentStore(this.prisma);
    const rec = await docStore.get(documentId);
    if (!rec) {
      l.warn('nest/apply-signal', `document ${documentId} not found`);
      return;
    }

    const runtime = await this.buildRuntime(rec);
    const effects = runtime.dispatch(signal);
    if (effects.length === 1 && effects[0].kind === 'NOOP') return;

    const now = new Date().toISOString();
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const txDocStore = new PrismaComplianceDocumentStore(tx as unknown as PrismaService);
      const txPollStore = new PrismaPollJobStore(tx as unknown as PrismaService);
      const txTimerStore = new PrismaTimerJobStore(tx as unknown as PrismaService);
      const txCallbackStore = new PrismaCallbackStore(tx as unknown as PrismaService);

      const applied = effects.find((e): e is Extract<Effect, { kind: 'APPLIED' }> => e.kind === 'APPLIED');
      if (applied) {
        // The document just left `rec.status` for `applied.to` — any driver still guarding the OLD
        // state is now obsolete. (A stale fire is already a safe runtime no-op; this keeps the
        // scheduled-job/callback tables from accumulating dead rows that poll a resolved document for
        // up to their full timeout — e.g. a leaked MX PAC poll every 30s for 24h.)
        await Promise.all([
          txPollStore.cancelForDocument(documentId),
          txTimerStore.cancelForDocument(documentId),
          txCallbackStore.cancelForDocument(documentId),
        ]);
        await txDocStore.update(documentId, {
          status: applied.to,
          events: [...rec.events, { id: randomUUID(), type: applied.event, at: now, actor: 'system' }],
          updatedAt: now,
        });
      }

      for (const effect of effects) {
        if (effect.kind === 'SCHEDULE_POLL') {
          const provider = effect.channelProviderId ? this.txRegistry.getById(effect.channelProviderId) : null;
          const job = createPollJob(
            {
              id: genId('poll'),
              documentId,
              providerId: effect.channelProviderId ?? '(unknown)',
              channel: provider?.channel ?? 'GOV_PORTAL_API',
              awaiting: effect.awaiting,
              policy: effect.poll,
            },
            new Date(),
          );
          await txPollStore.enqueue(job);
        } else if (effect.kind === 'ARM_TIMER') {
          if (effect.deadlineHours == null) continue; // open-ended response window: no silence timer
          const job = createTimerJob(
            { id: genId('timer'), documentId, awaiting: effect.awaiting, onElapse: effect.onElapse, deadlineHours: effect.deadlineHours },
            new Date(),
          );
          await txTimerStore.arm(job);
        } else if (effect.kind === 'AWAIT_CALLBACK') {
          const channel = this.resolveChannel(rec);
          if (!channel) continue;
          const reg = createRegistration(
            { id: genId('cb'), documentId, channel, correlationKey: effect.correlationKey ?? documentId, awaiting: effect.awaiting },
            new Date(),
          );
          await txCallbackStore.register(reg);
        }
      }
    });
  }

  private async buildRuntime(rec: ComplianceDocumentRecord): Promise<LifecycleRuntime> {
    const plan = rec.plan;
    if (!plan) throw new Error(`Document ${rec.id} has no plan — cannot build lifecycle runtime`);
    const pctx = phaseContextFromPlan(plan, this.txRegistry);
    const graph = assembleLifecycle(plan, pctx);
    return new LifecycleRuntime(graph, rec.status, this.log);
  }

  private resolveChannel(rec: ComplianceDocumentRecord): ChannelType | null {
    const plan = rec.plan;
    if (!plan || !plan.channels.length) return null;
    return plan.channels[0].type as ChannelType;
  }
}
