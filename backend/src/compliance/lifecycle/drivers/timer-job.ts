/**
 * Timer jobs — the durable side of the TIMER trigger (COMPLIANCE_LIFECYCLE.md §4). When the runtime
 * enters a state whose outgoing transition is TIMER-driven (silence = acceptance: CL 8 days, FR
 * statuses…), a TimerJob is armed; a scheduler fires it once the deadline elapses, feeding a
 * TIMER_ELAPSED signal back into the runtime.
 *
 * Pure core: the job shape, the store port (in-memory now, Prisma later), and createTimerJob — no I/O.
 * Note: a stale timer firing after the document already left the guarded state is a *safe no-op*,
 * because the runtime finds no TIMER transition from the new state (see runtime.eventFor).
 */
import { ComplianceEvent, ComplianceStatus } from '../state-machine';

export type TimerJobStatus = 'ARMED' | 'FIRED' | 'CANCELLED';

export interface TimerJob {
  id: string;
  documentId: string;
  awaiting: ComplianceStatus; // the state this timer guards (e.g. AWAITING_RESPONSE)
  onElapse: ComplianceEvent; // the event the runtime should perform on elapse (informational; the
  // runtime re-resolves it from the graph so the timer can't force an illegal transition)
  createdAt: string; // ISO
  fireAt: string; // ISO — when the deadline elapses
  status: TimerJobStatus;
}

export interface NewTimerJob {
  id: string;
  documentId: string;
  awaiting: ComplianceStatus;
  onElapse: ComplianceEvent;
  deadlineHours: number;
}

export function createTimerJob(input: NewTimerJob, now: Date): TimerJob {
  return {
    id: input.id,
    documentId: input.documentId,
    awaiting: input.awaiting,
    onElapse: input.onElapse,
    createdAt: now.toISOString(),
    fireAt: new Date(now.getTime() + input.deadlineHours * 3_600_000).toISOString(),
    status: 'ARMED',
  };
}

/** Persistence port. In-memory now; the Prisma `ScheduledJob` table (shared with polls) replaces it. */
export interface TimerJobStore {
  arm(job: TimerJob): Promise<TimerJob>;
  save(job: TimerJob): Promise<TimerJob>;
  get(id: string): Promise<TimerJob | null>;
  /** ARMED timers whose fireAt is at/before `now`. */
  due(now: Date): Promise<TimerJob[]>;
  forDocument(documentId: string): Promise<TimerJob[]>;
  cancelForDocument(documentId: string): Promise<void>;
}

export class InMemoryTimerJobStore implements TimerJobStore {
  private readonly jobs = new Map<string, TimerJob>();

  arm(job: TimerJob): Promise<TimerJob> {
    this.jobs.set(job.id, job);
    return Promise.resolve(job);
  }
  save(job: TimerJob): Promise<TimerJob> {
    this.jobs.set(job.id, job);
    return Promise.resolve(job);
  }
  get(id: string): Promise<TimerJob | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }
  due(now: Date): Promise<TimerJob[]> {
    const t = now.getTime();
    return Promise.resolve(
      [...this.jobs.values()].filter((j) => j.status === 'ARMED' && new Date(j.fireAt).getTime() <= t),
    );
  }
  forDocument(documentId: string): Promise<TimerJob[]> {
    return Promise.resolve([...this.jobs.values()].filter((j) => j.documentId === documentId));
  }
  async cancelForDocument(documentId: string): Promise<void> {
    for (const j of this.jobs.values()) {
      if (j.documentId === documentId && j.status === 'ARMED') {
        this.jobs.set(j.id, { ...j, status: 'CANCELLED' });
      }
    }
  }
}
