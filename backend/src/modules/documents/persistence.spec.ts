import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { findOwnedDocument, upsertDocument } from './persistence';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentInstance: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const findFirst = prisma.documentInstance.findFirst as jest.Mock;
const update = prisma.documentInstance.update as jest.Mock;
const create = prisma.documentInstance.create as jest.Mock;

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
   * TODO_FEATURES.md rank 13 ("notes de frais enrichies") — the exact mechanism "suppression" (the
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
