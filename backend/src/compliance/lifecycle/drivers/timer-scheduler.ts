/**
 * Timer scheduler — the durable driver for TIMER triggers (COMPLIANCE_LIFECYCLE.md §4): the
 * "silence = acceptance" deadlines (CL 8 days, FR payment statuses…). It turns a runtime `ARM_TIMER`
 * effect into a persisted TimerJob and, on each `tick()`, fires every elapsed timer by feeding a
 * `TIMER_ELAPSED` signal back into the document's runtime (which maps it to the legal event, e.g.
 * ACCEPT — or no-ops if the document already moved on).
 *
 * Same shape as the poll scheduler: pure job logic (timer-job.ts) + this thin I/O edge with store /
 * clock / applySignal injected. In production `tick()` is driven by a cron / @Interval.
 */
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { Effect, LifecycleSignal } from '../runtime';
import { createTimerJob, InMemoryTimerJobStore, TimerJob, TimerJobStore } from './timer-job';

export type ArmTimerEffect = Extract<Effect, { kind: 'ARM_TIMER' }>;

export type ApplySignal = (documentId: string, signal: LifecycleSignal, log: ComplianceLogger) => void | Promise<void>;

export interface TimerSchedulerDeps {
  applySignal: ApplySignal;
  store?: TimerJobStore;
  now?: () => Date;
  idgen?: () => string;
  log?: ComplianceLogger;
}

export interface TickReport {
  due: number;
  fired: number;
}

let seq = 0;

export class TimerScheduler {
  private readonly store: TimerJobStore;
  private readonly now: () => Date;
  private readonly idgen: () => string;
  private readonly applySignal: ApplySignal;
  private readonly log: ComplianceLogger;

  constructor(deps: TimerSchedulerDeps) {
    this.applySignal = deps.applySignal;
    this.store = deps.store ?? new InMemoryTimerJobStore();
    this.now = deps.now ?? (() => new Date());
    this.idgen = deps.idgen ?? (() => `timer_${Date.now()}_${seq++}`);
    this.log = deps.log ?? defaultLogger;
  }

  /** Arm a timer from a runtime ARM_TIMER effect. Returns null for an open-ended window (no deadline). */
  async arm(documentId: string, effect: ArmTimerEffect): Promise<TimerJob | null> {
    if (effect.deadlineHours == null) {
      this.log.info('lifecycle/timer-scheduler', `response window for ${documentId} has no deadline — no silence timer`);
      return null;
    }
    const job = createTimerJob(
      { id: this.idgen(), documentId, awaiting: effect.awaiting, onElapse: effect.onElapse, deadlineHours: effect.deadlineHours },
      this.now(),
    );
    return this.store.arm(job);
  }

  /** Cancel armed timers for a document (call when it leaves the guarded state — optional, the fire is a safe no-op otherwise). */
  async cancelForDocument(documentId: string): Promise<void> {
    await this.store.cancelForDocument(documentId);
  }

  /** Fire every elapsed timer once. */
  async tick(): Promise<TickReport> {
    const now = this.now();
    const report: TickReport = { due: 0, fired: 0 };
    for (const job of await this.store.due(now)) {
      report.due++;
      await this.store.save({ ...job, status: 'FIRED' });
      await this.applySignal(job.documentId, { type: 'TIMER_ELAPSED' }, this.log);
      report.fired++;
    }
    return report;
  }
}
