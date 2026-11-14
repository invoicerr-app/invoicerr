/**
 * A member left without a seat (an over-capacity company, `billing/seat-holders.ts`) must be able to
 * leave that company for another one they belong to, from the "not enough seats" screen, while still
 * reading nothing of the company they lost their seat on.
 *
 * Wires the REAL pieces together: `CompanyWriteGuard` with a real `Reflector` reading the real
 * `CompaniesController` decorators, the real `assertUserHasSeatOrThrow`, and the real
 * `CompaniesService#switchActiveCompany`. Only Prisma, the subscription store and the session cache are
 * stubbed, so the test runs without Postgres.
 */
import { vi, type Mock } from 'vitest';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import prisma from '@/prisma/prisma.service';
import { sessionCache } from '@/lib/session-cache';
import { BILLING_FLAG_NAME } from '@/modules/billing/billing-flag';
import { getOrCreateCompanySubscription } from '@/modules/billing/company-subscription.store';
import { CompanyWriteGuard } from '@/modules/billing/company-write.guard';
import { SEAT_REQUIRED_CODE } from '@/modules/billing/seat-gate';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: { findMany: vi.fn(), findUnique: vi.fn() },
    session: { update: vi.fn() },
  },
}));
vi.mock('@/modules/billing/company-subscription.store');
vi.mock('@/logger/logger.service', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/session-cache', () => ({ sessionCache: { invalidateUsers: vi.fn() } }));

const findMany = prisma.userCompany.findMany as Mock;
const findUnique = prisma.userCompany.findUnique as Mock;
const sessionUpdate = prisma.session.update as Mock;
const getOrCreate = getOrCreateCompanySubscription as Mock;

const BLOCKED_COMPANY = 'company-over-capacity';
const OTHER_COMPANY = 'company-other';
const BLOCKED_MEMBER = 'user-without-seat';
const SESSION_ID = 'session-1';

// One seat, two members: the owner holds it, the more recent member waits (`seat-holders.ts`).
const MEMBERS: Record<string, { userId: string; role: CompanyRole; createdAt: Date }[]> = {
  [BLOCKED_COMPANY]: [
    { userId: 'owner', role: CompanyRole.OWNER, createdAt: new Date('2026-01-01') },
    { userId: BLOCKED_MEMBER, role: CompanyRole.MEMBER, createdAt: new Date('2026-02-01') },
  ],
  [OTHER_COMPANY]: [{ userId: BLOCKED_MEMBER, role: CompanyRole.OWNER, createdAt: new Date('2026-03-01') }],
};

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

function contextFor(method: string, companyId: string, handlerName: keyof CompaniesController): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, companyId, user: { id: BLOCKED_MEMBER }, scopes: null }),
    }),
    getHandler: () => CompaniesController.prototype[handlerName],
    getClass: () => CompaniesController,
  } as unknown as ExecutionContext;
}

/** Every company id any stubbed Prisma call received, wherever it sits in the arguments. */
function companyIdsTouched(): string[] {
  const calls = [...findMany.mock.calls, ...findUnique.mock.calls, ...sessionUpdate.mock.calls];
  return JSON.stringify(calls).match(/company-[a-z-]+/g) ?? [];
}

describe('switching company as a member without a seat', () => {
  const guard = new CompanyWriteGuard(new Reflector());
  const service = new CompaniesService({} as never, {} as never, {} as never);

  beforeEach(() => {
    process.env[BILLING_FLAG_NAME] = 'true';
    getOrCreate.mockImplementation(async (companyId: string) => ({ status: 'ACTIVE', seats: 1, companyId }));
    findMany.mockImplementation(async ({ where }: { where: { companyId: string } }) => MEMBERS[where.companyId] ?? []);
    findUnique.mockImplementation(
      async ({ where }: { where: { userId_companyId: { userId: string; companyId: string } } }) =>
        MEMBERS[where.userId_companyId.companyId]?.find((m) => m.userId === where.userId_companyId.userId) ?? null,
    );
    sessionUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.resetAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  });

  it('lets the switch route through the guard on the company the member has no seat on', async () => {
    await expect(guard.canActivate(contextFor('POST', BLOCKED_COMPANY, 'switch'))).resolves.toBe(true);
  });

  it('moves the session to the other company without reading anything of the blocked one', async () => {
    findMany.mockClear();
    await expect(service.switchActiveCompany(BLOCKED_MEMBER, SESSION_ID, OTHER_COMPANY)).resolves.toEqual({
      success: true,
    });

    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data: { activeCompanyId: OTHER_COMPANY },
    });
    expect(sessionCache.invalidateUsers).toHaveBeenCalledWith([BLOCKED_MEMBER]);
    expect(findMany).not.toHaveBeenCalled();
    expect(companyIdsTouched()).not.toContain(BLOCKED_COMPANY);
  });

  it('still refuses the routes that read or change company data on the blocked company', async () => {
    const routes: [string, keyof CompaniesController][] = [
      ['GET', 'listMembers'],
      ['POST', 'exportData'],
      ['PATCH', 'changeMemberRole'],
      ['DELETE', 'removeMember'],
    ];
    for (const [method, handler] of routes) {
      const err = await guard.canActivate(contextFor(method, BLOCKED_COMPANY, handler)).catch((e) => e);
      expect(err, `${method} ${handler}`).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: SEAT_REQUIRED_CODE });
    }
  });

  it('never lets the member switch into a company they do not belong to', async () => {
    await expect(service.switchActiveCompany(BLOCKED_MEMBER, SESSION_ID, 'company-stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it('gives full access again once the session is on the company where the member is seated', async () => {
    await expect(guard.canActivate(contextFor('GET', OTHER_COMPANY, 'listMembers'))).resolves.toBe(true);
  });
});
