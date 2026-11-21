import { BadRequestException, type CallHandler, type ExecutionContext, HttpException } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureServerError = vi.fn();
vi.mock('./error-tracking', () => ({
  captureServerError: (e: unknown, context: unknown) => captureServerError(e, context),
}));

import { ErrorTrackingInterceptor, isUntrackedPath, shouldReport } from './error-tracking.interceptor';

describe('shouldReport', () => {
  it('reports unknown errors and 5xx HttpExceptions, not 4xx', () => {
    expect(shouldReport(new Error('boom'))).toBe(true);
    expect(shouldReport(new HttpException('down', 503))).toBe(true);
    expect(shouldReport(new BadRequestException())).toBe(false);
  });
});

describe('isUntrackedPath', () => {
  it('skips the portal, public signature and document links, sign-in and legal pages', () => {
    expect(isUntrackedPath('/api/portal/0123456789abcdef0123456789abcdef/invoices')).toBe(true);
    expect(isUntrackedPath('/api/public/signatures/abc?x=1')).toBe(true);
    expect(isUntrackedPath('/api/public/documents/abc')).toBe(true);
    expect(isUntrackedPath('/api/auth/sign-in/email')).toBe(true);
    expect(isUntrackedPath('/api/auth-extended/session')).toBe(true);
    expect(isUntrackedPath('/api/legal/current')).toBe(true);
  });

  it('keeps the account routes and machine webhooks', () => {
    expect(isUntrackedPath('/api/invoices/1')).toBe(false);
    expect(isUntrackedPath('/api/public/payments/stripe/c1/webhook')).toBe(false);
    expect(isUntrackedPath('/api/clients/1/portal-access')).toBe(false);
  });
});

function httpContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ErrorTrackingInterceptor', () => {
  beforeEach(() => captureServerError.mockClear());

  async function run(error: unknown, context: ExecutionContext = {} as ExecutionContext): Promise<unknown> {
    const next: CallHandler = { handle: () => throwError(() => error) };
    return firstValueFrom(new ErrorTrackingInterceptor().intercept(context, next)).catch(
      (thrown: unknown) => thrown,
    );
  }

  it('reports a server error and rethrows the same object', async () => {
    const error = new Error('boom');
    expect(await run(error)).toBe(error);
    expect(captureServerError).toHaveBeenCalledWith(error, { route: undefined });
  });

  it('tags the route template, never the concrete path', async () => {
    const error = new Error('boom');
    await run(
      error,
      httpContext({ originalUrl: '/api/clients/c123', baseUrl: '/api/clients', route: { path: '/:id' } }),
    );
    expect(captureServerError).toHaveBeenCalledWith(error, { route: '/api/clients/:id' });
  });

  it('never reports a failure on the client portal', async () => {
    const error = new Error('boom');
    expect(
      await run(error, httpContext({ originalUrl: '/api/portal/0123456789abcdef0123456789abcdef' })),
    ).toBe(error);
    expect(captureServerError).not.toHaveBeenCalled();
  });

  it('rethrows a client error without reporting it', async () => {
    const error = new BadRequestException();
    expect(await run(error)).toBe(error);
    expect(captureServerError).not.toHaveBeenCalled();
  });
});
