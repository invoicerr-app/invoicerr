import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const sentChangeEmailLinks = vi.hoisted((): string[] => []);
vi.mock('@/modules/auth-extended/account-lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/auth-extended/account-lifecycle')>()),
  sendChangeEmailMail: async (_mailer: unknown, params: { url: string }) => {
    sentChangeEmailLinks.push(params.url);
  },
}));

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import Redis from 'ioredis';

import { AuthGuard } from '@/guards/auth.guard';
import { auth, sessionCookieName } from '@/lib/auth';
import { setUserLocale } from '@/modules/auth-extended/preferences';
import { deleteCompanyPermanently, deleteCompanyPermanentlyNow } from '@/modules/billing/deletion';
import { CompaniesService } from '@/modules/companies/companies.service';
import { CompanyService } from '@/modules/company/company.service';
import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { TransferService } from '@/modules/company/transfer/transfer.service';
import { retireDemoCompanies } from '@/modules/demo/seed-runtime/retire-companies';
import {
  InstanceResetService,
  RESET_INSTANCE_CONFIRMATION_WORD,
} from '@/modules/instance/instance-reset.service';
import { InvitationsService } from '@/modules/invitations/invitations.service';
import prisma from '@/prisma/prisma.service';
import { redisDescribe } from '@/test/redis-gate';

import { CompanyRole } from '../../prisma/generated/prisma/client';
import { createSessionCache, SessionCache, sessionCache } from './session-cache';

/**
 * Every write that changes what a cached session holds must be visible on the very next request, on
 * the replica that made the change and on any other. Real better-auth, real Postgres, real Redis.
 */
const describeWithRedis = redisDescribe('SESSION_CACHE_REDIS_TESTS');

vi.setConfig({ testTimeout: 30_000 });

const PASSWORD = 'Session-cache-spec-1!';
const quietMail = new Proxy({}, { get: () => async () => undefined });

interface Seen {
  email: string;
  userId: string;
  companyId: string | null;
  role: CompanyRole | null;
  companies: { id: string; name: string; role: CompanyRole }[];
  firstname: string;
  locale: string | null;
}

describeWithRedis('session cache invalidation', () => {
  const guard = new AuthGuard({ getAllAndOverride: () => undefined } as unknown as Reflector);
  const companies = new CompaniesService({} as never, {} as never, quietMail as never);
  let otherReplica: SessionCache;
  let cookieName: string;

  async function onReplicaA(cookie: string): Promise<Seen | 'unauthorized'> {
    const request: Record<string, unknown> = { headers: { cookie } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    try {
      await guard.canActivate(context);
    } catch (error) {
      if (error instanceof UnauthorizedException) return 'unauthorized';
      throw error;
    }
    const user = request.user as { id: string; email: string; firstname: string; locale: string | null };
    return {
      userId: user.id,
      email: user.email,
      companyId: request.companyId as string | null,
      role: request.role as CompanyRole | null,
      companies: request.companies as Seen['companies'],
      firstname: user.firstname,
      locale: user.locale,
    };
  }

  async function onReplicaB(cookie: string): Promise<Seen | 'unauthorized'> {
    const session = await otherReplica.read({ header: cookie, name: cookieName }, () =>
      auth.api.getSession({ headers: fromNodeHeaders({ cookie }) }),
    );
    if (!session) return 'unauthorized';
    const enriched = session as unknown as {
      user: { id: string; email: string; firstname: string; locale: string | null };
      activeCompanyId: string | null;
      activeRole: CompanyRole | null;
      companies: Seen['companies'];
    };
    return {
      userId: enriched.user.id,
      email: enriched.user.email,
      companyId: enriched.activeCompanyId,
      role: enriched.activeRole,
      companies: enriched.companies,
      firstname: enriched.user.firstname,
      locale: enriched.user.locale,
    };
  }

  /** Both replicas answer this cookie from memory once this returns. */
  async function primed(cookie: string): Promise<Seen> {
    await onReplicaA(cookie);
    await onReplicaB(cookie);
    const seen = await onReplicaA(cookie);
    await onReplicaB(cookie);
    if (seen === 'unauthorized') throw new Error('fixture session is not signed in');
    return seen;
  }

  async function createUser(label: string) {
    const id = `session-cache-${label}-${randomUUID()}`;
    const email = `${id}@example.test`;
    await prisma.user.create({ data: { id, email, firstname: 'Before', lastname: label } });
    const { password } = await auth.$context;
    await prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await password.hash(PASSWORD),
      },
    });
    return { id, email };
  }

  async function signIn(email: string): Promise<string> {
    const response = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
    const setCookie = response.headers.get('set-cookie') ?? '';
    const pair = setCookie.split(/,(?=\s*[^;,]+=)/).find((c) => c.trim().startsWith(`${cookieName}=`));
    if (!pair) throw new Error(`sign-in failed: ${response.status}`);
    return pair.split(';')[0].trim();
  }

  function tokenOf(cookie: string): string {
    const value = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    return value.slice(0, value.lastIndexOf('.'));
  }

  async function createCompany(name: string) {
    return prisma.company.create({
      data: {
        name,
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `${randomUUID()}@example.test`,
      },
    });
  }

  /** An owner of two companies and a member of the first, both signed in. */
  async function fixture() {
    const owner = await createUser('owner');
    const member = await createUser('member');
    const first = await createCompany(`First ${randomUUID()}`);
    const second = await createCompany(`Second ${randomUUID()}`);
    await prisma.userCompany.create({
      data: { userId: owner.id, companyId: first.id, role: CompanyRole.OWNER },
    });
    await prisma.userCompany.create({
      data: { userId: owner.id, companyId: second.id, role: CompanyRole.OWNER },
    });
    await prisma.userCompany.create({
      data: { userId: member.id, companyId: first.id, role: CompanyRole.MEMBER },
    });
    return {
      owner: { ...owner, cookie: await signIn(owner.email) },
      member: { ...member, cookie: await signIn(member.email) },
      first,
      second,
    };
  }

  async function expectOnBothReplicas(cookie: string, check: (seen: Seen | 'unauthorized') => void) {
    check(await onReplicaA(cookie));
    check(await onReplicaB(cookie));
  }

  beforeAll(async () => {
    cookieName = await sessionCookieName();
    otherReplica = createSessionCache({ ttlMs: 60_000, redis: () => new Redis(process.env.REDIS_URL!) });
    const probe = { header: `${cookieName}=probe.c2ln`, name: cookieName };
    const session = {
      user: { id: 'probe' },
      session: { token: 'probe', expiresAt: new Date(Date.now() + 60_000) },
    };
    for (const cache of [sessionCache, otherReplica]) {
      for (let attempt = 0; ; attempt++) {
        const load = vi.fn(async () => session);
        await cache.read(probe, load);
        await cache.read(probe, load);
        if (load.mock.calls.length === 1) break;
        if (attempt > 100) throw new Error('session cache never reached Redis');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  afterAll(async () => {
    await otherReplica.close();
    await sessionCache.close();
  });

  it('serves a repeated request from memory, which is what makes every test below meaningful', async () => {
    const { owner, second } = await fixture();
    const before = await primed(owner.cookie);

    await prisma.session.updateMany({ where: { userId: owner.id }, data: { activeCompanyId: second.id } });

    await expectOnBothReplicas(owner.cookie, (seen) => expect(seen).toEqual(before));
  });

  it('a company switch is seen by the next request', async () => {
    const { owner, second } = await fixture();
    await primed(owner.cookie);
    const session = await prisma.session.findUniqueOrThrow({ where: { token: tokenOf(owner.cookie) } });

    await companies.switchActiveCompany(owner.id, session.id, second.id);

    await expectOnBothReplicas(owner.cookie, (seen) => expect(seen).toMatchObject({ companyId: second.id }));
  });

  it('a sign-out is seen by the next request', async () => {
    const { owner } = await fixture();
    await primed(owner.cookie);

    await auth.api.signOut({ headers: fromNodeHeaders({ cookie: owner.cookie }) });

    await expectOnBothReplicas(owner.cookie, (seen) => expect(seen).toBe('unauthorized'));
  });

  it('a revoked session is refused on the next request', async () => {
    const { owner } = await fixture();
    const otherDevice = await signIn(owner.email);
    await primed(owner.cookie);

    await auth.api.revokeSession({
      headers: fromNodeHeaders({ cookie: otherDevice }),
      body: { token: tokenOf(owner.cookie) },
    });

    await expectOnBothReplicas(owner.cookie, (seen) => expect(seen).toBe('unauthorized'));
  });

  it('a password change that revokes other sessions is seen by the next request', async () => {
    const { owner } = await fixture();
    const otherDevice = await signIn(owner.email);
    await primed(owner.cookie);

    await auth.api.changePassword({
      headers: fromNodeHeaders({ cookie: otherDevice }),
      body: { currentPassword: PASSWORD, newPassword: 'Session-cache-spec-2!', revokeOtherSessions: true },
    });

    await expectOnBothReplicas(owner.cookie, (seen) => expect(seen).toBe('unauthorized'));
  });

  it('a removed membership is seen by the next request', async () => {
    const { member, first } = await fixture();
    await primed(member.cookie);

    await companies.removeMember(first.id, CompanyRole.OWNER, member.id);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ companyId: null, role: null, companies: [] }),
    );
  });

  it('leaving a company is seen by the next request', async () => {
    const { member, first } = await fixture();
    await primed(member.cookie);

    await companies.leaveCompany(first.id, member.id);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ companyId: null, companies: [] }),
    );
  });

  it('a role change is seen by the next request', async () => {
    const { member, first } = await fixture();
    await primed(member.cookie);

    await companies.changeMemberRole(first.id, member.id, CompanyRole.ADMIN);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ role: CompanyRole.ADMIN }),
    );
  });

  it('a deleted company is seen by the next request', async () => {
    const { member, first } = await fixture();
    await primed(member.cookie);

    await deleteCompanyPermanentlyNow(first.id, { subscriptions: { revoke: async () => ({}) } });

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ companyId: null, companies: [] }),
    );
  });

  it('a deleted user is refused on the next request', async () => {
    const { member } = await fixture();
    await primed(member.cookie);

    await auth.api.deleteUser({
      headers: fromNodeHeaders({ cookie: member.cookie }),
      body: { password: PASSWORD },
    });

    await expectOnBothReplicas(member.cookie, (seen) => expect(seen).toBe('unauthorized'));
  });

  it('a profile update is seen by the next request', async () => {
    const { member } = await fixture();
    await primed(member.cookie);

    await auth.api.updateUser({
      headers: fromNodeHeaders({ cookie: member.cookie }),
      body: { firstname: 'After' },
    });

    await expectOnBothReplicas(member.cookie, (seen) => expect(seen).toMatchObject({ firstname: 'After' }));
  });

  it('a language preference change is seen by the next request', async () => {
    const { member } = await fixture();
    await primed(member.cookie);

    await setUserLocale(member.id, 'fr');

    await expectOnBothReplicas(member.cookie, (seen) => expect(seen).toMatchObject({ locale: 'fr' }));
  });

  it('a company rename is seen by every member on the next request', async () => {
    const { member, first } = await fixture();
    await primed(member.cookie);
    const companyService = new CompanyService({ dispatch: async () => undefined } as never);

    await companyService.editCompanyInfo(first.id, { name: 'Renamed company' } as EditCompanyDto);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ companies: [{ id: first.id, name: 'Renamed company' }] }),
    );
  });

  it('an accepted invitation is seen by the next request', async () => {
    const { owner, member, second } = await fixture();
    await primed(member.cookie);
    const code = randomUUID();
    await prisma.invitationCode.create({
      data: { code, companyId: second.id, createdById: owner.id, role: CompanyRole.ADMIN },
    });

    await new InvitationsService(prisma as never).useInvitation(code, member.id);

    await expectOnBothReplicas(member.cookie, (seen) => {
      expect(seen).not.toBe('unauthorized');
      expect((seen as Seen).companies.map((company) => company.id)).toContain(second.id);
    });
  });

  it('an accepted ownership transfer is seen by both people on the next request', async () => {
    const { owner, member, first } = await fixture();
    await primed(owner.cookie);
    await primed(member.cookie);
    const transfer = await prisma.companyOwnershipTransfer.create({
      data: {
        companyId: first.id,
        fromUserId: owner.id,
        toUserId: member.id,
        toEmail: member.email,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await new TransferService(quietMail as never).acceptTransfer(transfer.id, member.id);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ role: CompanyRole.OWNER }),
    );
    await expectOnBothReplicas(owner.cookie, (seen) =>
      expect((seen as Seen).companies.find((company) => company.id === first.id)?.role).toBe(
        CompanyRole.ADMIN,
      ),
    );
  });

  it('a new company is seen by its creator on the next request', async () => {
    const { member } = await fixture();
    await primed(member.cookie);
    const companyService = new CompanyService({ dispatch: async () => undefined } as never);

    const created = await companyService.createCompany(member.id, {
      name: 'Created company',
      country: 'France',
      countryCode: 'FR',
    } as EditCompanyDto);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect((seen as Seen).companies.map((company) => company.id)).toContain(created.id),
    );
  });

  it('a deletion by the billing sweep is seen by the next request', async () => {
    const { member, first } = await fixture();
    const now = new Date();
    await prisma.companySubscription.create({
      data: {
        companyId: first.id,
        status: 'ZIPPED',
        trialStartedAt: new Date(now.getTime() - 60 * 86_400_000),
        trialEndsAt: new Date(now.getTime() - 46 * 86_400_000),
        deletionDueAt: new Date(now.getTime() - 86_400_000),
      },
    });
    await primed(member.cookie);

    expect(
      await deleteCompanyPermanently(first.id, now, { subscriptions: { revoke: async () => ({}) } }),
    ).toBe(true);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ companyId: null, companies: [] }),
    );
  });

  it('a demo reset replacing the demo companies is seen by the next request', async () => {
    const { member, first } = await fixture();
    await primed(member.cookie);

    await retireDemoCompanies(member.id, [first.id]);

    await expectOnBothReplicas(member.cookie, (seen) =>
      expect(seen).toMatchObject({ companyId: null, companies: [] }),
    );
  });

  it('a confirmed email change is seen by the next request', async () => {
    const { member } = await fixture();
    await primed(member.cookie);
    const newEmail = `changed-${randomUUID()}@example.test`;
    sentChangeEmailLinks.length = 0;

    await auth.api.changeEmail({ headers: fromNodeHeaders({ cookie: member.cookie }), body: { newEmail } });
    for (let step = 0; step < 2 && sentChangeEmailLinks.length > 0; step++) {
      const token = new URL(sentChangeEmailLinks.shift()!).searchParams.get('token')!;
      await auth.api.verifyEmail({ query: { token } });
    }

    await expectOnBothReplicas(member.cookie, (seen) => expect(seen).toMatchObject({ email: newEmail }));
  });

  it('a session expiry refresh leaves the cached sessions in place', async () => {
    const { owner, second } = await fixture();
    const before = await primed(owner.cookie);
    const token = tokenOf(owner.cookie);
    await prisma.session.update({
      where: { token },
      data: { activeCompanyId: second.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });

    await auth.api.getSession({ headers: fromNodeHeaders({ cookie: owner.cookie }) });

    const refreshed = await prisma.session.findUniqueOrThrow({ where: { token } });
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    await expectOnBothReplicas(owner.cookie, (seen) => expect(seen).toEqual(before));
  });

  // Last: an instance reset empties every table this spec relies on.
  it('an instance reset is seen by the next request', async () => {
    const { owner } = await fixture();
    await primed(owner.cookie);
    const sent: string[] = [];
    const reset = new InstanceResetService({
      sendMail: async ({ text }: { text: string }) => {
        sent.push(text);
      },
    } as never);
    const operator = { id: owner.id, email: owner.email, locale: null } as never;

    await reset.requestOtp(operator);
    const otp = /(\d{4})-?(\d{4})/.exec(sent[0])!.slice(1).join('');
    await reset.reset(operator, otp, RESET_INSTANCE_CONFIRMATION_WORD);

    await expectOnBothReplicas(owner.cookie, (seen) => expect(seen).toBe('unauthorized'));
  });
});
