/**
 * Authorization on the custom-field routes, proven by running the REAL global guards (`AuthGuard`,
 * then `RolesGuard`) against the REAL controller methods — never by asserting that a decorator is
 * present, which would only prove somebody typed it.
 *
 * What an ungated write hands a caller: a custom field DEFINITION is not one person's note on one
 * record, it is a rule the whole company then lives under. `POST /custom-fields` with
 * `required: true` makes every colleague's next action fail validation until they fill in a field
 * they never asked for — `documents.service.ts#runAction` checks EVERY action against the current
 * definitions, "send" included, so this catches documents already in flight. `DELETE /custom-fields/
 * :id` takes a field other people are actively filling off the create/edit form. `PATCH` rewrites the
 * label that `rendering/render-instance-pdf.ts` prints on documents ALREADY issued, since the PDF
 * re-resolves definitions at render time.
 *
 * Without a role gate a plain MEMBER did all three through a single call, while the screen that
 * offers them is an admin-only settings tab — and without a scope gate any API key at all did too,
 * whatever narrow purpose it was minted for. The reads stay open to every role (the document form
 * and the client form cannot render without them), so each one is asserted open here as well: a
 * refusal nobody wanted would break every create screen in the product.
 *
 * `@/lib/auth`'s `getSession` is mocked exactly as `guards/auth.guard.spec.ts` documents — it
 * resolves `null` so the API-KEY branch runs, and is overridden for the tests that need a human
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
import { CompanyCustomFieldsController } from './company-custom-fields.controller';

/** The four writes the admin-only settings tab offers — create, edit, archive, un-archive. Every one
 *  of them changes what the OTHER members of the company must fill in, or see printed. */
const WRITES = [
  { name: 'POST /custom-fields', handler: CompanyCustomFieldsController.prototype.create },
  { name: 'PATCH /custom-fields/:id', handler: CompanyCustomFieldsController.prototype.update },
  { name: 'DELETE /custom-fields/:id', handler: CompanyCustomFieldsController.prototype.archive },
  { name: 'POST /custom-fields/:id/restore', handler: CompanyCustomFieldsController.prototype.restore },
] as const;

describe('CompanyCustomFieldsController — authorization', () => {
  let companyId: string;
  let adminUserId: string;
  let memberUserId: string;

  async function createApiKey(userId: string, scopes: string[]) {
    const rawKey = generateApiKey();
    await prisma.apiKey.create({
      data: {
        name: 'Custom fields authorization key',
        keyPrefix: rawKey.slice(0, 12),
        keyHash: hashApiKey(rawKey),
        userId,
        companyId,
        scopes,
      },
    });
    return rawKey;
  }

  /** Both global guards, in the order `app.module.ts` registers them: `AuthGuard` first (it is what
   *  puts the caller's live role and scopes on the request), `RolesGuard` second (it reads that
   *  role). Running them as a pair is the point — the scope check and the role check refuse
   *  different callers, and a route needs both to hold. */
  async function runGuards(handler: unknown, request: Record<string, unknown>): Promise<boolean> {
    const reflector = new Reflector();
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => CompanyCustomFieldsController,
    } as unknown as ExecutionContext;
    await new AuthGuard(reflector).canActivate(context);
    return new RolesGuard(reflector).canActivate(context);
  }

  function requestWithKey(rawKey: string) {
    return { headers: { 'x-api-key': rawKey }, params: { id: 'field-1' }, query: {}, body: {} };
  }

  function sessionRequest(userId: string, role: CompanyRole) {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: userId },
      session: { id: `session-${role}` },
      companies: [{ id: companyId, name: 'Custom Fields Authorization Co', role }],
      activeCompanyId: companyId,
      activeRole: role,
    } as never);
    return { headers: {}, params: { id: 'field-1' }, query: {}, body: {} };
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const company = await prisma.company.create({
      data: {
        name: 'Custom Fields Authorization Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `custom-fields-authz-co-${suffix}@example.com`,
      },
    });
    companyId = company.id;

    const admin = await prisma.user.create({
      data: {
        id: `custom-fields-authz-admin-${suffix}`,
        firstname: 'Ada',
        lastname: 'Admin',
        email: `custom-fields-authz-admin-${suffix}@example.com`,
      },
    });
    adminUserId = admin.id;
    await prisma.userCompany.create({
      data: { userId: adminUserId, companyId, role: CompanyRole.ADMIN },
    });

    const member = await prisma.user.create({
      data: {
        id: `custom-fields-authz-member-${suffix}`,
        firstname: 'Max',
        lastname: 'Member',
        email: `custom-fields-authz-member-${suffix}@example.com`,
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

  // The reproduction: the tab is admin-only on screen, so a MEMBER never sees these actions — and
  // called the route directly, they all went through. A session carries no scopes at all, which makes
  // `@Roles` the only thing standing between a plain member and a mandatory field imposed on everyone.
  it.each(WRITES)('refuses a MEMBER session on $name', async ({ handler }) => {
    await expect(runGuards(handler, sessionRequest(memberUserId, CompanyRole.MEMBER))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each(WRITES)('lets an ADMIN session through on $name', async ({ handler }) => {
    await expect(runGuards(handler, sessionRequest(adminUserId, CompanyRole.ADMIN))).resolves.toBe(true);
  });

  // A read-only key for a DIFFERENT resource, held by the most privileged role in the company. If the
  // route consulted no scope at all, the ADMIN behind the key would carry it straight through — which
  // is why the holder here is an ADMIN and not a MEMBER: this asserts the SCOPE refusal on its own,
  // with the role check unable to mask it.
  it('refuses an articles:read-only key on the create, even held by an ADMIN', async () => {
    const rawKey = await createApiKey(adminUserId, ['articles:read']);
    await expect(
      runGuards(CompanyCustomFieldsController.prototype.create, requestWithKey(rawKey)),
    ).rejects.toThrow(ForbiddenException);
  });

  // Mirror image: the right scope, the wrong role. An API key is minted by a person and never
  // outranks them, so a MEMBER's key must be refused here exactly like the MEMBER themselves.
  it('refuses a company:write key held by a MEMBER on the create', async () => {
    const rawKey = await createApiKey(memberUserId, ['company:write']);
    await expect(
      runGuards(CompanyCustomFieldsController.prototype.create, requestWithKey(rawKey)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets a company:write key held by an ADMIN through on the create', async () => {
    const rawKey = await createApiKey(adminUserId, ['company:write']);
    await expect(
      runGuards(CompanyCustomFieldsController.prototype.create, requestWithKey(rawKey)),
    ).resolves.toBe(true);
  });

  // The reads are the other half of the decision: every role keeps them, because the document form
  // and the client form resolve their field descriptors here and would otherwise render incomplete.
  it.each([
    { name: 'GET /custom-fields', handler: CompanyCustomFieldsController.prototype.list },
    { name: 'GET /custom-fields/resolved', handler: CompanyCustomFieldsController.prototype.resolved },
  ])('lets a MEMBER session read $name', async ({ handler }) => {
    await expect(runGuards(handler, sessionRequest(memberUserId, CompanyRole.MEMBER))).resolves.toBe(true);
  });

  // Open to every role is not open to every key: a key minted for one narrow resource has no business
  // being handed this company's whole form shape along with it.
  it('refuses an articles:read-only key on the list, and lets a company:read key through', async () => {
    const foreignKey = await createApiKey(memberUserId, ['articles:read']);
    await expect(
      runGuards(CompanyCustomFieldsController.prototype.list, requestWithKey(foreignKey)),
    ).rejects.toThrow(ForbiddenException);

    const readKey = await createApiKey(memberUserId, ['company:read']);
    await expect(
      runGuards(CompanyCustomFieldsController.prototype.list, requestWithKey(readKey)),
    ).resolves.toBe(true);
  });
});
