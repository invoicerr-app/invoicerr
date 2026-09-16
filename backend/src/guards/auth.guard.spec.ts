/**
 * `AuthGuard` constructed directly, real Prisma. `@/lib/auth`'s `getSession` is mocked to always
 * resolve `null` — every scenario here is about the API-KEY branch, so no real session cookie is ever
 * in play, and invoking the real better-auth stack would need a full session/account fixture for
 * nothing this file is testing.
 *
 * Covers two closes at once, because they are the SAME code change: an API key used to be resolved by
 * `keyHash` alone, with `request.role` hard-coded to `CompanyRole.ADMIN` — so (a) removing someone from
 * a company (`companies.service.ts#removeMember`, which only ever deletes the `UserCompany` row, never
 * their `ApiKey` rows) left their key working forever, and (b) a key's holder being demoted
 * ADMIN → MEMBER never demoted the key. Re-reading the live `UserCompany` membership on every request
 * closes both: no membership at all now refuses the request outright, and the role attached to the
 * request is always whatever that membership says TODAY.
 *
 * Also covers `@RequiresScope` (`utils/scope-check.ts`) enforcement — the second half of the same
 * `canActivate` branch: `hasScope()`/`hasAnyScope()` used to have exactly one real caller in the whole
 * backend (the MCP module), so no REST route ever consulted a key's own granted scopes.
 *
 * `better-auth/node` is ALSO mocked, same reasoning `sso-registrar.service.spec.ts` already documents
 * for `better-auth/plugins`: it ships ESM-only, and this project's Jest config does not transform
 * `node_modules` for it, so importing `auth.guard.ts` for real fails with "Cannot use import statement
 * outside a module" before a single test runs. The real `fromNodeHeaders` only reshapes a headers
 * object for `auth.api.getSession`, whose own mock above ignores its argument entirely — an identity
 * stub changes nothing this file tests.
 */
jest.mock('@/lib/auth', () => ({
  auth: { api: { getSession: jest.fn().mockResolvedValue(null) } },
}));

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn((headers: unknown) => headers),
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthGuard } from './auth.guard';
import { CompanyRole } from '../../prisma/generated/prisma/client';
import { generateApiKey, hashApiKey } from '@/utils/api-key';
import { REQUIRES_SCOPE_KEY } from '@/utils/scope-check';
import prisma from '@/prisma/prisma.service';

function createContext(request: unknown, requiredScopes?: string[]): ExecutionContext {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (key === REQUIRES_SCOPE_KEY ? requiredScopes : undefined)),
  } as unknown as Reflector;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return Object.assign(context, { __reflector: reflector });
}

function guardFor(context: ExecutionContext): AuthGuard {
  return new AuthGuard((context as unknown as { __reflector: Reflector }).__reflector);
}

describe('AuthGuard — API key branch', () => {
  let userId: string;
  let companyId: string;
  let otherCompanyId: string;

  async function createApiKey(scopes: string[] = []) {
    const rawKey = generateApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        name: 'Test key',
        keyPrefix: rawKey.slice(0, 12),
        keyHash: hashApiKey(rawKey),
        userId,
        companyId,
        scopes,
      },
    });
    return { rawKey, apiKey };
  }

  function requestWithKey(rawKey: string) {
    return { headers: { 'x-api-key': rawKey } };
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: `auth-guard-user-${Date.now()}-${Math.random()}`,
        firstname: 'Auth',
        lastname: 'Guard',
        email: `auth-guard-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: 'Auth Guard Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `auth-guard-co-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    companyId = company.id;

    const other = await prisma.company.create({
      data: {
        name: 'Auth Guard Other Co',
        foundedAt: new Date('2020-01-01'),
        address: '2 rue de Test',
        postalCode: '75001',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000001',
        email: `auth-guard-other-co-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    otherCompanyId = other.id;

    await prisma.userCompany.create({
      data: { userId, companyId, role: CompanyRole.ADMIN },
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.userCompany.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it('resolves an active membership to its REAL role, never a hard-coded ADMIN', async () => {
    const { rawKey } = await createApiKey();
    const request = requestWithKey(rawKey);
    const context = createContext(request);

    await expect(guardFor(context).canActivate(context)).resolves.toBe(true);
    expect((request as any).role).toBe(CompanyRole.ADMIN);
  });

  it('refuses a key whose holder was removed from the company — SEC-04', async () => {
    const { rawKey } = await createApiKey();
    await prisma.userCompany.delete({ where: { userId_companyId: { userId, companyId } } });
    try {
      const request = requestWithKey(rawKey);
      const context = createContext(request);
      await expect(guardFor(context).canActivate(context)).rejects.toThrow(UnauthorizedException);
    } finally {
      // Restore for the remaining tests in this file.
      await prisma.userCompany.create({ data: { userId, companyId, role: CompanyRole.ADMIN } });
    }
  });

  it("demotes a key's authority the instant its holder is demoted — SEC-04", async () => {
    const { rawKey } = await createApiKey();
    await prisma.userCompany.update({
      where: { userId_companyId: { userId, companyId } },
      data: { role: CompanyRole.MEMBER },
    });
    try {
      const request = requestWithKey(rawKey);
      const context = createContext(request);
      await expect(guardFor(context).canActivate(context)).resolves.toBe(true);
      expect((request as any).role).toBe(CompanyRole.MEMBER);
    } finally {
      await prisma.userCompany.update({
        where: { userId_companyId: { userId, companyId } },
        data: { role: CompanyRole.ADMIN },
      });
    }
  });

  it("a membership in a DIFFERENT company than the key's own never substitutes for it", async () => {
    // A key minted for `companyId` whose holder is ALSO a member of `otherCompanyId` must still be
    // refused if the membership for the key's OWN company is gone — proves the lookup is keyed on
    // (userId, companyId) together, not "is this user a member of ANYTHING".
    await prisma.userCompany.create({ data: { userId, companyId: otherCompanyId, role: CompanyRole.OWNER } });
    const { rawKey } = await createApiKey();
    await prisma.userCompany.delete({ where: { userId_companyId: { userId, companyId } } });
    try {
      const request = requestWithKey(rawKey);
      const context = createContext(request);
      await expect(guardFor(context).canActivate(context)).rejects.toThrow(UnauthorizedException);
    } finally {
      await prisma.userCompany.deleteMany({ where: { userId, companyId: otherCompanyId } });
      await prisma.userCompany.create({ data: { userId, companyId, role: CompanyRole.ADMIN } });
    }
  });

  it('rejects a request whose handler requires a scope the key was never granted — SEC-05', async () => {
    const { rawKey } = await createApiKey(['invoices:read']);
    const request = requestWithKey(rawKey);
    const context = createContext(request, ['invoices:write']);

    await expect(guardFor(context).canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows a request whose handler requires a scope the key DOES hold', async () => {
    const { rawKey } = await createApiKey(['invoices:read']);
    const request = requestWithKey(rawKey);
    const context = createContext(request, ['invoices:read']);

    await expect(guardFor(context).canActivate(context)).resolves.toBe(true);
  });

  it('a handler with no @RequiresScope at all is unaffected — the pre-existing behavior for every route not yet annotated', async () => {
    const { rawKey } = await createApiKey(['invoices:read']);
    const request = requestWithKey(rawKey);
    const context = createContext(request, undefined);

    await expect(guardFor(context).canActivate(context)).resolves.toBe(true);
  });
});
