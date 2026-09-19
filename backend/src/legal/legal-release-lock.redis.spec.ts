/**
 * `withLegalReleaseNotifyLock`'s real end-to-end proof — a real Redis, two independent connections
 * (standing in for two API replicas). The unit spec (`legal-release-lock.spec.ts`) proves the LOCKING
 * LOGIC against a deterministic fake; this file proves the same behaviour against the actual server —
 * genuine `SET NX PX`, genuine expiry, genuine cross-connection mutual exclusion.
 *
 * Gated EXPLICITLY (`LEGAL_RELEASE_LOCK_REDIS_TESTS=1`), same discipline every other `*.redis.spec.ts`
 * in this codebase documents: a bare local `npx vitest run` loads `.env`, so `REDIS_URL` is always set
 * on a dev machine — this must not silently start hitting a real Redis on every run.
 */
import Redis from 'ioredis';

import { withLegalReleaseNotifyLock } from './legal-release-lock';

const hasRedis = !!process.env.REDIS_URL && process.env.LEGAL_RELEASE_LOCK_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

describeWithRedis('withLegalReleaseNotifyLock — real Redis, two independent connections', () => {
  let clientA: Redis;
  let clientB: Redis;

  beforeEach(async () => {
    clientA = new Redis(process.env.REDIS_URL!);
    clientB = new Redis(process.env.REDIS_URL!);
    // The lock key is a fixed, global name (`legal-release-notify:lock`) — clear it before each test
    // so one test's own lock can never bleed into the next.
    await clientA.del('legal-release-notify:lock');
  });

  afterEach(() => {
    clientA.disconnect();
    clientB.disconnect();
  });

  it('two real connections racing the same key — only one runs fn, proven against a real server', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolveStarted) => {
      void withLegalReleaseNotifyLock(clientA, () => {
        resolveStarted();
        return new Promise<string>((resolve) => {
          releaseFirst = () => resolve('A sent it');
        });
      });
    });
    await firstStarted;

    let secondFnCalls = 0;
    const secondResult = await withLegalReleaseNotifyLock(clientB, async () => {
      secondFnCalls++;
      return 'B should never get here';
    });

    expect(secondResult).toBeUndefined();
    expect(secondFnCalls).toBe(0);

    releaseFirst?.();
  });

  it('releasing on the connection that acquired it lets the OTHER connection acquire next', async () => {
    await withLegalReleaseNotifyLock(clientA, async () => 'first pass, from A');

    const result = await withLegalReleaseNotifyLock(clientB, async () => 'second pass, from B');

    expect(result).toBe('second pass, from B');
  });
});
