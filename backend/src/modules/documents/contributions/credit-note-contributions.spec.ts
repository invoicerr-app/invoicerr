import { vi, type Mock } from 'vitest';

import { NotFoundException } from '@nestjs/common';

import { buildCreditNoteStatisticsWidgets, resolveInvoiceLabel } from './credit-note-contributions';
import * as persistence from '../persistence';
import { filterLikeListAllDocuments } from '../__tests__/fake-document-instance-table';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { DocumentInstanceResult } from '../actions/action-registry';
import { TableWidget } from './widgets';

vi.mock('../persistence');

const listRecentDocuments = persistence.listRecentDocuments as Mock;
const countDocuments = persistence.countDocuments as Mock;

/** Hands the code under test only the rows the QUERY would have returned, and counts in the table
 *  rather than on the page — the split this screen now makes between a capped display list and the
 *  total beside it. Fixtures here stay small on purpose; the cap-crossing ones live in
 *  `*.read-cap.spec.ts`. */
function seedDocuments(rows: DocumentInstanceResult[]): void {
  listRecentDocuments.mockImplementation(async (_companyId: string, options) =>
    filterLikeListAllDocuments(rows, {
      typeId: options.typeId,
      status: options.status,
      orderBy: { field: 'updatedAt', direction: 'desc' },
    }).slice(0, options.take),
  );
  countDocuments.mockImplementation(
    async (_companyId: string, typeId?: string, status?: string[]) =>
      filterLikeListAllDocuments(rows, { typeId, status }).length,
  );
}

const findOwnedDocument = persistence.findOwnedDocument as Mock;

function creditNote(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'cn-1',
    typeId: 'credit-note',
    status: 'draft',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('credit-note.descriptor — no dashboard contribution, deliberately', () => {
  it('declares "statistics" only — a permanently-empty dashboard widget would be noise', () => {
    expect(buildCreditNoteDescriptor().contributions).toEqual(['statistics']);
  });
});

describe('resolveInvoiceLabel', () => {
  // afterEach, not beforeEach: under Vitest (not Jest), resetting this mock in a `beforeEach` that
  // runs ahead of a LATER test's own `mockRejectedValue(...)` — reproduced with a project-independent
  // minimal case, so this is a Vitest/mock-timing quirk, not a bug in `resolveInvoiceLabel` itself —
  // made an unrelated prior test's mock teardown surface as a false "NotFoundException: gone" failure
  // on this describe's own rejection-path tests, even though the try/catch below genuinely ran and
  // returned the right fallback value. Clearing after each test instead avoids the interaction and
  // keeps the exact same isolation guarantee (a fresh mock for every test).
  afterEach(() => findOwnedDocument.mockReset());

  it("resolves to the invoice's own displayNumber when it has one", async () => {
    findOwnedDocument.mockResolvedValue({ id: 'inv-1', displayNumber: 'INV-2026-0042' });
    expect(await resolveInvoiceLabel('c1', 'inv-1')).toBe('INV-2026-0042');
  });

  it('falls back to the invoice id when it exists but has no displayNumber yet', async () => {
    findOwnedDocument.mockResolvedValue({ id: 'inv-1', displayNumber: null });
    expect(await resolveInvoiceLabel('c1', 'inv-1')).toBe('inv-1');
  });

  it('falls back to the RAW stored id — never throws — when the invoice cannot be found at all', async () => {
    findOwnedDocument.mockRejectedValue(new NotFoundException('gone'));
    expect(await resolveInvoiceLabel('c1', 'deleted-invoice-id')).toBe('deleted-invoice-id');
  });

  it('re-throws anything other than a NotFoundException', async () => {
    findOwnedDocument.mockRejectedValue(new Error('boom'));
    await expect(resolveInvoiceLabel('c1', 'inv-1')).rejects.toThrow('boom');
  });
});

describe('buildCreditNoteStatisticsWidgets', () => {
  beforeEach(() => {
    listRecentDocuments.mockReset();
    countDocuments.mockReset();
    findOwnedDocument.mockReset();
  });

  it('renders the table with the invoice reference resolved to its displayNumber', async () => {
    seedDocuments([
      creditNote({ id: 'cn-1', data: { issueDate: '2026-01-01', currency: 'EUR', invoice: 'inv-1' } }),
    ]);
    findOwnedDocument.mockResolvedValue({ id: 'inv-1', displayNumber: 'INV-2026-0042' });

    const widgets = await buildCreditNoteStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;

    expect(table.rows).toEqual([{ issueDate: '2026-01-01', invoice: 'INV-2026-0042', currency: 'EUR' }]);
  });

  it('falls back to the raw invoice id for a broken reference, without dropping the row', async () => {
    seedDocuments([
      creditNote({ id: 'cn-1', data: { issueDate: '2026-01-01', currency: 'EUR', invoice: 'deleted-id' } }),
    ]);
    findOwnedDocument.mockRejectedValue(new NotFoundException('gone'));

    const widgets = await buildCreditNoteStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;

    expect(table.rows).toEqual([{ issueDate: '2026-01-01', invoice: 'deleted-id', currency: 'EUR' }]);
  });
});
