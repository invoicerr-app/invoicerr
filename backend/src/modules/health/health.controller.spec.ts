import { ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { HealthController } from './health.controller';
import type { HealthReport, HealthService } from './health.service';

describe('HealthController', () => {
  const check = vi.fn<HealthService['check']>();
  const controller = new HealthController({ check } as unknown as HealthService);

  afterEach(() => check.mockReset());

  it('returns the report as-is when healthy', async () => {
    const report: HealthReport = {
      status: 'ok',
      database: 'up',
      databaseLatencyMs: 1,
      redis: 'up',
      redisLatencyMs: 1,
      version: 'v2.0.0-alpha.4',
      time: '2026-10-11T08:00:00.000Z',
      uptimeSeconds: 42,
      logPersistence: {
        status: 'ok',
        failures: 0,
        consecutiveFailures: 0,
        lastFailureAt: null,
      },
    };
    check.mockResolvedValue({ healthy: true, report });

    await expect(controller.check()).resolves.toBe(report);
  });

  it.each([
    { status: 'error', database: 'down' } as const,
    { status: 'error', database: 'up', redis: 'down' } as const,
  ])('answers 503 with %o', async (body) => {
    check.mockResolvedValue({ healthy: false, body });

    const error = await controller.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual(body);
  });

  it('is exempt from the Redis-backed throttler', () => {
    const skip = new Reflector().get<boolean>('THROTTLER:SKIPdefault', HealthController);

    expect(skip).toBe(true);
  });
});
