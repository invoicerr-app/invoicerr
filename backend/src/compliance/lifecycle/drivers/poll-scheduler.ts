/**
 * Poll scheduler — the durable driver for POLL triggers (COMPLIANCE_LIFECYCLE.md §4). It turns a
 * runtime `SCHEDULE_POLL` effect into a persisted PollJob, and on each `tick()` polls every due job
 * via the channel provider's `poll()`, feeding the outcome back into the document's runtime as a
 * `POLL_RESULT` signal (which advances the lifecycle and may schedule the next driver).
 *
 * The decision/backoff logic is pure (poll-job.ts); this class is the I/O edge: store + provider
 * registry + clock + the callback that applies the signal. In production `tick()` is driven by a cron
 * / NestJS @Interval; `applySignal` loads the document's runtime (from persistence), dispatches, and
 * persists. Here both are injected so the whole thing is unit-testable.
 */
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import {
  defaultTransmissionRegistry,
  TransmissionProviderRegistry,
} from '../../providers/transmission/registry';
import { Effect, LifecycleSignal } from '../runtime';
import {
  createPollJob,
  decidePoll,
  InMemoryPollJobStore,
  outcomeFromTransmission,
  PollJob,
  PollJobStore,
} from './poll-job';

export type SchedulePollEffect = Extract<Effect, { kind: 'SCHEDULE_POLL' }>;

/** Feeds a signal back into the document's runtime (load → dispatch → persist → re-arm). */
export type ApplySignal = (documentId: string, signal: LifecycleSignal, log: ComplianceLogger) => void | Promise<void>;

export interface PollSchedulerDeps {
  applySignal: ApplySignal;
  store?: PollJobStore;
  txRegistry?: TransmissionProviderRegistry;
  now?: () => Date;
  idgen?: () => string;
  /** Called when a job times out without an answer (default: TODO → enter contingency / alert). */
  onExpire?: (job: PollJob, log: ComplianceLogger) => void;
  log?: ComplianceLogger;
}

export interface TickReport {
  due: number;
  polled: number;
  resolved: number;
  rescheduled: number;
  expired: number;
}

let seq = 0;

export class PollScheduler {
  private readonly store: PollJobStore;
  private readonly txRegistry: TransmissionProviderRegistry;
  private readonly now: () => Date;
  private readonly idgen: () => string;
  private readonly applySignal: ApplySignal;
  private readonly onExpire: (job: PollJob, log: ComplianceLogger) => void;
  private readonly log: ComplianceLogger;

  constructor(deps: PollSchedulerDeps) {
    this.applySignal = deps.applySignal;
    this.store = deps.store ?? new InMemoryPollJobStore();
    this.txRegistry = deps.txRegistry ?? defaultTransmissionRegistry;
    this.now = deps.now ?? (() => new Date());
    this.idgen = deps.idgen ?? (() => `poll_${Date.now()}_${seq++}`);
    this.log = deps.log ?? defaultLogger;
    this.onExpire =
      deps.onExpire ??
      ((job, log) =>
        log.todo('lifecycle/poll-scheduler', `job ${job.id} for ${job.documentId} timed out — enter contingency / alert`));
  }

  /** Enqueue a poll job from a runtime SCHEDULE_POLL effect. `ref` is the transmit() authority ref. */
  async schedule(documentId: string, effect: SchedulePollEffect, ref?: string): Promise<PollJob> {
    const provider = effect.channelProviderId ? this.txRegistry.getById(effect.channelProviderId) : null;
    if (!provider) {
      this.log.warn('lifecycle/poll-scheduler', `scheduling poll with unknown provider "${effect.channelProviderId}"`);
    }
    const job = createPollJob(
      {
        id: this.idgen(),
        documentId,
        providerId: effect.channelProviderId ?? '(unknown)',
        channel: provider?.channel ?? 'GOV_PORTAL_API',
        ref,
        awaiting: effect.awaiting,
        policy: effect.poll,
      },
      this.now(),
    );
    return this.store.enqueue(job);
  }

  /** Process every job currently due. Returns a small report (handy for tests / metrics). */
  async tick(): Promise<TickReport> {
    const now = this.now();
    const report: TickReport = { due: 0, polled: 0, resolved: 0, rescheduled: 0, expired: 0 };

    for (const job of await this.store.due(now)) {
      report.due++;
      const provider = this.txRegistry.getById(job.providerId);
      if (!provider?.poll) {
        this.log.warn('lifecycle/poll-scheduler', `provider "${job.providerId}" cannot poll; cancelling job ${job.id}`);
        await this.store.save({ ...job, status: 'CANCELLED' });
        continue;
      }

      const result = await provider.poll(job.ref ?? job.documentId, this.log);
      report.polled++;
      const decision = decidePoll(job, outcomeFromTransmission(result.status), now);
      await this.store.save(decision.job);

      switch (decision.kind) {
        case 'RESOLVE':
          await this.applySignal(job.documentId, { type: 'POLL_RESULT', status: decision.outcome }, this.log);
          report.resolved++;
          break;
        case 'RESCHEDULE':
          report.rescheduled++;
          break;
        case 'EXPIRED':
          this.onExpire(decision.job, this.log);
          report.expired++;
          break;
      }
    }
    return report;
  }
}
