import { ChannelType } from '../types';
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import { assembleLifecycle, phaseContextFromPlan } from '../lifecycle/assembler';
import { ComplianceDocumentStore } from '../operations/document-store';
import { ComplianceDocumentRecord } from '../operations/types';
import { LifecycleRuntime, LifecycleSignal } from '../lifecycle/runtime';
import { PollScheduler, SchedulePollEffect } from '../lifecycle/drivers/poll-scheduler';
import { TimerScheduler, ArmTimerEffect } from '../lifecycle/drivers/timer-scheduler';
import { InboundRouter, AwaitCallbackEffect } from '../lifecycle/drivers/inbound-router';

export class ApplySignalService {
  constructor(
    private readonly documentStore: ComplianceDocumentStore,
    private readonly pollScheduler: PollScheduler,
    private readonly timerScheduler: TimerScheduler,
    private readonly inboundRouter: InboundRouter,
    private readonly log: ComplianceLogger = defaultLogger,
  ) {}

  async apply(documentId: string, signal: LifecycleSignal, log?: ComplianceLogger): Promise<void> {
    const l = log ?? this.log;
    const rec = await this.documentStore.get(documentId);
    if (!rec) {
      l.warn('nest/apply-signal', `document ${documentId} not found`);
      return;
    }
    const runtime = await this.buildRuntime(rec);
    const effects = runtime.dispatch(signal);

    for (const effect of effects) {
      switch (effect.kind) {
        case 'APPLIED':
          await this.documentStore.update(documentId, {
            status: effect.to,
            events: [...rec.events, { type: effect.event, at: new Date().toISOString() }],
            updatedAt: new Date().toISOString(),
          });
          break;
        case 'SCHEDULE_POLL':
          await this.pollScheduler.schedule(documentId, effect as SchedulePollEffect);
          break;
        case 'ARM_TIMER':
          await this.timerScheduler.arm(documentId, effect as ArmTimerEffect);
          break;
        case 'AWAIT_CALLBACK': {
          const channel = await this.resolveChannel(rec);
          if (channel) {
            await this.inboundRouter.register(documentId, effect as AwaitCallbackEffect, {
              channel,
              correlationKey: effect.correlationKey ?? documentId,
            });
          }
          break;
        }
        case 'NOOP':
          break;
      }
    }
  }

  private async buildRuntime(rec: ComplianceDocumentRecord): Promise<LifecycleRuntime> {
    const plan = rec.plan;
    if (!plan) {
      throw new Error(`Document ${rec.id} has no plan — cannot build lifecycle runtime`);
    }
    const pctx = phaseContextFromPlan(plan);
    const graph = assembleLifecycle(plan, pctx);
    return new LifecycleRuntime(graph, rec.status, this.log);
  }

  private async resolveChannel(rec: ComplianceDocumentRecord): Promise<ChannelType | null> {
    const plan = rec.plan;
    if (!plan || !plan.channels.length) return null;
    return plan.channels[0].type as ChannelType;
  }
}
