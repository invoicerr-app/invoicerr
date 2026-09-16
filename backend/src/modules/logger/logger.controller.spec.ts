/**
 * `LoggerController` constructed directly. `@/logger/logger.service`'s `fetchLogs` and
 * `@/prisma/prisma.service`'s `userCompany.findMany` are both mocked — this file is about the
 * TENANT-SCOPING filter `streamLogs` applies on top of whatever `fetchLogs` returns, and the
 * `intervalMs` floor, never `fetchLogs`'s own query building (untouched by this fix).
 *
 * Covers the cross-tenant leak: `Log` has no `companyId` (predates multi-tenancy), so before this fix
 * any company's own OWNER/ADMIN opening this stream saw every OTHER company's log activity too —
 * user ids, request paths, and whatever free-text `details` a log call attached. `streamLogs` now
 * drops any row whose `userId` does not belong to the ACTIVE company's own membership (or has no
 * `userId` at all) before it ever reaches the response.
 */
jest.mock('@/logger/logger.service', () => ({
  logger: { fetchLogs: jest.fn() },
}));

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: { findMany: jest.fn() },
  },
}));

import { firstValueFrom } from 'rxjs';

import { LoggerController, clampStreamIntervalMs } from './logger.controller';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

const mockedLogger = logger as unknown as { fetchLogs: jest.Mock };
const mockedPrisma = prisma as unknown as { userCompany: { findMany: jest.Mock } };

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
    jest.clearAllMocks();
    controller = new LoggerController();
  });

  it('drops log entries whose userId is not a member of the active company — SEC-10', async () => {
    mockedPrisma.userCompany.findMany.mockResolvedValue([{ userId: 'member-a' }, { userId: 'member-b' }]);
    mockedLogger.fetchLogs.mockResolvedValue([
      { userId: 'member-a', message: 'mine', timestamp: new Date('2026-01-01T00:00:01Z') },
      {
        userId: 'someone-in-another-company',
        message: 'not mine',
        timestamp: new Date('2026-01-01T00:00:02Z'),
      },
    ]);

    const observable = controller.streamLogs('company-a', undefined, undefined, undefined, '5000');
    const event = await firstValueFrom(observable);

    expect(mockedPrisma.userCompany.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-a' },
      select: { userId: true },
    });
    expect(event.data).toHaveLength(1);
    expect(event.data[0].message).toBe('mine');
  });

  it('drops a log entry with no userId at all — ambiguous ownership is hidden, never shown to every company', async () => {
    mockedPrisma.userCompany.findMany.mockResolvedValue([{ userId: 'member-a' }]);
    mockedLogger.fetchLogs.mockResolvedValue([
      { userId: null, message: 'system event', timestamp: new Date() },
    ]);

    const event = await firstValueFrom(
      controller.streamLogs('company-a', undefined, undefined, undefined, '5000'),
    );

    expect(event.data).toHaveLength(0);
  });

  it('an ordinary same-company request still sees its own logs — the fix does not over-filter', async () => {
    mockedPrisma.userCompany.findMany.mockResolvedValue([{ userId: 'member-a' }]);
    mockedLogger.fetchLogs.mockResolvedValue([
      { userId: 'member-a', message: 'mine', timestamp: new Date() },
    ]);

    const event = await firstValueFrom(
      controller.streamLogs('company-a', undefined, undefined, undefined, '5000'),
    );

    expect(event.data).toHaveLength(1);
  });
});
