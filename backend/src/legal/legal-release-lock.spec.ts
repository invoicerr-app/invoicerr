import { vi } from 'vitest';

import { LegalReleaseLockRedisClient, withLegalReleaseNotifyLock } from './legal-release-lock';

/**
 * A minimal, deterministic in-memory stand-in for Redis's own `SET key value NX PX ttlMs` / `GET` /
 * `DEL` — real enough to prove the LOCKING LOGIC (mutual exclusion, TTL-based crash recovery, "only
 * delete my own token") without a real network or real wall-clock waiting. `now` is an injectable
 * clock so a spec can simulate "the TTL elapsed" instantly rather than actually sleeping 5 minutes.
 */
function fakeLockRedis(now: () => number = () => Date.now()): LegalReleaseLockRedisClient {
  const store = new Map<string, { value: string; expiresAt: number }>();

  function isLive(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= now()) {
      store.delete(key); // Redis itself lazily expires a key the moment it is next looked at.
      return false;
    }
    return true;
  }

  return {
    async set(key, value, _mode, ttlMs, _flag) {
      if (isLive(key)) return null; // NX: refuse when a live (non-expired) key already exists.
      store.set(key, { value, expiresAt: now() + ttlMs });
      return 'OK';
    },
    async get(key) {
      return isLive(key) ? store.get(key)!.value : null;
    },
    async del(key) {
      store.delete(key);
      return 1;
    },
  };
}

describe('withLegalReleaseNotifyLock', () => {
  it('runs fn and returns its result when the lock is free', async () => {
    const client = fakeLockRedis();
    const fn = vi.fn().mockResolvedValue('done');

    const result = await withLegalReleaseNotifyLock(client, fn);

    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('releases the lock on success, so a later call is not needlessly blocked', async () => {
    const client = fakeLockRedis();
    await withLegalReleaseNotifyLock(client, async () => 'first pass');

    const secondFn = vi.fn().mockResolvedValue('second pass');
    const result = await withLegalReleaseNotifyLock(client, secondFn);

    expect(result).toBe('second pass');
    expect(secondFn).toHaveBeenCalledTimes(1);
  });

  it('releases the lock even when fn throws, so a genuine failure does not wedge future passes', async () => {
    const client = fakeLockRedis();
    await expect(
      withLegalReleaseNotifyLock(client, async () => {
        throw new Error('mail provider down');
      }),
    ).rejects.toThrow('mail provider down');

    const secondFn = vi.fn().mockResolvedValue('resumed');
    const result = await withLegalReleaseNotifyLock(client, secondFn);
    expect(result).toBe('resumed');
  });

  /**
   * THE core defect this fixes, reproduced directly: two replicas booting within the same rolling
   * deploy, close enough together that both reach this code before either has finished (or even
   * started releasing). Only ONE of them may ever call `fn` (the actual "send the notification"
   * pass) at a time — this is the mutual exclusion that turns "up to 3 identical emails per user"
   * into "one replica's pass handles it".
   */
  it('two concurrent callers racing the SAME lock — only ONE runs fn, the other is skipped', async () => {
    const client = fakeLockRedis();
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolveStarted) => {
      void withLegalReleaseNotifyLock(client, () => {
        resolveStarted();
        // Held open until the test explicitly lets it finish — simulates a genuinely in-progress
        // pass, not an instantly-resolving one, so the second caller's attempt below unambiguously
        // races a STILL-HELD lock rather than a already-released one.
        return new Promise<string>((resolve) => {
          releaseFirst = () => resolve('first replica sent it');
        });
      });
    });
    await firstStarted;

    const secondFn = vi.fn().mockResolvedValue('should never run');
    const secondResult = await withLegalReleaseNotifyLock(client, secondFn);

    expect(secondResult).toBeUndefined(); // skipped — did not even call fn.
    expect(secondFn).not.toHaveBeenCalled();

    releaseFirst?.();
  });

  /**
   * Crash recovery: a replica that "crashes" (never reaches its own `finally`, simulated here by
   * simply never resolving/rejecting — this test does not wait for it) leaves the lock held only
   * until its TTL elapses. A later attempt, once the clock has moved past that TTL, is NOT
   * permanently blocked — the whole reason the lock has a TTL at all rather than living forever.
   */
  it('a lock whose TTL has elapsed can be re-acquired — a crashed holder does not wedge every future pass', async () => {
    let clock = 1_000_000;
    const client = fakeLockRedis(() => clock);

    // The "crashed" replica: acquires and never releases (fn never settles, and this call is never
    // awaited to completion — exactly what a process dying mid-pass looks like from Redis's point of
    // view: the key just sits there until its own PX expiry).
    void withLegalReleaseNotifyLock(client, () => new Promise<void>(() => undefined));

    // Immediately after, the lock is still held — a second caller right now is correctly skipped.
    const tooSoon = vi.fn().mockResolvedValue('too soon');
    expect(await withLegalReleaseNotifyLock(client, tooSoon)).toBeUndefined();
    expect(tooSoon).not.toHaveBeenCalled();

    // Advance the clock past the lock's own TTL (5 minutes) — standing in for time actually passing
    // while the crashed process stays dead.
    clock += 6 * 60_000;

    const resumed = vi.fn().mockResolvedValue('resumed after crash');
    const result = await withLegalReleaseNotifyLock(client, resumed);

    expect(result).toBe('resumed after crash');
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it("never deletes a DIFFERENT replica's lock — releasing only removes OUR OWN token", async () => {
    let clock = 1_000_000;
    const client = fakeLockRedis(() => clock);

    // Replica A acquires, then "crashes" without releasing.
    let releaseA: (() => void) | undefined;
    void withLegalReleaseNotifyLock(client, () => {
      return new Promise<void>((resolve) => {
        releaseA = resolve;
      });
    });

    // Its TTL elapses; replica B acquires the SAME key with a fresh token.
    clock += 6 * 60_000;
    let bIsRunning: () => void = () => undefined;
    const bStarted = new Promise<void>((resolve) => {
      bIsRunning = resolve;
    });
    let releaseB: (() => void) | undefined;
    const bResultPromise = withLegalReleaseNotifyLock(client, () => {
      bIsRunning();
      return new Promise<string>((resolve) => {
        releaseB = () => resolve('B finished');
      });
    });
    await bStarted;

    // Replica A's own (long-overdue) release logic now runs — its token no longer matches what is
    // in Redis (B's token has since overwritten it), so this must NOT delete B's live lock.
    releaseA?.();
    await new Promise((resolve) => setImmediate(resolve)); // let A's own `finally` actually run.

    // A THIRD caller, arriving while B is still working, must still be correctly refused — proof that
    // A's stale release did not accidentally free the key out from under B.
    const thirdFn = vi.fn().mockResolvedValue('should not run either');
    expect(await withLegalReleaseNotifyLock(client, thirdFn)).toBeUndefined();
    expect(thirdFn).not.toHaveBeenCalled();

    releaseB?.();
    expect(await bResultPromise).toBe('B finished');
  });
});
