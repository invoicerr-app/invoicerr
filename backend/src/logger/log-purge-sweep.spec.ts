import {
  computeLogPurgeCutoff,
  isLogPurgeEnabled,
  LOG_PURGE_BATCH_SIZE,
  readLogPurgeSweepIntervalMs,
  readLogRetentionDays,
} from './log-purge-sweep';

describe('readLogRetentionDays', () => {
  const ORIGINAL = process.env.LOG_RETENTION_DAYS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LOG_RETENTION_DAYS;
    else process.env.LOG_RETENTION_DAYS = ORIGINAL;
  });

  it('defaults to 90 days when unset', () => {
    delete process.env.LOG_RETENTION_DAYS;
    expect(readLogRetentionDays()).toBe(90);
  });

  it('reads an override from the environment', () => {
    process.env.LOG_RETENTION_DAYS = '30';
    expect(readLogRetentionDays()).toBe(30);
  });
});

describe('readLogPurgeSweepIntervalMs', () => {
  const ORIGINAL = process.env.LOG_PURGE_SWEEP_INTERVAL_MS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LOG_PURGE_SWEEP_INTERVAL_MS;
    else process.env.LOG_PURGE_SWEEP_INTERVAL_MS = ORIGINAL;
  });

  it('defaults to 1 hour (3_600_000ms) when unset', () => {
    delete process.env.LOG_PURGE_SWEEP_INTERVAL_MS;
    expect(readLogPurgeSweepIntervalMs()).toBe(3_600_000);
  });

  it('reads an override from the environment', () => {
    process.env.LOG_PURGE_SWEEP_INTERVAL_MS = '60000';
    expect(readLogPurgeSweepIntervalMs()).toBe(60000);
  });
});

describe('isLogPurgeEnabled', () => {
  it('is enabled for any positive retention', () => {
    expect(isLogPurgeEnabled(1)).toBe(true);
    expect(isLogPurgeEnabled(90)).toBe(true);
  });

  it('the "keep everything" escape hatch — disabled for zero, negative, or NaN', () => {
    expect(isLogPurgeEnabled(0)).toBe(false);
    expect(isLogPurgeEnabled(-1)).toBe(false);
    expect(isLogPurgeEnabled(Number.NaN)).toBe(false);
  });
});

describe('computeLogPurgeCutoff', () => {
  it('subtracts exactly N x 24h from `now`, never truncated to a calendar-day boundary', () => {
    const now = new Date('2026-09-19T23:59:00.000Z');
    expect(computeLogPurgeCutoff(now, 90).toISOString()).toBe('2026-06-21T23:59:00.000Z');
    expect(computeLogPurgeCutoff(now, 1).toISOString()).toBe('2026-09-18T23:59:00.000Z');
  });

  it(
    'zero retention days is the instant `now` itself (never reached in practice — isLogPurgeEnabled ' +
      'refuses 0 first)',
    () => {
      const now = new Date('2026-09-19T12:00:00.000Z');
      expect(computeLogPurgeCutoff(now, 0).getTime()).toBe(now.getTime());
    },
  );
});

describe('LOG_PURGE_BATCH_SIZE', () => {
  it('is a positive, bounded cap — never "unbounded" (undefined/0/Infinity)', () => {
    expect(LOG_PURGE_BATCH_SIZE).toBeGreaterThan(0);
    expect(Number.isFinite(LOG_PURGE_BATCH_SIZE)).toBe(true);
  });
});
