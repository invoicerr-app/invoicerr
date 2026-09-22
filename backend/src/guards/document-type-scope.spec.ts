/**
 * What omitting `typeId` switches off on the per-document routes, proven by running the REAL
 * `AuthGuard` against the REAL `DocumentsController` methods — never by asserting that a decorator is
 * present, which would only prove somebody typed it.
 *
 * `GET /documents/:id?typeId=quote`, called with a key granted only `invoices:read`, is refused —
 * that part always worked. Drop the query param and the very same call used to succeed, because TWO
 * controls read that one word and both go quiet when it is missing:
 *
 *  - `AuthGuard` falls through to its coarse "holds ANY document scope for this mode" branch, which
 *    exists for the aggregate routes (`GET /documents/dashboard` has no single type to name) and
 *    hands the `invoices:read` key a pass on a QUOTE;
 *  - the handler then forwards `typeId: undefined` into
 *    `modules/documents/persistence.ts#findOwnedDocument`, and Prisma removes an `undefined` filter
 *    from the WHERE clause outright, leaving `companyId` as the only predicate — so the row comes
 *    back whatever its type.
 *
 * Nothing upstream stopped it: `@ApiQuery({ required: true })` is Swagger metadata a caller never
 * passes through, and `app.module.ts` registers no global `APP_PIPE`. The same omission opened
 * `:id/archives`, `:id/authority-events` and `:id/share-links`, each asserted below.
 *
 * The refusal proven here is the guard's, on the request itself, which is why it covers the human
 * half too: a session carries no scopes at all (`request.scopes` is `null`), so on that path the
 * missing SQL predicate was the whole story and nothing else would have stopped `GET /documents/:id`
 * from answering about a type it was never asked about.
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

import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthGuard } from '@/guards/auth.guard';
import { auth } from '@/lib/auth';
import { DocumentsController } from '@/modules/documents/documents.controller';
import prisma from '@/prisma/prisma.service';
import { generateApiKey, hashApiKey } from '@/utils/api-key';

import { CompanyRole } from '../../prisma/generated/prisma/client';

/** The four routes the reproduction reached with no `typeId` at all — every one of them names a
 *  single document and then reads something attached to it. */
const PER_DOCUMENT_READS = [
  { name: 'GET /documents/:id', handler: DocumentsController.prototype.getDocument },
  { name: 'GET /documents/:id/archives', handler: DocumentsController.prototype.listDocumentArchives },
  {
    name: 'GET /documents/:id/authority-events',
    handler: DocumentsController.prototype.listAuthorityEvents,
  },
  { name: 'GET /documents/:id/share-links', handler: DocumentsController.prototype.listShareLinks },
] as const;

describe('AuthGuard — a per-document route must be told which document type it is about', () => {
  let companyId: string;
  let userId: string;

  async function createApiKey(scopes: string[]) {
    const rawKey = generateApiKey();
    await prisma.apiKey.create({
      data: {
        name: 'Document type scope key',
        keyPrefix: rawKey.slice(0, 12),
        keyHash: hashApiKey(rawKey),
        userId,
        companyId,
        scopes,
      },
    });
    return rawKey;
  }

  function runGuard(handler: unknown, request: Record<string, unknown>): Promise<boolean> {
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => DocumentsController,
    } as unknown as ExecutionContext;
    return new AuthGuard(new Reflector()).canActivate(context);
  }

  /** A request shaped like Express hands one to a guard: the `:id` path param is there, the query is
   *  whatever the caller put in the URL — which is the whole point, since `typeId` lives there. */
  function requestWithKey(rawKey: string, query: Record<string, unknown> = {}) {
    return { headers: { 'x-api-key': rawKey }, params: { id: 'doc-1' }, query, body: {} };
  }

  function sessionRequest(query: Record<string, unknown> = {}) {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: userId },
      session: { id: 'session-document-type-scope' },
      companies: [{ id: companyId, name: 'Document Type Scope Co', role: CompanyRole.ADMIN }],
      activeCompanyId: companyId,
      activeRole: CompanyRole.ADMIN,
    } as never);
    return { headers: {}, params: { id: 'doc-1' }, query, body: {} };
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const company = await prisma.company.create({
      data: {
        name: 'Document Type Scope Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `document-type-scope-co-${suffix}@example.com`,
      },
    });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        id: `document-type-scope-user-${suffix}`,
        firstname: 'Dana',
        lastname: 'Docs',
        email: `document-type-scope-${suffix}@example.com`,
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

  // The reproduction itself, on all four routes: the key may read invoices and nothing else, and the
  // call names no type. Letting it through is what handed such a key every quote, credit note and
  // received invoice of the company — the scope check has no type to compare against, and the SQL has
  // no type predicate left either.
  it.each(PER_DOCUMENT_READS)('refuses $name when the call names no type', async ({ handler }) => {
    const rawKey = await createApiKey(['invoices:read']);
    await expect(runGuard(handler, requestWithKey(rawKey))).rejects.toThrow(BadRequestException);
  });

  // `?typeId=` is the same omission wearing a URL that looks like it names something. Reading an empty
  // string as "this route is about no particular type" would reopen the whole thing.
  it('refuses a per-document route whose typeId is present but empty', async () => {
    const rawKey = await createApiKey(['invoices:read']);
    await expect(
      runGuard(DocumentsController.prototype.getDocument, requestWithKey(rawKey, { typeId: '' })),
    ).rejects.toThrow(BadRequestException);
  });

  // The human half. A session is never scope-restricted, so on this path the vanished SQL predicate
  // was the only thing that mattered: the route promises a 404 for a document of another type, and an
  // unnamed type turned that promise into a 200 on whatever the id pointed at.
  it('refuses a session on a per-document route when the call names no type', async () => {
    await expect(runGuard(DocumentsController.prototype.getDocument, sessionRequest())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lets a session through once it names the type', async () => {
    await expect(
      runGuard(DocumentsController.prototype.getDocument, sessionRequest({ typeId: 'quote' })),
    ).resolves.toBe(true);
  });

  // The per-type check itself, unchanged: naming the type is what makes it possible at all.
  it('still refuses an invoices:read key that names a quote, and admits one that names an invoice', async () => {
    const rawKey = await createApiKey(['invoices:read']);
    await expect(
      runGuard(DocumentsController.prototype.getDocument, requestWithKey(rawKey, { typeId: 'quote' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      runGuard(DocumentsController.prototype.getDocument, requestWithKey(rawKey, { typeId: 'invoice' })),
    ).resolves.toBe(true);
  });

  // A route that really does span every registered type has no type to be told about, and must keep
  // working on the coarse check — otherwise closing the hole above would have broken the dashboard.
  it('leaves an every-type route reachable with no typeId', async () => {
    const rawKey = await createApiKey(['invoices:read']);
    await expect(
      runGuard(DocumentsController.prototype.listDashboardWidgets, requestWithKey(rawKey)),
    ).resolves.toBe(true);
  });

  // A repeated query key arrives as an array, and `dto/list-documents.dto.ts#firstValue` is what the
  // list handler actually filters on — so the scope is resolved from that same first entry. Reading
  // the array as "no type named" would drop the list route onto the coarse check, which is exactly
  // the branch this whole file exists to keep off a call that does name a type.
  it('resolves the list route scope from the first typeId when the query key is repeated', async () => {
    const rawKey = await createApiKey(['invoices:read']);
    await expect(
      runGuard(DocumentsController.prototype.listDocuments, {
        headers: { 'x-api-key': rawKey },
        params: {},
        query: { typeId: ['quote', 'invoice'] },
        body: {},
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
