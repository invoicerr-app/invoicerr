import type { Request, Response } from 'express';

import { AUTH_RATE_LIMIT_RULES, createAuthRateLimitMiddleware } from './auth-rate-limit';

function fakeReq(path: string, ip = '203.0.113.9', method = 'POST'): Request {
  return { path, ip, method } as unknown as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('createAuthRateLimitMiddleware', () => {
  const next = jest.fn();

  afterEach(() => {
    next.mockClear();
  });

  it('lets a request under the sensitive limit through, and never touches res', () => {
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });
    const res = fakeRes();

    middleware(fakeReq('/api/auth/sign-in/email'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it(
    "429s the request that crosses the rule's own max, for the SAME ip+rule — this is the actual fix: " +
      "these routes are unreachable to any Nest APP_GUARD (ThrottlerGuard included, see this file's own " +
      'header), so without this middleware nothing here would ever return 429 at all',
    () => {
      const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
      const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

      for (let i = 0; i < rule.max; i++) {
        const res = fakeRes();
        middleware(fakeReq('/api/auth/sign-in/email'), res, next);
        expect(res.status).not.toHaveBeenCalled();
      }

      const blockedRes = fakeRes();
      middleware(fakeReq('/api/auth/sign-in/email'), blockedRes, next);

      expect(blockedRes.status).toHaveBeenCalledWith(429);
      expect(blockedRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_RATE_LIMITED' }));
      // next() was only called for the requests that got through, never for the 429 itself.
      expect(next).toHaveBeenCalledTimes(rule.max);
    },
  );

  it("tracks sign-in and sign-up against the SAME budget — matches better-auth's own grouping", () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    for (let i = 0; i < rule.max; i++) {
      const path = i % 2 === 0 ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email';
      middleware(fakeReq(path), fakeRes(), next);
    }

    const blockedRes = fakeRes();
    middleware(fakeReq('/api/auth/sign-in/email'), blockedRes, next);
    expect(blockedRes.status).toHaveBeenCalledWith(429);
  });

  it("keeps separate budgets per IP — one abusive client cannot exhaust another's", () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    for (let i = 0; i < rule.max; i++) {
      middleware(fakeReq('/api/auth/sign-in/email', '203.0.113.9'), fakeRes(), next);
    }
    const otherIpRes = fakeRes();
    middleware(fakeReq('/api/auth/sign-in/email', '198.51.100.1'), otherIpRes, next);

    expect(otherIpRes.status).not.toHaveBeenCalled();
  });

  it('resets the window after it elapses', () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    let clock = 0;
    const middleware = createAuthRateLimitMiddleware('/api/auth', {
      isEnabledByDefault: () => true,
      now: () => clock,
    });

    for (let i = 0; i < rule.max; i++) {
      middleware(fakeReq('/api/auth/sign-in/email'), fakeRes(), next);
    }
    clock += rule.windowMs + 1;

    const res = fakeRes();
    middleware(fakeReq('/api/auth/sign-in/email'), res, next);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('never limits a GET (e.g. get-session, polled on every page load)', () => {
    const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    for (let i = 0; i < rule.max + 5; i++) {
      const res = fakeRes();
      middleware(fakeReq('/api/auth/get-session', '203.0.113.9', 'GET'), res, next);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('never limits a route outside /api/auth, or one with no matching rule', () => {
    const middleware = createAuthRateLimitMiddleware('/api/auth', { isEnabledByDefault: () => true });

    const outsideRes = fakeRes();
    middleware(fakeReq('/api/documents'), outsideRes, next);
    expect(outsideRes.status).not.toHaveBeenCalled();

    const unrelatedAuthRes = fakeRes();
    middleware(fakeReq('/api/auth/get-session'), unrelatedAuthRes, next);
    expect(unrelatedAuthRes.status).not.toHaveBeenCalled();
  });

  it("is disabled by default under NODE_ENV=test — the e2e stack's own environment", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
      const middleware = createAuthRateLimitMiddleware('/api/auth');
      for (let i = 0; i < rule.max + 5; i++) {
        const res = fakeRes();
        middleware(fakeReq('/api/auth/sign-in/email'), res, next);
        expect(res.status).not.toHaveBeenCalled();
      }
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('is enabled by default for any NON-test environment — unset, staging, production alike', () => {
    const originalEnv = process.env.NODE_ENV;
    for (const value of [undefined, 'staging', 'production', 'development']) {
      process.env.NODE_ENV = value;
      try {
        const rule = AUTH_RATE_LIMIT_RULES.find((r) => r.name === 'credentials')!;
        const middleware = createAuthRateLimitMiddleware('/api/auth');
        for (let i = 0; i < rule.max; i++) {
          middleware(fakeReq('/api/auth/sign-in/email'), fakeRes(), next);
        }
        const res = fakeRes();
        middleware(fakeReq('/api/auth/sign-in/email'), res, next);
        expect(res.status).toHaveBeenCalledWith(429);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    }
  });
});
