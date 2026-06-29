/**
 * Poll jobs — the durable side of the POLL trigger (COMPLIANCE_LIFECYCLE.md §4). When the runtime
 * enters a state whose outgoing transition is POLL-driven (e.g. PENDING_CLEARANCE for MX/CL/KSeF),
 * a PollJob is enqueued; a scheduler later calls the channel provider's poll() until the authority
 * resolves (CLEARED/REJECTED) or the timeout elapses.
 *
 * This file is the PURE core: the job shape, the store port (in-memory now, Prisma later), and the
 * decision/backoff math — all unit-testable with an injected clock, no I/O.
 */
import { TransmissionStatus } from '../../execution/types';
import { ChannelType } from '../../types';
import { PollPolicy } from '../../providers/transmission/transmission-provider';
import { ComplianceStatus } from '../state-machine';

export type PollJobStatus = 'PENDING' | 'DONE' | 'EXPIRED' | 'CANCELLED';

export interface PollJob {
  id: string;
  documentId: string;
  providerId: string; // transmission provider to poll (registry.getById)
  channel: ChannelType;
  ref?: string; // authority/transmission ref returned by transmit(), passed to poll()
  awaiting: ComplianceStatus; // the state we are polling out of (e.g. PENDING_CLEARANCE)
  attempts: number; // completed poll attempts
  createdAt: string; // ISO
  nextRunAt: string; // ISO — when this job is next due
  expiresAt: string; // ISO — createdAt + policy.timeoutHours
  status: PollJobStatus;
  policy: PollPolicy;
}

/** Result of one poll, narrowed to what the lifecycle cares about. */
export type PollOutcome = 'CLEARED' | 'REJECTED' | 'PENDING';

export function outcomeFromTransmission(status: TransmissionStatus): PollOutcome {
  return status === 'CLEARED' ? 'CLEARED' : status === 'REJECTED' ? 'REJECTED' : 'PENDING';
}

const MAX_DELAY_SECONDS = 3600; // cap exponential backoff at 1h

/** Delay before the next poll, given how many attempts have completed. */
export function nextDelaySeconds(policy: PollPolicy, attempts: number): number {
  if (policy.backoff === 'EXPONENTIAL') {
    return Math.min(policy.everySeconds * 2 ** attempts, MAX_DELAY_SECONDS);
  }
  return policy.everySeconds;
}

export interface NewPollJob {
  id: string;
  documentId: string;
  providerId: string;
  channel: ChannelType;
  ref?: string;
  awaiting: ComplianceStatus;
  policy: PollPolicy;
}

export function createPollJob(input: NewPollJob, now: Date): PollJob {
  const firstDelayMs = nextDelaySeconds(input.policy, 0) * 1000;
  return {
    ...input,
    attempts: 0,
    createdAt: now.toISOString(),
    nextRunAt: new Date(now.getTime() + firstDelayMs).toISOString(),
    expiresAt: new Date(now.getTime() + input.policy.timeoutHours * 3_600_000).toISOString(),
    status: 'PENDING',
  };
}

export type PollDecision =
  | { kind: 'RESOLVE'; outcome: 'CLEARED' | 'REJECTED'; job: PollJob } // authority answered → feed runtime, job DONE
  | { kind: 'RESCHEDULE'; job: PollJob } // still pending → bump attempts + nextRunAt (backoff)
  | { kind: 'EXPIRED'; job: PollJob }; // past timeout without an answer → give up

/** PURE: given a job, the latest poll outcome and the clock, decide what happens to the job. */
export function decidePoll(job: PollJob, outcome: PollOutcome, now: Date): PollDecision {
  if (outcome !== 'PENDING') {
    return { kind: 'RESOLVE', outcome, job: { ...job, status: 'DONE' } };
  }
  if (now.getTime() >= new Date(job.expiresAt).getTime()) {
    return { kind: 'EXPIRED', job: { ...job, status: 'EXPIRED' } };
  }
  const attempts = job.attempts + 1;
  const delayMs = nextDelaySeconds(job.policy, attempts) * 1000;
  return {
    kind: 'RESCHEDULE',
    job: { ...job, attempts, nextRunAt: new Date(now.getTime() + delayMs).toISOString() },
  };
}

/** Persistence port. In-memory now; a Prisma `ScheduledJob` table replaces it at wiring time (§13). */
export interface PollJobStore {
  enqueue(job: PollJob): Promise<PollJob>;
  save(job: PollJob): Promise<PollJob>;
  get(id: string): Promise<PollJob | null>;
  /** PENDING jobs whose nextRunAt is at/before `now`. */
  due(now: Date): Promise<PollJob[]>;
  /** All still-pending jobs regardless of nextRunAt — for boot/periodic reconciliation. */
  pending(): Promise<PollJob[]>;
  forDocument(documentId: string): Promise<PollJob[]>;
  cancelForDocument(documentId: string): Promise<void>;
}

export class InMemoryPollJobStore implements PollJobStore {
  private readonly jobs = new Map<string, PollJob>();

  enqueue(job: PollJob): Promise<PollJob> {
    this.jobs.set(job.id, job);
    return Promise.resolve(job);
  }
  save(job: PollJob): Promise<PollJob> {
    this.jobs.set(job.id, job);
    return Promise.resolve(job);
  }
  get(id: string): Promise<PollJob | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }
  due(now: Date): Promise<PollJob[]> {
    const t = now.getTime();
    return Promise.resolve(
      [...this.jobs.values()].filter(
        (j) => j.status === 'PENDING' && new Date(j.nextRunAt).getTime() <= t,
      ),
    );
  }
  pending(): Promise<PollJob[]> {
    return Promise.resolve([...this.jobs.values()].filter((j) => j.status === 'PENDING'));
  }
  forDocument(documentId: string): Promise<PollJob[]> {
    return Promise.resolve([...this.jobs.values()].filter((j) => j.documentId === documentId));
  }
  async cancelForDocument(documentId: string): Promise<void> {
    for (const j of this.jobs.values()) {
      if (j.documentId === documentId && j.status === 'PENDING') {
        this.jobs.set(j.id, { ...j, status: 'CANCELLED' });
      }
    }
  }
}
