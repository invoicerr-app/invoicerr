import { vi, type Mock } from 'vitest';

import { callPolarWithRetry } from './polar-client';

function rateLimitError(): unknown {
  return { statusCode: 429, message: 'Too Many Requests' };
}

describe('callPolarWithRetry', () => {
  it('returns the result on the first try when nothing fails', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(callPolarWithRetry(fn, 'test call')).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a 429 (rate limit) and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');

    const result = await callPolarWithRetry(fn, 'test call', { baseDelayMs: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries a non-429 failure — a business refusal or outage is not something a retry fixes', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('polar is down'));

    await expect(callPolarWithRetry(fn, 'test call', { baseDelayMs: 1 })).rejects.toThrow('polar is down');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is BOUNDED — gives up and rethrows once maxAttempts is exhausted, never retries forever', async () => {
    const fn = vi.fn().mockRejectedValue(rateLimitError());

    await expect(
      callPolarWithRetry(fn, 'test call', { baseDelayMs: 1, maxAttempts: 3 }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially between attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce('ok');
    // Filtered to delays this call could plausibly ask for (baseDelayMs 10, at most a few backoff
    // steps) — spying on the GLOBAL setTimeout also catches whatever OTHER timers the test runner
    // itself schedules when this file runs alongside the rest of the suite (observed: a handful of
    // unrelated ~10s housekeeping timers), which a plain "record everything" spy would otherwise
    // wrongly attribute to this call.
    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      if ((ms ?? 0) <= 1000) delays.push(ms ?? 0);
      return realSetTimeout(cb, 0);
    }) as unknown as typeof setTimeout);

    await callPolarWithRetry(fn, 'test call', { baseDelayMs: 10 });

    expect(delays).toEqual([10, 20]);
    (global.setTimeout as unknown as Mock).mockRestore();
  });
});
