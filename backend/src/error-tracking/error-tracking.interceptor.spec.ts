import { BadRequestException, type CallHandler, type ExecutionContext, HttpException } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureServerError = vi.fn();
vi.mock('./error-tracking', () => ({ captureServerError: (e: unknown) => captureServerError(e) }));

import { ErrorTrackingInterceptor, shouldReport } from './error-tracking.interceptor';

describe('shouldReport', () => {
  it('reports unknown errors and 5xx HttpExceptions, not 4xx', () => {
    expect(shouldReport(new Error('boom'))).toBe(true);
    expect(shouldReport(new HttpException('down', 503))).toBe(true);
    expect(shouldReport(new BadRequestException())).toBe(false);
  });
});

describe('ErrorTrackingInterceptor', () => {
  beforeEach(() => captureServerError.mockClear());

  async function run(error: unknown): Promise<unknown> {
    const next: CallHandler = { handle: () => throwError(() => error) };
    return firstValueFrom(new ErrorTrackingInterceptor().intercept({} as ExecutionContext, next)).catch(
      (thrown: unknown) => thrown,
    );
  }

  it('reports a server error and rethrows the same object', async () => {
    const error = new Error('boom');
    expect(await run(error)).toBe(error);
    expect(captureServerError).toHaveBeenCalledWith(error);
  });

  it('rethrows a client error without reporting it', async () => {
    const error = new BadRequestException();
    expect(await run(error)).toBe(error);
    expect(captureServerError).not.toHaveBeenCalled();
  });
});
