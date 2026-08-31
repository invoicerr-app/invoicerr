import { NotFoundException } from '@nestjs/common';

import { buildCreditNoteStatisticsWidgets, resolveInvoiceLabel } from './credit-note-contributions';
import * as persistence from '../persistence';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { DocumentInstanceResult } from '../actions/action-registry';
import { TableWidget } from './widgets';

jest.mock('../persistence');

const listDocuments = persistence.listDocuments as jest.Mock;
const findOwnedDocument = persistence.findOwnedDocument as jest.Mock;

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
  beforeEach(() => findOwnedDocument.mockReset());

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
    listDocuments.mockReset();
    findOwnedDocument.mockReset();
  });

  it('renders the table with the invoice reference resolved to its displayNumber', async () => {
    listDocuments.mockResolvedValue([
      creditNote({ id: 'cn-1', data: { issueDate: '2026-01-01', currency: 'EUR', invoice: 'inv-1' } }),
    ]);
    findOwnedDocument.mockResolvedValue({ id: 'inv-1', displayNumber: 'INV-2026-0042' });

    const widgets = await buildCreditNoteStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;

    expect(table.rows).toEqual([{ issueDate: '2026-01-01', invoice: 'INV-2026-0042', currency: 'EUR' }]);
  });

  it('falls back to the raw invoice id for a broken reference, without dropping the row', async () => {
    listDocuments.mockResolvedValue([
      creditNote({ id: 'cn-1', data: { issueDate: '2026-01-01', currency: 'EUR', invoice: 'deleted-id' } }),
    ]);
    findOwnedDocument.mockRejectedValue(new NotFoundException('gone'));

    const widgets = await buildCreditNoteStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;

    expect(table.rows).toEqual([{ issueDate: '2026-01-01', invoice: 'deleted-id', currency: 'EUR' }]);
  });
});
