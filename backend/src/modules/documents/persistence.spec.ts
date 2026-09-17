import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { claimDocumentTransition, findOwnedDocument, upsertDocument } from './persistence';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentInstance: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const findFirst = prisma.documentInstance.findFirst as jest.Mock;
const update = prisma.documentInstance.update as jest.Mock;
const create = prisma.documentInstance.create as jest.Mock;
const updateMany = prisma.documentInstance.updateMany as jest.Mock;

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
