/**
 * Authorization on the two payment-methods routes, proven by running the REAL global guards
 * (`AuthGuard`, then `RolesGuard`) against the REAL controller methods — never by asserting that a
 * decorator is present, which would only prove somebody typed it.
 *
 * What an ungated `PATCH /payment-methods/:methodId` hands a caller: `bank_transfer`'s own config
 * fields ARE `Company.iban`/`Company.bic` (persistence.ts#loadBankTransferConfig bridges them), and
 * `paypal`'s `email` is the `business=` payee of the PayPal link (paypal.descriptor.ts). Both are
 * printed on every invoice PDF the customer receives and pays. So whoever reaches this route
 * re-points the company's incoming money at an account of their choosing, silently — without ever
 * calling `POST /company/info`, which writes those exact same two columns behind
 * `@Roles(OWNER, ADMIN)` + `@RequiresScope('company:write')`. Both doors, same room: they get the
 * same lock.
 *
 * `@/lib/auth`'s `getSession` is mocked exactly as `guards/auth.guard.spec.ts` documents — it
 * resolves `null` so the API-KEY branch runs, and is overridden for the one test that needs a human
 * session. `better-auth/node` is mocked for the same ESM reason that file gives.
 */
import { vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

vi.mock('better-auth/node', () => ({
  fromNodeHeaders: vi.fn((headers: unknown) => headers),
}));

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthGuard } from '@/guards/auth.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { auth } from '@/lib/auth';
import prisma from '@/prisma/prisma.service';
import { generateApiKey, hashApiKey } from '@/utils/api-key';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { PaymentMethodsController } from './payment-methods.controller';

type Handler = PaymentMethodsController['list'] | PaymentMethodsController['update'];

describe('PaymentMethodsController — authorization', () => {
  let companyId: string;
  let adminUserId: string;
  let memberUserId: string;

  async function createApiKey(userId: string, scopes: string[]) {
    const rawKey = generateApiKey();
    await prisma.apiKey.create({
      data: {
        name: 'Payment methods authorization key',
        keyPrefix: rawKey.slice(0, 12),
        keyHash: hashApiKey(rawKey),
        userId,
        companyId,
        scopes,
      },
    });
    return rawKey;
  }

  /** Both global guards, in the order `app.module.ts` registers them, against the real handler's own
   *  metadata — `AuthGuard` first (it is what puts the caller's live role and scopes on the request),
   *  `RolesGuard` second (it reads that role). Running them as a pair is the point: the scope check
   *  and the role check refuse different callers, and a route needs both to hold. */
  async function runGuards(handler: Handler, request: Record<string, unknown>): Promise<boolean> {
    const reflector = new Reflector();
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => PaymentMethodsController,
    } as unknown as ExecutionContext;
    await new AuthGuard(reflector).canActivate(context);
    return new RolesGuard(reflector).canActivate(context);
  }

  function requestWithKey(rawKey: string) {
    return { headers: { 'x-api-key': rawKey }, params: { methodId: 'bank_transfer' }, query: {}, body: {} };
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const company = await prisma.company.create({
      data: {
        name: 'Payment Methods Authorization Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `payment-methods-authz-co-${suffix}@example.com`,
      },
    });
    companyId = company.id;

    const admin = await prisma.user.create({
      data: {
        id: `payment-methods-authz-admin-${suffix}`,
        firstname: 'Ada',
        lastname: 'Admin',
        email: `payment-methods-authz-admin-${suffix}@example.com`,
      },
    });
    adminUserId = admin.id;
    await prisma.userCompany.create({
      data: { userId: adminUserId, companyId, role: CompanyRole.ADMIN },
    });

    const member = await prisma.user.create({
      data: {
        id: `payment-methods-authz-member-${suffix}`,
        firstname: 'Max',
        lastname: 'Member',
        email: `payment-methods-authz-member-${suffix}@example.com`,
      },
    });
    memberUserId = member.id;
    await prisma.userCompany.create({
      data: { userId: memberUserId, companyId, role: CompanyRole.MEMBER },
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { companyId } }).catch(() => undefined);
    await prisma.userCompany.deleteMany({ where: { companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: [adminUserId, memberUserId] } } })
      .catch(() => undefined);
  });

  // The exact key the finding was reproduced with: a read-only key for a DIFFERENT resource, held by
  // the most privileged role in the company. If the route consulted no scope at all, the ADMIN behind
  // the key would carry it straight through — which is why the holder here is an ADMIN and not a
  // MEMBER: this asserts the SCOPE refusal on its own, with the role check unable to mask it.
  it('refuses an articles:read-only key on the config write, even held by an ADMIN', async () => {
    const rawKey = await createApiKey(adminUserId, ['articles:read']);
    await expect(
      runGuards(PaymentMethodsController.prototype.update, requestWithKey(rawKey)),
    ).rejects.toThrow(ForbiddenException);
  });

  // Mirror image: the right scope, the wrong role. An API key is minted by a person and never
  // outranks them, so a MEMBER's key must be refused here exactly like the MEMBER themselves.
  it('refuses a company:write key held by a MEMBER on the config write', async () => {
    const rawKey = await createApiKey(memberUserId, ['company:write']);
    await expect(
      runGuards(PaymentMethodsController.prototype.update, requestWithKey(rawKey)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets a company:write key held by an ADMIN through on the config write', async () => {
    const rawKey = await createApiKey(adminUserId, ['company:write']);
    await expect(runGuards(PaymentMethodsController.prototype.update, requestWithKey(rawKey))).resolves.toBe(
      true,
    );
  });

  // The human half of the same route. A session carries no scopes at all (`request.scopes` is null,
  // which `hasAnyScope` treats as satisfied), so `@Roles` is the ONLY thing standing between a plain
  // MEMBER — including one an employer's IdP provisioned automatically — and the company's IBAN.
  it('refuses a MEMBER session on the config write', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: memberUserId },
      session: { id: 'session-member' },
      companies: [{ id: companyId, name: 'Payment Methods Authorization Co', role: CompanyRole.MEMBER }],
      activeCompanyId: companyId,
      activeRole: CompanyRole.MEMBER,
    } as never);

    await expect(
      runGuards(PaymentMethodsController.prototype.update, {
        headers: {},
        params: { methodId: 'bank_transfer' },
        query: {},
        body: {},
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // The read is not harmless either: it hands back the stored IBAN/BIC and the PayPal payee address
  // in full. It stays open to any ROLE (the document screens resolve a payment's label through it),
  // but a key minted for another resource has no business reading the company's bank details.
  it('refuses an articles:read-only key on the list, and lets a company:read key through', async () => {
    const foreignKey = await createApiKey(memberUserId, ['articles:read']);
    await expect(
      runGuards(PaymentMethodsController.prototype.list, requestWithKey(foreignKey)),
    ).rejects.toThrow(ForbiddenException);

    const readKey = await createApiKey(memberUserId, ['company:read']);
    await expect(runGuards(PaymentMethodsController.prototype.list, requestWithKey(readKey))).resolves.toBe(
      true,
    );
  });
});
