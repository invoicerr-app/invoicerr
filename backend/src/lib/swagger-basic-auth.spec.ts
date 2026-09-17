import type { Request, Response } from 'express';

import { createSwaggerBasicAuthMiddleware } from './swagger-basic-auth';

function fakeReq(path: string, authorization?: string): Request {
  return { path, headers: { authorization } } as unknown as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.setHeader = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res as Response;
}

function basicHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')}`;
}

describe('createSwaggerBasicAuthMiddleware', () => {
  const next = jest.fn();
  const middleware = createSwaggerBasicAuthMiddleware('admin', 's3cret');

  afterEach(() => {
    next.mockClear();
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
});
