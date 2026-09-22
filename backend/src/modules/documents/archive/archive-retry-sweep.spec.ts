import {
  buildEscalatedArchiveError,
  nextArchiveRetryAt,
  readArchiveRetryEscalateAfterAttempts,
  shouldEscalateArchiveRetry,
} from './archive-retry-sweep';

const T0 = new Date('2026-09-21T10:00:00.000Z');

describe('the archive retry schedule', () => {
  it('backs off exponentially from one minute, counting the send-time failure as attempt 1', () => {
    expect(nextArchiveRetryAt(T0, 1).toISOString()).toBe('2026-09-21T10:01:00.000Z');
    expect(nextArchiveRetryAt(T0, 2).toISOString()).toBe('2026-09-21T10:02:00.000Z');
    expect(nextArchiveRetryAt(T0, 3).toISOString()).toBe('2026-09-21T10:04:00.000Z');
    expect(nextArchiveRetryAt(T0, 4).toISOString()).toBe('2026-09-21T10:08:00.000Z');
  });

  it('caps the delay at an hour, and stays a real date for a store broken for months', () => {
    expect(nextArchiveRetryAt(T0, 12).toISOString()).toBe('2026-09-21T11:00:00.000Z');
    // The clamp exists because `2 ** 1024` is `Infinity`, which would produce an Invalid Date and
    // take the row out of every future pass's `nextAttemptAt <= now` window — abandoning the bytes
    // by arithmetic, which is precisely what this journal may never do.
    const veryLate = nextArchiveRetryAt(T0, 5000);
    expect(Number.isNaN(veryLate.getTime())).toBe(false);
    expect(veryLate.toISOString()).toBe('2026-09-21T11:00:00.000Z');
  });

  it('escalates on the fifth attempt — about half an hour of real outage, not the first blip', () => {
    expect(readArchiveRetryEscalateAfterAttempts()).toBe(5);
    expect(shouldEscalateArchiveRetry(1)).toBe(false);
    expect(shouldEscalateArchiveRetry(4)).toBe(false);
    expect(shouldEscalateArchiveRetry(5)).toBe(true);
  });

  it('names the document, the gap and the cause in the escalated wording', () => {
    const message = buildEscalatedArchiveError({
      displayNumber: 'INV-2026-0042',
      attempts: 5,
      firstFailedAt: T0,
      lastError: 'S3 503 SlowDown',
    });

    expect(message).toContain('INV-2026-0042');
    expect(message).toContain('NO legal archive');
    expect(message).toContain('2026-09-21T10:00:00.000Z');
    expect(message).toContain('S3 503 SlowDown');
  });

  it('still says which document it is about when the type never numbered it', () => {
    const message = buildEscalatedArchiveError({
      displayNumber: null,
      attempts: 5,
      firstFailedAt: T0,
      lastError: 'ENOSPC: no space left on device',
    });

    expect(message).toContain('This document was delivered but has NO legal archive');
    expect(message).toContain('ENOSPC: no space left on device');
  });
});
