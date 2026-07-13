// Queue names — one per runtime effect type (see QUEUE_IMPL_PLAN.md §2/§4.2).
export const Q_TRANSMIT = 'compliance-transmit';
export const Q_POLL = 'compliance-poll';
export const Q_TIMER = 'compliance-timer';
export const Q_REPORT = 'compliance-report';
export const Q_SWEEP = 'compliance-sweep'; // repeatable reconcile

// Phase-1-only demo queue: proves the API/worker split (enqueue on the API side,
// consume on the worker side) without touching any compliance business logic.
// Not part of the target topology — safe to remove once a real processor exists
// and the split has been exercised end-to-end by a later phase.
export const Q_PING = 'compliance-ping';

export interface TransmitJobData {
  documentId: string;
  idempotencyKey?: string;
}

export interface PollJobData {
  documentId: string;
  scheduledJobId: string;
}

export interface TimerJobData {
  documentId: string;
  scheduledJobId: string;
}

// report & sweep carry no per-doc data (repeatable singletons)
export interface PingJobData {
  sentAt: string;
}
