import { vi } from 'vitest';

import type { Request } from 'express';

import { isUnderBasePath, normalizeBasePath, skipBodyParserFor } from './body-parser-auth-skip';

describe('normalizeBasePath', () => {
  it('strips trailing slashes', () => {
    expect(normalizeBasePath('/api/auth/')).toBe('/api/auth');
    expect(normalizeBasePath('/api/auth///')).toBe('/api/auth');
  });

  it('leaves an already-normalized path alone', () => {
    expect(normalizeBasePath('/api/auth')).toBe('/api/auth');
  });

  it('never returns an empty string — the bare root collapses to "/"', () => {
    expect(normalizeBasePath('/')).toBe('/');
    expect(normalizeBasePath('')).toBe('/');
  });
});

describe('isUnderBasePath', () => {
  const asReq = (path: string): Pick<Request, 'path'> => ({ path });

  it('matches the base path itself', () => {
    expect(isUnderBasePath(asReq('/api/auth'), '/api/auth')).toBe(true);
  });

  it('matches anything nested under the base path', () => {
    expect(isUnderBasePath(asReq('/api/auth/polar/webhooks'), '/api/auth')).toBe(true);
    expect(isUnderBasePath(asReq('/api/auth/sign-in/email'), '/api/auth')).toBe(true);
  });

  it('does NOT match a mere string prefix that is not actually nested', () => {
    // The exact bug a naive `.startsWith()` (with no separator check) would cause: `/api/authorize`
    // is not under `/api/auth`, and must never be treated as if it were.
    expect(isUnderBasePath(asReq('/api/authorize'), '/api/auth')).toBe(false);
    expect(isUnderBasePath(asReq('/api/auth-legacy'), '/api/auth')).toBe(false);
  });

  it('does not match an unrelated path', () => {
    expect(isUnderBasePath(asReq('/api/documents'), '/api/auth')).toBe(false);
  });
});

describe('skipBodyParserFor', () => {
  const next = vi.fn();
  const res = {} as Parameters<ReturnType<typeof skipBodyParserFor>>[1];

  afterEach(() => {
    next.mockClear();
  });

  it('calls next() directly, never the wrapped parser, for a request under the base path', () => {
    const parser = vi.fn();
    const handler = skipBodyParserFor('/api/auth', parser);

    handler({ path: '/api/auth/polar/webhooks' } as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(parser).not.toHaveBeenCalled();
  });

  it('delegates to the wrapped parser for anything else, passing req/res/next through untouched', () => {
    const parser = vi.fn();
    const handler = skipBodyParserFor('/api/auth', parser);
    const req = { path: '/api/documents' } as Request;

    handler(req, res, next);

    expect(parser).toHaveBeenCalledTimes(1);
    expect(parser).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('normalizes a trailing-slash base path before matching', () => {
    const parser = vi.fn();
    const handler = skipBodyParserFor('/api/auth/', parser);

    handler({ path: '/api/auth/polar/webhooks' } as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(parser).not.toHaveBeenCalled();
  });
});
