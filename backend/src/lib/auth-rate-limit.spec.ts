import { vi } from 'vitest';

import type { Request, Response } from 'express';

import {
  AUTH_RATE_LIMIT_RULES,
  AuthRateLimitCounterStore,
  createAuthRateLimitMiddleware,
} from './auth-rate-limit';

function fakeReq(path: string, ip = '203.0.113.9', method = 'POST'): Request {
  return { path, ip, method } as unknown as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

/** A fake `AuthRateLimitCounterStore` backed by a plain `Map` OUTSIDE any single middleware instance —
 *  standing in for a real Redis in the "shared across replicas" cases below: two independently
 *  constructed `createAuthRateLimitMiddleware(...)` calls (never sharing a closure, exactly like two
 *  Nest processes never sharing one) given the SAME instance of this fake behave the way they would if
 *  both were pointed at the same real Redis key space — the "second module instance" style this
 *  codebase's own tests use to simulate more than one process without actually booting two. */
function fakeSharedStore(now: () => number = () => Date.now()): AuthRateLimitCounterStore {
  const counters = new Map<string, { count: number; resetAt: number }>();
  return {
    async increment(key, windowMs) {
      const t = now();
      const existing = counters.get(key);
      const counter = existing && existing.resetAt > t ? existing : { count: 0, resetAt: t + windowMs };
      counter.count += 1;
      counters.set(key, counter);
      return counter.count;
    },
  };
}

describe('createAuthRateLimitMiddleware', () => {
  const next = vi.fn();

  afterEach(() => {
    next.mockClear();
  });

  it('lets a request under the sensitive limit through, and never touches res', async () => {
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });
    const res = fakeRes();

    await middleware(fakeReq('/api/auth/sign-in/email'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it(
    "429s the request that crosses the rule's own max, for the SAME ip+rule — this is the actual fix: " +
      "these routes are unreachable to any Nest APP_GUARD (ThrottlerGuard included, see this file's own " +
      'header), so without this middleware nothing here would ever return 429 at all',
    async () => {
      const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
      const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

      for (let i = 0; i < rule.max; i++) {
        const res = fakeRes();
        await middleware(fakeReq('/api/auth/sign-in/email'), res, next);
        expect(res.status).not.toHaveBeenCalled();
      }

      const blockedRes = fakeRes();
      await middleware(fakeReq('/api/auth/sign-in/email'), blockedRes, next);

      expect(blockedRes.status).toHaveBeenCalledWith(429);
      expect(blockedRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_RATE_LIMITED' }));
      // next() was only called for the requests that got through, never for the 429 itself.
      expect(next).toHaveBeenCalledTimes(rule.max);
    },
  );

  it("tracks sign-in and sign-up against the SAME budget — matches better-auth's own grouping", async () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    for (let i = 0; i < rule.max; i++) {
      const path = i % 2 === 0 ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email';
      await middleware(fakeReq(path), fakeRes(), next);
    }

    const blockedRes = fakeRes();
    await middleware(fakeReq('/api/auth/sign-in/email'), blockedRes, next);
    expect(blockedRes.status).toHaveBeenCalledWith(429);
  });

  it("keeps separate budgets per IP — one abusive client cannot exhaust another's", async () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    for (let i = 0; i < rule.max; i++) {
      await middleware(fakeReq('/api/auth/sign-in/email', '203.0.113.9'), fakeRes(), next);
    }
    const otherIpRes = fakeRes();
    await middleware(fakeReq('/api/auth/sign-in/email', '198.51.100.1'), otherIpRes, next);

    expect(otherIpRes.status).not.toHaveBeenCalled();
  });

  it('resets the window after it elapses', async () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    let clock = 0;
    const middleware = createAuthRateLimitMiddleware('/api/auth', {
      isEnabledByDefault: () => true,
      now: () => clock,
    });

    for (let i = 0; i < rule.max; i++) {
      await middleware(fakeReq('/api/auth/sign-in/email'), fakeRes(), next);
    }
    clock += rule.windowMs + 1;

    const res = fakeRes();
    await middleware(fakeReq('/api/auth/sign-in/email'), res, next);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('never limits a GET (e.g. get-session, polled on every page load)', async () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    for (let i = 0; i < rule.max + 5; i++) {
      const res = fakeRes();
      await middleware(fakeReq('/api/auth/get-session', '203.0.113.9', 'GET'), res, next);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('never limits a route outside /api/auth, or one with no matching rule', async () => {
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    const outsideRes = fakeRes();
    await middleware(fakeReq('/api/documents'), outsideRes, next);
    expect(outsideRes.status).not.toHaveBeenCalled();

    const unrelatedAuthRes = fakeRes();
    await middleware(fakeReq('/api/auth/get-session'), unrelatedAuthRes, next);
    expect(unrelatedAuthRes.status).not.toHaveBeenCalled();
  });

  it("is disabled by default under NODE_ENV=test — the e2e stack's own environment", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
      const middleware = createAuthRateLimitMiddleware('/api/auth');
      for (let i = 0; i < rule.max + 5; i++) {
        const res = fakeRes();
        await middleware(fakeReq('/api/auth/sign-in/email'), res, next);
        expect(res.status).not.toHaveBeenCalled();
      }
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('is enabled by default for any NON-test environment — unset, staging, production alike', async () => {
    const originalEnv = process.env.NODE_ENV;
    for (const value of [undefined, 'staging', 'production', 'development']) {
      process.env.NODE_ENV = value;
      try {
        const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
        const middleware = createAuthRateLimitMiddleware('/api/auth');
        for (let i = 0; i < rule.max; i++) {
          await middleware(fakeReq('/api/auth/sign-in/email'), fakeRes(), next);
        }
        const res = fakeRes();
        await middleware(fakeReq('/api/auth/sign-in/email'), res, next);
        expect(res.status).toHaveBeenCalledWith(429);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    }
  });

  /**
   * The actual defect this counter-store seam fixes: the DEFAULT store is a bare `Map` closed over by ONE middleware
   * instance. Two instances (standing in for two API replicas, each building its own middleware at
   * its own boot) never share it, so an attacker split across a round-robin load balancer gets the
   * limit multiplied by however many replicas exist. Proven here without any network by NOT giving
   * either instance a `store` at all — each gets its OWN default in-memory one, exactly like two real
   * processes would.
   */
  it('BUG (pre-fix shape): two middleware instances with no shared store do NOT share a budget', async () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const replicaA = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });
    const replicaB = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    for (let i = 0; i < rule.max; i++) {
      await replicaA(fakeReq('/api/auth/sign-in/email'), fakeRes(), next);
    }
    // The SAME client, now landing on the OTHER replica: still under ITS OWN, separate budget.
    const resOnB = fakeRes();
    await replicaB(fakeReq('/api/auth/sign-in/email'), resOnB, next);
    expect(resOnB.status).not.toHaveBeenCalled();
  });

  /**
   * The fix: two middleware instances given the SAME store (a real Redis in production,
   * `createRedisAuthRateLimitCounterStore` — this fake `fakeSharedStore` stands in for it here, see
   * its own header) DO share one budget, regardless of which instance ("replica") a given request
   * lands on — exactly the cross-process guarantee `create-app.ts` now relies on.
   */
  it('FIX: two middleware instances sharing a store enforce ONE combined budget across "replicas"', async () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const sharedStore = fakeSharedStore();
    const replicaA = createAuthRateLimitMiddleware('/api/auth', {
      isEnabledByDefault: () => true,
      store: sharedStore,
    });
    const replicaB = createAuthRateLimitMiddleware('/api/auth', {
      isEnabledByDefault: () => true,
      store: sharedStore,
    });

    // Alternate which "replica" serves each request — a round-robin load balancer's own behaviour.
    for (let i = 0; i < rule.max; i++) {
      const replica = i % 2 === 0 ? replicaA : replicaB;
      await replica(fakeReq('/api/auth/sign-in/email'), fakeRes(), next);
    }

    const blockedOnA = fakeRes();
    await replicaA(fakeReq('/api/auth/sign-in/email'), blockedOnA, next);
    expect(blockedOnA.status).toHaveBeenCalledWith(429);

    const blockedOnB = fakeRes();
    await replicaB(fakeReq('/api/auth/sign-in/email'), blockedOnB, next);
    expect(blockedOnB.status).toHaveBeenCalledWith(429);
  });

  it('fails OPEN when the store rejects — a Redis hiccup must never lock every sign-in out', async () => {
    const failingStore: AuthRateLimitCounterStore = {
      increment: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const middleware = createAuthRateLimitMiddleware('/api/auth', {
      isEnabledByDefault: () => true,
      store: failingStore,
    });
    const res = fakeRes();

    await middleware(fakeReq('/api/auth/sign-in/email'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
