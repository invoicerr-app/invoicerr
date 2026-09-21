/**
 * The time-tracking scope pair, proven the only way that means anything: by running the REAL
 * `AuthGuard` against the REAL controller methods, with a real key row, rather than asserting that
 * somebody typed a decorator.
 *
 * Three things are at stake, and each one is a decision that a later refactor could undo without any
 * other test noticing:
 *
 *  1. `time-tracking:*` must NOT be a document scope. `DOCUMENT_READ_SCOPES`/`DOCUMENT_WRITE_SCOPES`
 *     (`utils/scope-check.ts`) are `API_KEY_SCOPES` minus an exclusion list, so a pair declared in
 *     `api-keys/scopes.ts` and left out of that list joins them silently — and every scope in them
 *     satisfies the coarse "holds ANY document scope" fallback that `AuthGuard` applies to the
 *     document routes spanning every type (`GET /documents/dashboard` and its siblings). A key minted
 *     to log an hour would then read the company's quotes, invoices and credit notes. Asserted below
 *     against `listDashboardWidgets`, which is that fallback's own route.
 *  2. The pair is not folded onto `invoices:*`. A key that may write invoices cannot log time, and a
 *     key that may log time cannot write documents — asserted in both directions, because either
 *     inclusion would be a widening nobody asked for.
 *  3. `POST /time-entries/generate-invoice` names `invoices:write`, not `time-tracking:write`. It
 *     reads time entries AND creates an invoice; `@RequiresScope` is an any-of check and cannot
 *     demand both, so it is gated on the heavier consequence. A `time-tracking:write` key is refused
 *     there — that refusal IS the decision, and this is where it is written down in code.
 *
 * `@/lib/auth`'s `getSession` is mocked to resolve `null` so the API-KEY branch of the guard runs,
 * and `better-auth/node` for the same ESM reason `guards/auth.guard.spec.ts` gives.
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
import { DocumentsController } from '@/modules/documents/documents.controller';
import { ProjectsController } from '@/modules/time-tracking/projects.controller';
import { TimeEntriesController } from '@/modules/time-tracking/time-entries.controller';
import prisma from '@/prisma/prisma.service';
import { generateApiKey, hashApiKey } from '@/utils/api-key';

import { CompanyRole } from '../../prisma/generated/prisma/client';

describe('AuthGuard — the time-tracking scopes gate time tracking and nothing else', () => {
  let companyId: string;
  let userId: string;

  async function createApiKey(scopes: string[]) {
    const rawKey = generateApiKey();
    await prisma.apiKey.create({
      data: {
        name: 'Time tracking scope key',
        keyPrefix: rawKey.slice(0, 12),
        keyHash: hashApiKey(rawKey),
        userId,
        companyId,
        scopes,
      },
    });
    return rawKey;
  }

  function runGuard(
    Controller: unknown,
    handler: unknown,
    rawKey: string,
    request: Record<string, unknown> = {},
  ): Promise<boolean> {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-api-key': rawKey },
          params: {},
          query: {},
          body: {},
          ...request,
        }),
      }),
      getHandler: () => handler,
      getClass: () => Controller,
    } as unknown as ExecutionContext;
    return new AuthGuard(new Reflector()).canActivate(context);
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const company = await prisma.company.create({
      data: {
        name: 'Time Tracking Scope Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `time-tracking-scope-co-${suffix}@example.com`,
      },
    });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        id: `time-tracking-scope-user-${suffix}`,
        firstname: 'Tina',
        lastname: 'Timer',
        email: `time-tracking-scope-${suffix}@example.com`,
      },
    });
    userId = user.id;

    await prisma.userCompany.create({ data: { userId, companyId, role: CompanyRole.ADMIN } });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { companyId } }).catch(() => undefined);
    await prisma.userCompany.deleteMany({ where: { companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it('lets a time-tracking:read key read projects and time entries', async () => {
    const rawKey = await createApiKey(['time-tracking:read']);
    await expect(runGuard(ProjectsController, ProjectsController.prototype.findAll, rawKey)).resolves.toBe(
      true,
    );
    await expect(
      runGuard(TimeEntriesController, TimeEntriesController.prototype.findAll, rawKey),
    ).resolves.toBe(true);
  });

  it('refuses a time-tracking:read key on every time-tracking write', async () => {
    const rawKey = await createApiKey(['time-tracking:read']);
    await expect(runGuard(ProjectsController, ProjectsController.prototype.create, rawKey)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      runGuard(TimeEntriesController, TimeEntriesController.prototype.create, rawKey),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      runGuard(TimeEntriesController, TimeEntriesController.prototype.remove, rawKey, {
        params: { id: 'entry-1' },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // Point 1: the coarse fallback. `listDashboardWidgets` is an 'every-type' document route, so it is
  // granted by ANY document scope and by no other — which is precisely what a time-tracking scope
  // would become if it were ever left out of the entity exclusion list the derivation subtracts.
  it('refuses a time-tracking key on the document route granted by ANY document scope', async () => {
    const rawKey = await createApiKey(['time-tracking:read', 'time-tracking:write']);
    await expect(
      runGuard(DocumentsController, DocumentsController.prototype.listDashboardWidgets, rawKey),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a time-tracking key on a named document type', async () => {
    const rawKey = await createApiKey(['time-tracking:read', 'time-tracking:write']);
    await expect(
      runGuard(DocumentsController, DocumentsController.prototype.getDocument, rawKey, {
        params: { id: 'doc-1' },
        query: { typeId: 'invoice' },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // Point 2, the other direction: writing invoices is not permission to log or rewrite the hours the
  // invoice was built from.
  it('refuses an invoices:write key on the time-tracking writes', async () => {
    const rawKey = await createApiKey(['invoices:write']);
    await expect(
      runGuard(TimeEntriesController, TimeEntriesController.prototype.create, rawKey),
    ).rejects.toThrow(ForbiddenException);
    await expect(runGuard(ProjectsController, ProjectsController.prototype.create, rawKey)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // Point 3: the route that bills hours into a draft invoice is gated on the invoice write scope, so
  // the heaviest key in time tracking cannot reach it and a key already trusted with invoices can.
  it('gates generate-invoice on invoices:write, not on time-tracking:write', async () => {
    const timeKey = await createApiKey(['time-tracking:read', 'time-tracking:write']);
    await expect(
      runGuard(TimeEntriesController, TimeEntriesController.prototype.generateInvoice, timeKey),
    ).rejects.toThrow(ForbiddenException);

    const invoiceKey = await createApiKey(['invoices:write']);
    await expect(
      runGuard(TimeEntriesController, TimeEntriesController.prototype.generateInvoice, invoiceKey),
    ).resolves.toBe(true);
  });
});
