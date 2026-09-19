/**
 * Two things, neither covered by `auth.guard.spec.ts` (which proves the MECHANISM against synthetic
 * handlers): that the mechanism is actually WIRED onto the REST controllers `@RequiresScope`/
 * `@RequiresDocumentTypeScope` were rolled out to, and that a scope-restricted key really does get
 * refused on a write and let through on a read for a REAL route.
 *
 * Part 1 (metadata tripwire, no DB): pins the exact scope/mode `SetMetadata` attached to a
 * representative method on every annotated controller. Catches an annotation silently lost in a
 * future refactor.
 *
 * Part 2 (real `AuthGuard`, real Prisma, `@/lib/auth` mocked exactly like `auth.guard.spec.ts`):
 * a `clients:read`-only key against the REAL `ClientsController.getClients`/`postClientsInfo`
 * methods, and a `quotes:read`-only key against the REAL `DocumentsController.getDocument`/
 * `runAction` methods (the dynamic, per-typeId path) — 200-equivalent (`canActivate` resolves) on
 * the read, 403 on the write, and — for documents — 403 even on a READ of a DIFFERENT type
 * (`invoice`) the key was never granted.
 */

import { vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

vi.mock('better-auth/node', () => ({
  fromNodeHeaders: vi.fn((headers: unknown) => headers),
}));

import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthGuard } from './auth.guard';
import { CompanyRole } from '../../prisma/generated/prisma/client';
import { generateApiKey, hashApiKey } from '@/utils/api-key';
import { REQUIRES_DOCUMENT_TYPE_SCOPE_KEY, REQUIRES_SCOPE_KEY } from '@/utils/scope-check';
import prisma from '@/prisma/prisma.service';

import { ClientsController } from '@/modules/clients/clients.controller';
import { ArticlesController } from '@/modules/articles/articles.controller';
import { CompanyController } from '@/modules/company/company.controller';
import { CompaniesController } from '@/modules/companies/companies.controller';
import { ApiKeysController } from '@/modules/api-keys/api-keys.controller';
import { WebhooksController } from '@/modules/webhooks/webhooks.controller';
import { BillingController } from '@/modules/billing/billing.controller';
import { SeatsController } from '@/modules/billing/seats.controller';
import { DocumentsController } from '@/modules/documents/documents.controller';

describe('@RequiresScope / @RequiresDocumentTypeScope — wired onto the REST controllers', () => {
  const cases: Array<{
    name: string;
    Controller: { prototype: object };
    method: string;
    key: string;
    expected: unknown;
  }> = [
    {
      name: 'ClientsController',
      Controller: ClientsController,
      method: 'getClients',
      key: REQUIRES_SCOPE_KEY,
      expected: ['clients:read'],
    },
    {
      name: 'ClientsController',
      Controller: ClientsController,
      method: 'postClientsInfo',
      key: REQUIRES_SCOPE_KEY,
      expected: ['clients:write'],
    },
    {
      name: 'ClientsController',
      Controller: ClientsController,
      method: 'deleteClient',
      key: REQUIRES_SCOPE_KEY,
      expected: ['clients:write'],
    },
    {
      name: 'ArticlesController',
      Controller: ArticlesController,
      method: 'findAll',
      key: REQUIRES_SCOPE_KEY,
      expected: ['articles:read'],
    },
    {
      name: 'ArticlesController',
      Controller: ArticlesController,
      method: 'create',
      key: REQUIRES_SCOPE_KEY,
      expected: ['articles:write'],
    },
    {
      name: 'CompanyController',
      Controller: CompanyController,
      method: 'getCompanyInfo',
      key: REQUIRES_SCOPE_KEY,
      expected: ['company:read'],
    },
    {
      name: 'CompanyController',
      Controller: CompanyController,
      method: 'postCompanyInfo',
      key: REQUIRES_SCOPE_KEY,
      expected: ['company:write'],
    },
    {
      name: 'CompaniesController',
      Controller: CompaniesController,
      method: 'listMembers',
      key: REQUIRES_SCOPE_KEY,
      expected: ['company:read'],
    },
    {
      name: 'CompaniesController',
      Controller: CompaniesController,
      method: 'removeMember',
      key: REQUIRES_SCOPE_KEY,
      expected: ['company:write'],
    },
    {
      name: 'ApiKeysController',
      Controller: ApiKeysController,
      method: 'list',
      key: REQUIRES_SCOPE_KEY,
      expected: ['api-keys:read'],
    },
    {
      name: 'ApiKeysController',
      Controller: ApiKeysController,
      method: 'create',
      key: REQUIRES_SCOPE_KEY,
      expected: ['api-keys:write'],
    },
    {
      name: 'WebhooksController',
      Controller: WebhooksController,
      method: 'list',
      key: REQUIRES_SCOPE_KEY,
      expected: ['webhooks:read'],
    },
    {
      name: 'WebhooksController',
      Controller: WebhooksController,
      method: 'create',
      key: REQUIRES_SCOPE_KEY,
      expected: ['webhooks:write'],
    },
    {
      name: 'BillingController',
      Controller: BillingController,
      method: 'getStatus',
      key: REQUIRES_SCOPE_KEY,
      expected: ['billing:read'],
    },
    {
      name: 'BillingController',
      Controller: BillingController,
      method: 'startCheckout',
      key: REQUIRES_SCOPE_KEY,
      expected: ['billing:write'],
    },
    {
      name: 'SeatsController',
      Controller: SeatsController,
      method: 'getSeats',
      key: REQUIRES_SCOPE_KEY,
      expected: ['billing:read'],
    },
    {
      name: 'SeatsController',
      Controller: SeatsController,
      method: 'moveSeat',
      key: REQUIRES_SCOPE_KEY,
      expected: ['billing:write'],
    },
    {
      name: 'DocumentsController',
      Controller: DocumentsController,
      method: 'listDocuments',
      key: REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
      expected: 'read',
    },
    {
      name: 'DocumentsController',
      Controller: DocumentsController,
      method: 'getDocument',
      key: REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
      expected: 'read',
    },
    {
      name: 'DocumentsController',
      Controller: DocumentsController,
      method: 'runAction',
      key: REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
      expected: 'write',
    },
    {
      name: 'DocumentsController',
      Controller: DocumentsController,
      method: 'createSchedule',
      key: REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
      expected: 'write',
    },
  ];

  it.each(cases)('$name#$method carries the expected scope metadata', ({
    Controller,
    method,
    key,
    expected,
  }) => {
    const handler = (Controller.prototype as unknown as Record<string, object>)[method];
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(key, handler)).toEqual(expected);
  });
});

describe('@RequiresScope / @RequiresDocumentTypeScope — real refusal on a real route', () => {
  let userId: string;
  let companyId: string;

  async function createApiKey(scopes: string[]) {
    const rawKey = generateApiKey();
    await prisma.apiKey.create({
      data: {
        name: 'Scoped key',
        keyPrefix: rawKey.slice(0, 12),
        keyHash: hashApiKey(rawKey),
        userId,
        companyId,
        scopes,
      },
    });
    return rawKey;
  }

  function requestWithKey(rawKey: string, extra: Record<string, unknown> = {}) {
    return { headers: { 'x-api-key': rawKey }, params: {}, query: {}, body: {}, ...extra };
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: `requires-scope-user-${Date.now()}-${Math.random()}`,
        firstname: 'Scope',
        lastname: 'Test',
        email: `requires-scope-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: 'Requires Scope Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `requires-scope-co-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    companyId = company.id;

    await prisma.userCompany.create({ data: { userId, companyId, role: CompanyRole.ADMIN } });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.userCompany.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it('a clients:read-only key reads clients but is refused writing one', async () => {
    const rawKey = await createApiKey(['clients:read']);
    const reflector = new Reflector();
    const guard = new AuthGuard(reflector);

    const readRequest = requestWithKey(rawKey);
    const readContext = {
      switchToHttp: () => ({ getRequest: () => readRequest }),
      getHandler: () => ClientsController.prototype.getClients,
      getClass: () => ClientsController,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(readContext)).resolves.toBe(true);

    const writeRequest = requestWithKey(rawKey);
    const writeContext = {
      switchToHttp: () => ({ getRequest: () => writeRequest }),
      getHandler: () => ClientsController.prototype.postClientsInfo,
      getClass: () => ClientsController,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(writeContext)).rejects.toThrow(ForbiddenException);
  });

  it('a quotes:read-only key reads a quote, is refused writing one, and is refused reading an invoice', async () => {
    const rawKey = await createApiKey(['quotes:read']);
    const reflector = new Reflector();
    const guard = new AuthGuard(reflector);

    const readQuote = requestWithKey(rawKey, { query: { typeId: 'quote' } });
    const readQuoteContext = {
      switchToHttp: () => ({ getRequest: () => readQuote }),
      getHandler: () => DocumentsController.prototype.getDocument,
      getClass: () => DocumentsController,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(readQuoteContext)).resolves.toBe(true);

    const writeQuote = requestWithKey(rawKey, { params: { typeId: 'quote', actionId: 'save-draft' } });
    const writeQuoteContext = {
      switchToHttp: () => ({ getRequest: () => writeQuote }),
      getHandler: () => DocumentsController.prototype.runAction,
      getClass: () => DocumentsController,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(writeQuoteContext)).rejects.toThrow(ForbiddenException);

    const readInvoice = requestWithKey(rawKey, { query: { typeId: 'invoice' } });
    const readInvoiceContext = {
      switchToHttp: () => ({ getRequest: () => readInvoice }),
      getHandler: () => DocumentsController.prototype.getDocument,
      getClass: () => DocumentsController,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(readInvoiceContext)).rejects.toThrow(ForbiddenException);
  });
});
