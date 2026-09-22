import { vi } from 'vitest';

import type { Request, Response } from 'express';

/**
 * `timingSafeEqual` is spied on rather than timed. A test that measured response times would be a
 * flaky test asserting a property this one can assert exactly: the claim being defended is
 * "credentials reach the constant-time primitive, and reach it as two buffers of the same fixed size
 * whatever was supplied" — a short-circuit on unequal lengths shows up as the primitive not being
 * called at all, which is an observation, not a measurement.
 */
const timingSafeEqualSpy = vi.fn<(a: Uint8Array, b: Uint8Array) => boolean>();

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    timingSafeEqual: (a: Uint8Array, b: Uint8Array) => {
      timingSafeEqualSpy(a, b);
      return actual.timingSafeEqual(a, b);
    },
  };
});

import { createSwaggerBasicAuthMiddleware } from './swagger-basic-auth';

function fakeReq(path: string, authorization?: string): Request {
  return { path, headers: { authorization } } as unknown as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.setHeader = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res as Response;
}

function basicHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')}`;
}

describe('createSwaggerBasicAuthMiddleware', () => {
  const next = vi.fn();
  const middleware = createSwaggerBasicAuthMiddleware('admin', 's3cret');

  afterEach(() => {
    next.mockClear();
    timingSafeEqualSpy.mockClear();
  });

  it('never touches a route outside /api/docs', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/documents'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('401s /api/docs with no Authorization header at all — the actual finding: anonymous access', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s the sibling JSON export too — /api/docs-json shares no "/" with /api/docs', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs-json'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('401s a wrong password', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs', basicHeader('admin', 'wrong')), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('401s a malformed Authorization header', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs', 'Bearer not-basic-at-all'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('lets the request through with the right credentials', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs', basicHeader('admin', 's3cret')), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sets WWW-Authenticate on a refusal so a browser actually prompts for credentials', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs'), res, next);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('Basic'));
  });

  // The password's LENGTH is a fact about the password. A comparison that returns early when the
  // lengths differ answers "how long is it?" in its response time — one question at a time, from
  // outside, with no credential at all — and a password whose length is known is a search space
  // collapsed before the first real guess.
  it('still reaches the constant-time comparison for a password of the wrong length', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs', basicHeader('admin', 'x')), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    // Twice: the username, then the password. A comparison that gave up on the password's length
    // before reaching the primitive would show exactly one call here.
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(2);
  });

  it('compares equal-size buffers whatever the supplied credential length', () => {
    const res = fakeRes();
    // Three lengths with nothing in common — one far shorter than the configured secret, one far
    // longer, one exactly right but wrong. Every call must be over the same number of bytes.
    for (const attempt of ['', 'x'.repeat(4096), 'wrongg']) {
      middleware(fakeReq('/api/docs', basicHeader('admin', attempt)), res, next);
    }

    expect(timingSafeEqualSpy).toHaveBeenCalled();
    const widths = new Set(timingSafeEqualSpy.mock.calls.flatMap(([a, b]) => [a.byteLength, b.byteLength]));
    expect(widths.size).toBe(1);
  });

  it('reaches it for a username of the wrong length too — both halves are secrets here', () => {
    const res = fakeRes();
    middleware(fakeReq('/api/docs', basicHeader('a', 's3cret')), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(timingSafeEqualSpy).toHaveBeenCalled();
  });
});
