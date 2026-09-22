/**
 * `LoggerController` constructed directly. `@/logger/logger.service`'s `fetchLogs` is mocked — this
 * file is about `streamLogs` threading the ACTIVE company into `fetchLogs`'s own `companyId` filter
 * (a real, DB-level scope now that `Log` carries the column) and the `intervalMs` floor, never
 * `fetchLogs`'s own query-building (covered by `logger.service.spec.ts`).
 *
 * Covers the cross-tenant leak this stream used to have: before `Log.companyId` existed, any company's
 * own OWNER/ADMIN opening this stream saw every OTHER company's log activity a shared member ever
 * triggered (or, for a queue-worker log with no `userId` at all, nothing — even when it genuinely
 * belonged to THIS company). Filtering by `companyId` in the query itself fixes both.
 */

import { vi, type Mock } from 'vitest';

vi.mock('@/logger/logger.service', () => ({
  logger: { fetchLogs: vi.fn() },
}));

import { firstValueFrom } from 'rxjs';

import { LoggerController, clampStreamIntervalMs } from './logger.controller';
import { logger } from '@/logger/logger.service';

const mockedLogger = logger as unknown as { fetchLogs: Mock };

describe('clampStreamIntervalMs', () => {
  it('floors an unbounded value — intervalMs=1 would otherwise be ~one query per millisecond', () => {
    expect(clampStreamIntervalMs('1')).toBe(1000);
    expect(clampStreamIntervalMs('0')).toBe(1000);
  });

  it('leaves a value already at or above the floor untouched', () => {
    expect(clampStreamIntervalMs('5000')).toBe(5000);
  });

  it('defaults to 1000ms for a missing or non-numeric value', () => {
    expect(clampStreamIntervalMs(undefined)).toBe(1000);
    expect(clampStreamIntervalMs('not-a-number')).toBe(1000);
  });
});

describe('LoggerController#streamLogs', () => {
  let controller: LoggerController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new LoggerController();
  });

  it('passes the active company straight into fetchLogs — the tenant scope is a real DB filter now', async () => {
    mockedLogger.fetchLogs.mockResolvedValue([]);

    await firstValueFrom(controller.streamLogs('company-a', undefined, undefined, undefined, '5000'));

    expect(mockedLogger.fetchLogs).toHaveBeenCalledWith({ companyId: 'company-a' }, { skip: 0, take: 100 });
  });

  it('merges optional category/level/userId query filters alongside companyId', async () => {
    mockedLogger.fetchLogs.mockResolvedValue([]);

    await firstValueFrom(controller.streamLogs('company-a', 'documents', 'ERROR', 'user-1', '5000'));

    expect(mockedLogger.fetchLogs).toHaveBeenCalledWith(
      { companyId: 'company-a', category: 'documents', level: 'ERROR', userId: 'user-1' },
      { skip: 0, take: 100 },
    );
  });

  it('an ordinary same-company request sees exactly what fetchLogs — already companyId-scoped — returns', async () => {
    mockedLogger.fetchLogs.mockResolvedValue([
      { userId: 'member-a', message: 'mine', timestamp: new Date() },
    ]);

    const event = await firstValueFrom(
      controller.streamLogs('company-a', undefined, undefined, undefined, '5000'),
    );

    expect(event.data).toHaveLength(1);
    expect(event.data[0].message).toBe('mine');
  });

  it('sorts results newest-first regardless of the order fetchLogs happened to return them in', async () => {
    mockedLogger.fetchLogs.mockResolvedValue([
      { userId: 'a', message: 'older', timestamp: new Date('2026-01-01T00:00:01Z') },
      { userId: 'a', message: 'newer', timestamp: new Date('2026-01-01T00:00:02Z') },
    ]);

    const event = await firstValueFrom(
      controller.streamLogs('company-a', undefined, undefined, undefined, '5000'),
    );

    expect(event.data.map((entry: { message: string }) => entry.message)).toEqual(['newer', 'older']);
  });
});
