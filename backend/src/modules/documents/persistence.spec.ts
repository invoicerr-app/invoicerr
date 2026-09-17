import { ConflictException, NotFoundException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  claimDocumentTransition,
  DOCUMENT_LIST_DATE_FILTER_READ_CAP,
  findOwnedDocument,
  listDocumentsPage,
  updateDocumentStatus,
  upsertDocument,
} from './persistence';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentInstance: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

// Explicit factory mock (not automock) — lets the cap test below assert `logger.warn` was actually
// called, the same "mock the singleton, assert on it" approach this module's own `logger.warn` call
// is meant to be caught by (see `conformity/pollers/chorus-pro-status-poller.spec.ts` for the same
// pattern on `logger.error`).
jest.mock('@/logger/logger.service', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const findFirst = prisma.documentInstance.findFirst as jest.Mock;
const findMany = prisma.documentInstance.findMany as jest.Mock;
const count = prisma.documentInstance.count as jest.Mock;
const update = prisma.documentInstance.update as jest.Mock;
const create = prisma.documentInstance.create as jest.Mock;
const updateMany = prisma.documentInstance.updateMany as jest.Mock;
const loggerWarn = logger.warn as jest.Mock;

describe('persistence — upsertDocument', () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
    create.mockReset();
  });

  it('creates a new instance when no documentId is given', async () => {
    create.mockResolvedValue({ id: 'exp-1', typeId: 'expense', status: 'draft', data: { amount: 10 } });

    await upsertDocument('company-1', 'expense', undefined, 'draft', { amount: 10 });

    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        typeId: 'expense',
        status: 'draft',
        data: { amount: 10 },
        lastActionError: null,
      },
    });
  });

  /**
   * Enriched expense categories ("notes de frais enrichies") — the exact mechanism "suppression" (the
   * frontend's file-field.tsx "Remove" button) relies on: `upsertDocument` REPLACES `data` wholesale
   * with whatever the caller hands it, never merges it onto what was there before. A previously saved
   * `attachment` key that the second save's own `data` argument simply does not carry is therefore
   * genuinely GONE from the persisted record — not left behind by an accidental merge. This is a real
   * regression guard: a future "helpful" change to merge old+new data here would silently defeat every
   * field's own "clear this value" UI (the file-field's Remove button, but also e.g. an emptied
   * optional text field), which is exactly the property this test pins down.
   */
  it('a second save WITHOUT a previously-set key drops it entirely — a full replace, never a merge', async () => {
    findFirst.mockResolvedValue({
      id: 'exp-1',
      companyId: 'company-1',
      typeId: 'expense',
      status: 'draft',
      data: {
        description: 'Taxi',
        amount: 42,
        attachment: { fileRef: 'abc', fileName: 'r.pdf', mime: 'application/pdf' },
      },
    });
    update.mockResolvedValue({
      id: 'exp-1',
      typeId: 'expense',
      status: 'draft',
      data: { description: 'Taxi', amount: 42 },
    });

    // The caller (the "save-draft" handler, replaying the WHOLE form's current values) submits data
    // with no `attachment` key at all — exactly what react-hook-form's `getValues()` produces once
    // the field's own value was cleared to `undefined` and JSON-stringified for the request body.
    const result = await upsertDocument('company-1', 'expense', 'exp-1', 'draft', {
      description: 'Taxi',
      amount: 42,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'exp-1' },
      data: { status: 'draft', data: { description: 'Taxi', amount: 42 }, lastActionError: null },
    });
    expect(result.data).not.toHaveProperty('attachment');
  });

  it('404s (via findOwnedDocument) rather than updating a document belonging to another company', async () => {
    findFirst.mockResolvedValue(null);

    await expect(upsertDocument('company-2', 'expense', 'exp-1', 'draft', { amount: 1 })).rejects.toThrow(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});

// THE MUTATION TARGET (generalized TOCTOU): before this, EVERY write in this file was a bare
// `update({ where: { id } })` — no `companyId`, no expected `status` — so two concurrent callers that
// both read the SAME stale status (documents.service.ts#runAction reads it once, several `await`s
// before a handler ever writes) could both pass whatever gate led here and both land their write. This
// proves `upsertDocument`/`updateDocumentStatus`'s own new `fromStatuses` parameter routes through the
// SAME `updateMany` compare-and-swap `claimDocumentTransition` already used, rather than a second,
// independently-written mechanism — the "sans dupliquer" this fix has to hold.
describe('persistence — upsertDocument/updateDocumentStatus, conditional on the CURRENT status', () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
    updateMany.mockReset();
  });

  it('upsertDocument WITHOUT fromStatuses is byte-for-byte the previous, unconditional write', async () => {
    findFirst.mockResolvedValue({ id: 'doc-1', companyId: 'company-1', typeId: 'invoice', status: 'draft' });
    update.mockResolvedValue({ id: 'doc-1', typeId: 'invoice', status: 'sending', data: {} });

    await upsertDocument('company-1', 'invoice', 'doc-1', 'sending', { total: 1 });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'sending', data: { total: 1 }, lastActionError: null },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('upsertDocument WITH fromStatuses succeeds via updateMany when the row is still in an expected status', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'doc-1', companyId: 'company-1', typeId: 'invoice', status: 'draft' }) // findOwnedDocument guard
      .mockResolvedValueOnce({ id: 'doc-1', companyId: 'company-1', typeId: 'invoice', status: 'sending' }); // re-fetch after the CAS
    updateMany.mockResolvedValue({ count: 1 });

    const result = await upsertDocument('company-1', 'invoice', 'doc-1', 'sending', { total: 1 }, [
      'draft',
      'send_failed',
    ]);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'doc-1',
        companyId: 'company-1',
        typeId: 'invoice',
        status: { in: ['draft', 'send_failed'] },
      },
      data: { status: 'sending', data: { total: 1 }, lastActionError: null },
    });
    expect(update).not.toHaveBeenCalled(); // never the unconditional path once fromStatuses is given
    expect(result.status).toBe('sending');
  });

  it('upsertDocument WITH fromStatuses refuses with a named 409, never a silent second write, once the row already moved on', async () => {
    findFirst.mockResolvedValue({ id: 'doc-1', companyId: 'company-1', typeId: 'invoice', status: 'draft' });
    updateMany.mockResolvedValue({ count: 0 }); // a concurrent caller already won the race

    await expect(
      upsertDocument('company-1', 'invoice', 'doc-1', 'sending', { total: 1 }, ['draft']),
    ).rejects.toThrow(ConflictException);
  });

  it('updateDocumentStatus WITHOUT fromStatuses is byte-for-byte the previous, unconditional write', async () => {
    findFirst.mockResolvedValue({
      id: 'doc-1',
      companyId: 'company-1',
      typeId: 'invoice',
      status: 'sending',
    });
    update.mockResolvedValue({ id: 'doc-1', typeId: 'invoice', status: 'sent' });

    await updateDocumentStatus('company-1', 'invoice', 'doc-1', 'sent');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'sent', lastActionError: null },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('updateDocumentStatus WITH fromStatuses succeeds via updateMany, carrying transportRef/channelProviderId through', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'doc-1', companyId: 'company-1', typeId: 'invoice', status: 'sending' })
      .mockResolvedValueOnce({ id: 'doc-1', companyId: 'company-1', typeId: 'invoice', status: 'sent' });
    updateMany.mockResolvedValue({ count: 1 });

    await updateDocumentStatus('company-1', 'invoice', 'doc-1', 'sent', null, 'ref-123', 'provider-x', [
      'sending',
    ]);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'doc-1', companyId: 'company-1', typeId: 'invoice', status: { in: ['sending'] } },
      data: {
        status: 'sent',
        lastActionError: null,
        transportRef: 'ref-123',
        channelProviderId: 'provider-x',
      },
    });
  });

  it('two "concurrent" updateDocumentStatus calls for the SAME record: only the first (matching updateMany) wins, the second gets a named 409', async () => {
    updateMany
      .mockResolvedValueOnce({ count: 1 }) // the winner
      .mockResolvedValueOnce({ count: 0 }); // the row already moved on by the time this one runs

    // Call #1: findOwnedDocument's own initial read, then the post-CAS re-fetch.
    findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      companyId: 'company-1',
      typeId: 'invoice',
      status: 'sending',
    });
    findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      companyId: 'company-1',
      typeId: 'invoice',
      status: 'sent',
    });
    const first = await updateDocumentStatus(
      'company-1',
      'invoice',
      'doc-1',
      'sent',
      undefined,
      undefined,
      undefined,
      ['sending'],
    );
    expect(first.status).toBe('sent');

    // Call #2 (the "loser"): findOwnedDocument's own initial read still sees "sending" (its own stale
    // snapshot), but the CAS itself (updateMany, mocked to return count 0 above) reports the row
    // already moved on — the exact race this fix closes.
    findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      companyId: 'company-1',
      typeId: 'invoice',
      status: 'sending',
    });
    await expect(
      updateDocumentStatus('company-1', 'invoice', 'doc-1', 'send_failed', 'boom', undefined, undefined, [
        'sending',
      ]),
    ).rejects.toThrow(ConflictException);
  });
});

describe('persistence — findOwnedDocument', () => {
  beforeEach(() => findFirst.mockReset());

  it('scopes the read by companyId AND typeId, not just id', async () => {
    findFirst.mockResolvedValue({ id: 'exp-1', companyId: 'company-1', typeId: 'expense', status: 'draft' });

    await findOwnedDocument('company-1', 'expense', 'exp-1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'exp-1', companyId: 'company-1', typeId: 'expense' },
    });
  });

  it('404s, named, rather than returning null or undefined', async () => {
    findFirst.mockResolvedValue(null);
    await expect(findOwnedDocument('company-1', 'expense', 'missing')).rejects.toThrow(NotFoundException);
  });
});

// THE MUTATION TARGET: a database-level claim that writes the SAME status value it started from
// (`actions/async-send.ts`'s own phase-2 re-claim of an already-"sending" row) provides NO exclusion
// on its own — Postgres re-evaluates a blocked UPDATE's WHERE clause against the row's post-commit
// values, and a `status` that never changed value still matches for a SECOND concurrent caller too.
// `knownUpdatedAt` is what turns this into a genuine compare-and-swap: these tests prove the WHERE
// clause actually carries it, and that the function reports whatever `count` Prisma hands back rather
// than inventing its own true/false.
describe('persistence — claimDocumentTransition', () => {
  beforeEach(() => updateMany.mockReset());

  it('includes id/companyId/typeId, the "from" statuses, AND the caller-supplied updatedAt in the WHERE clause', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const knownUpdatedAt = new Date('2026-09-17T00:00:00.000Z');

    await claimDocumentTransition('company-1', 'invoice', 'doc-1', ['sending'], knownUpdatedAt, 'sending');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'doc-1',
        companyId: 'company-1',
        typeId: 'invoice',
        status: { in: ['sending'] },
        updatedAt: knownUpdatedAt,
      },
      data: { status: 'sending' },
    });
  });

  it('returns 1 when exactly one row matched — the caller wins the claim', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      claimDocumentTransition('company-1', 'invoice', 'doc-1', ['sending'], new Date(), 'sending'),
    ).resolves.toBe(1);
  });

  // THE DOUBLE-CLICK SPEC (database level): two "concurrent" claims for the SAME document, modeled as
  // two calls against a mocked Prisma that mimics what a real Postgres row lock produces — the first
  // caller's write has already moved `updatedAt` forward by the time the second one's WHERE clause is
  // (re-)evaluated, so only the FIRST call's own `knownUpdatedAt` still matches.
  it('a second concurrent claim with a now-stale updatedAt sees count 0 — never throws, just reports the fact', async () => {
    const staleUpdatedAt = new Date('2026-09-17T00:00:00.000Z');
    updateMany
      .mockResolvedValueOnce({ count: 1 }) // the first caller: its WHERE still matched, it won.
      .mockResolvedValueOnce({ count: 0 }); // the second: the row's updatedAt already moved on.

    const first = await claimDocumentTransition(
      'company-1',
      'invoice',
      'doc-1',
      ['sending'],
      staleUpdatedAt,
      'sending',
    );
    const second = await claimDocumentTransition(
      'company-1',
      'invoice',
      'doc-1',
      ['sending'],
      staleUpdatedAt, // the SAME (now stale) value the loser read before the winner's claim committed.
      'sending',
    );

    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('reports 0 when the row is simply not in one of the allowed "from" statuses — no special-casing vs. a stale updatedAt', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      claimDocumentTransition(
        'company-1',
        'invoice',
        'doc-1',
        ['draft', 'send_failed'],
        new Date(),
        'sending',
      ),
    ).resolves.toBe(0);
  });
});

// GET /documents' own paginated, filtered read (issue: the list screen used to fetch a flat,
// unpaginated `take: 50` with every filter re-applied client-side against whatever those 50 rows
// happened to be — silently hiding anything past the cap). Every descriptor-derived fact
// (clientFieldKey/dateFieldKey/searchTextFieldKeys/searchClientIds) arrives here ALREADY resolved —
// this function only ever turns them into a Prisma query, never itself reads a descriptor or queries
// `Client` — see documents.service.list-documents.spec.ts for that resolution half.
describe('persistence — listDocumentsPage', () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    loggerWarn.mockReset();
  });

  const baseOptions = {
    typeId: 'invoice',
    page: 1,
    pageSize: 25,
    sort: 'updatedAt' as const,
    order: 'desc' as const,
  };

  it('scopes by companyId and typeId, paginates with skip/take, and counts the SAME where clause', async () => {
    findMany.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]);
    count.mockResolvedValue(37);

    const result = await listDocumentsPage('company-1', { ...baseOptions, page: 3, pageSize: 10 });

    const expectedWhere = { companyId: 'company-1', typeId: 'invoice' };
    expect(findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { updatedAt: 'desc' },
      skip: 20,
      take: 10,
    });
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result).toEqual({ items: [{ id: 'doc-1' }, { id: 'doc-2' }], total: 37, page: 3, pageSize: 10 });
  });

  it('lists across every type when typeId is absent — the pre-existing "coarse" shape', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listDocumentsPage('company-1', { ...baseOptions, typeId: undefined });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-1' } }));
  });

  it('applies status as an IN clause, never a single equals', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listDocumentsPage('company-1', { ...baseOptions, status: ['draft', 'sent'] });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', typeId: 'invoice', status: { in: ['draft', 'sent'] } },
      }),
    );
  });

  it('applies clientId as an EXACT JSON-path equals under the resolved clientFieldKey', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listDocumentsPage('company-1', {
      ...baseOptions,
      clientFieldKey: 'client',
      clientId: 'client-9',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          typeId: 'invoice',
          data: { path: ['client'], equals: 'client-9' },
        },
      }),
    );
  });

  it('never applies clientId without a resolved clientFieldKey (the service already refused that combination)', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listDocumentsPage('company-1', { ...baseOptions, clientId: 'client-9' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1', typeId: 'invoice' } }),
    );
  });

  it('q builds an OR of displayNumber contains + one string_contains per text field + one equals per matched client id', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listDocumentsPage('company-1', {
      ...baseOptions,
      q: 'acme',
      searchTextFieldKeys: ['description'],
      clientFieldKey: 'client',
      searchClientIds: ['client-9', 'client-10'],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { displayNumber: { contains: 'acme', mode: 'insensitive' } },
            { data: { path: ['description'], string_contains: 'acme', mode: 'insensitive' } },
            { data: { path: ['client'], equals: 'client-9' } },
            { data: { path: ['client'], equals: 'client-10' } },
          ],
        }),
      }),
    );
  });

  it('applies no OR clause at all when q is blank', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await listDocumentsPage('company-1', baseOptions);

    const where = findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('OR');
  });

  describe('a date range filter forces the in-memory path (no `count`, an honest capped read instead)', () => {
    it('never calls count when dateFrom/dateTo is present', async () => {
      findMany.mockResolvedValue([]);

      await listDocumentsPage('company-1', {
        ...baseOptions,
        dateFieldKey: 'issueDate',
        dateFrom: '2026-01-01',
      });

      expect(count).not.toHaveBeenCalled();
    });

    it('excludes a document whose date falls outside the range, inclusive at both UTC-day boundaries', async () => {
      findMany.mockResolvedValue([
        { id: 'too-early', data: { issueDate: '2025-12-31T23:59:00.000Z' } },
        { id: 'lower-bound', data: { issueDate: '2026-01-01T00:00:00.000Z' } },
        { id: 'inside', data: { issueDate: '2026-01-15T10:00:00.000Z' } },
        { id: 'upper-bound', data: { issueDate: '2026-01-31T23:59:59.000Z' } },
        { id: 'too-late', data: { issueDate: '2026-02-01T00:00:00.000Z' } },
      ]);

      const result = await listDocumentsPage('company-1', {
        ...baseOptions,
        pageSize: 10,
        dateFieldKey: 'issueDate',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(result.items.map((item) => item.id)).toEqual(['lower-bound', 'inside', 'upper-bound']);
      expect(result.total).toBe(3);
    });

    it('excludes a document with a missing or unparseable date — an honest default, never a guess', async () => {
      findMany.mockResolvedValue([
        { id: 'missing', data: {} },
        { id: 'not-a-date', data: { issueDate: 'not a date' } },
        { id: 'ok', data: { issueDate: '2026-01-15T00:00:00.000Z' } },
      ]);

      const result = await listDocumentsPage('company-1', {
        ...baseOptions,
        dateFieldKey: 'issueDate',
        dateFrom: '2026-01-01',
      });

      expect(result.items.map((item) => item.id)).toEqual(['ok']);
    });

    it('paginates the SURVIVORS in memory — page 2 starts after the first pageSize survivors, not the first pageSize candidates', async () => {
      findMany.mockResolvedValue([
        { id: 'in-1', data: { issueDate: '2026-01-01T00:00:00.000Z' } },
        { id: 'out-of-range', data: { issueDate: '2025-06-01T00:00:00.000Z' } }, // filtered out, never counted as a page slot
        { id: 'in-2', data: { issueDate: '2026-01-02T00:00:00.000Z' } },
        { id: 'in-3', data: { issueDate: '2026-01-03T00:00:00.000Z' } },
      ]);

      const result = await listDocumentsPage('company-1', {
        ...baseOptions,
        page: 2,
        pageSize: 2,
        dateFieldKey: 'issueDate',
        dateFrom: '2026-01-01',
      });

      expect(result.items.map((item) => item.id)).toEqual(['in-3']);
      expect(result.total).toBe(3);
    });

    it('warns once the candidate read hits its cap — the point past which `total` is a survivor count of a TRUNCATED read, not a true total', async () => {
      const candidates = Array.from({ length: DOCUMENT_LIST_DATE_FILTER_READ_CAP }, (_, i) => ({
        id: `doc-${i}`,
        data: { issueDate: '2026-01-15T00:00:00.000Z' },
      }));
      findMany.mockResolvedValue(candidates);

      await listDocumentsPage('company-1', {
        ...baseOptions,
        dateFieldKey: 'issueDate',
        dateFrom: '2026-01-01',
      });

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('cap'),
        expect.objectContaining({
          details: expect.objectContaining({ cap: DOCUMENT_LIST_DATE_FILTER_READ_CAP }),
        }),
      );
    });

    it('never warns for an ordinary, uncapped read', async () => {
      findMany.mockResolvedValue([{ id: 'doc-1', data: { issueDate: '2026-01-15T00:00:00.000Z' } }]);

      await listDocumentsPage('company-1', {
        ...baseOptions,
        dateFieldKey: 'issueDate',
        dateFrom: '2026-01-01',
      });

      expect(loggerWarn).not.toHaveBeenCalled();
    });
  });
});
