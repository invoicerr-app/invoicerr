/**
 * In-process health signal for `Log` writes. The logger must never fail the request that produced a
 * line, so a database that stops accepting `Log` rows is otherwise invisible beyond one Nest console
 * line per write.
 *
 * `consecutiveFailures` is what distinguishes a one-off write failure from a persisting condition;
 * `failures` keeps the total since process start. The snapshot is read by `GET /api/health`, which
 * reports `status: 'degraded'` once the streak reaches `LOG_PERSIST_FAILURE_THRESHOLD` while still
 * answering 200: the API keeps serving, but an operator sees that the log screen is going empty.
 *
 * These counters live in one process: each replica reports its own, which is what a per-pod health
 * probe shows. Nothing is persisted, and no Prometheus metric is exported yet.
 */
export const LOG_PERSIST_FAILURE_THRESHOLD = 5;

export interface LogPersistenceSnapshot {
  status: 'ok' | 'degraded';
  /** Failed writes since process start. */
  failures: number;
  /** Failed writes since the last successful one; what the threshold is measured on. */
  consecutiveFailures: number;
  /** ISO 8601 UTC timestamp of the last failed write, null before the first one. */
  lastFailureAt: string | null;
}

export class LogPersistenceHealth {
  private failures = 0;
  private consecutiveFailures = 0;
  private lastFailureAt: string | null = null;

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    this.consecutiveFailures += 1;
    this.lastFailureAt = new Date().toISOString();
  }

  snapshot(): LogPersistenceSnapshot {
    return {
      status: this.consecutiveFailures >= LOG_PERSIST_FAILURE_THRESHOLD ? 'degraded' : 'ok',
      failures: this.failures,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
    };
  }

  /** Test isolation only: a new process starts from zero like this. */
  reset(): void {
    this.failures = 0;
    this.consecutiveFailures = 0;
    this.lastFailureAt = null;
  }
}

export const logPersistenceHealth = new LogPersistenceHealth();
