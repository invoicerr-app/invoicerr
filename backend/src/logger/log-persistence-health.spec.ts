import { LOG_PERSIST_FAILURE_THRESHOLD, LogPersistenceHealth } from './log-persistence-health';

describe('LogPersistenceHealth', () => {
  let health: LogPersistenceHealth;

  beforeEach(() => {
    health = new LogPersistenceHealth();
  });

  it('starts ok, with nothing recorded', () => {
    expect(health.snapshot()).toEqual({
      status: 'ok',
      failures: 0,
      consecutiveFailures: 0,
      lastFailureAt: null,
    });
  });

  it('stays ok below the threshold and keeps counting', () => {
    for (let i = 0; i < LOG_PERSIST_FAILURE_THRESHOLD - 1; i++) health.recordFailure();

    expect(health.snapshot()).toMatchObject({
      status: 'ok',
      failures: LOG_PERSIST_FAILURE_THRESHOLD - 1,
      consecutiveFailures: LOG_PERSIST_FAILURE_THRESHOLD - 1,
    });
  });

  it('is degraded from the threshold on, and stamps the last failure in ISO 8601 UTC', () => {
    for (let i = 0; i < LOG_PERSIST_FAILURE_THRESHOLD; i++) health.recordFailure();

    const snapshot = health.snapshot();
    expect(snapshot.status).toBe('degraded');
    expect(snapshot.consecutiveFailures).toBe(LOG_PERSIST_FAILURE_THRESHOLD);
    expect(snapshot.lastFailureAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('clears the streak on a successful write but keeps the total and the last failure', () => {
    health.recordFailure();
    health.recordFailure();
    const lastFailureAt = health.snapshot().lastFailureAt;

    health.recordSuccess();

    expect(health.snapshot()).toEqual({
      status: 'ok',
      failures: 2,
      consecutiveFailures: 0,
      lastFailureAt,
    });
  });

  it('returns to ok after enough successes separate two streaks', () => {
    for (let i = 0; i < LOG_PERSIST_FAILURE_THRESHOLD; i++) health.recordFailure();
    expect(health.snapshot().status).toBe('degraded');

    health.recordSuccess();
    health.recordFailure();

    expect(health.snapshot()).toMatchObject({ status: 'ok', consecutiveFailures: 1 });
  });

  it('reset() clears everything, like a fresh process', () => {
    health.recordFailure();
    health.reset();

    expect(health.snapshot()).toEqual({
      status: 'ok',
      failures: 0,
      consecutiveFailures: 0,
      lastFailureAt: null,
    });
  });
});
