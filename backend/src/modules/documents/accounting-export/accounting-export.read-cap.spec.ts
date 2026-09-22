/**
 * The accounting export of a PERIOD, over a company whose invoice history crosses the read cap.
 *
 * This is the sharpest form the truncation took: the read kept the most recently TOUCHED invoices and
 * the period filter then ran over those, so asking for an old quarter produced a CSV that opened
 * cleanly, carried no warning and no truncation marker, and was simply missing invoices. The fixture
 * therefore puts the requested period at the OLD end of the history — 800 invoices, of which the 100
 * oldest belong to the quarter being exported — which is exactly what the capped read discarded
 * first.
 */
import { vi } from 'vitest';

import { documentInstanceRow, seedDocumentInstances } from '../__tests__/fake-document-instance-table';
import { ROW_ID_KEY } from '../row-selection/row-selection';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});
// Other tables, not what this file proves: nothing is paid, and client labels resolve to nothing.
vi.mock('../settlement/payments', () => ({
  sumPaidMinorByDocument: vi.fn().mockResolvedValue(new Map()),
  listPaymentsInRange: vi.fn().mockResolvedValue([]),
}));
vi.mock('./client-labels', () => ({ resolveClientLabels: vi.fn().mockResolvedValue(new Map()) }));

const { buildAccountingExport } = await import('./accounting-export.service');

/** Past the 500-row cap this read used to apply. */
const TOTAL_INVOICES = 800;
/** How many of them fall inside the quarter being exported. */
const IN_PERIOD = 100;
/** One line of 100.00 EUR at 0% VAT -> 10 000 minor gross, i.e. "100.00" in the CSV's gross column. */
const GROSS_PER_INVOICE = 100;

function invoiceData(issueDate: string) {
  return {
    client: 'client-1',
    issueDate,
    dueDate: issueDate,
    currency: 'EUR',
    lines: [{ [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '0' }],
  };
}

/** Sums the `gross` column of every invoice row in the produced CSV. */
function sumInvoiceGross(csv: string): number {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map((cell) => cell.replace(/"/g, ''));
  const typeIndex = header.indexOf('type');
  const grossIndex = header.indexOf('gross');
  expect(typeIndex).toBeGreaterThanOrEqual(0);
  expect(grossIndex).toBeGreaterThanOrEqual(0);
  return lines
    .slice(1)
    .map((line) => line.split(',').map((cell) => cell.replace(/"/g, '')))
    .filter((cells) => cells[typeIndex] === 'invoice')
    .reduce((total, cells) => total + Number(cells[grossIndex]), 0);
}

beforeEach(() => {
  seedDocumentInstances(
    Array.from({ length: TOTAL_INVOICES }, (_, index) =>
      documentInstanceRow({
        id: `inv-${String(index).padStart(5, '0')}`,
        typeId: 'invoice',
        status: 'sent',
        displayNumber: `INV-${index}`,
        // Oldest first: the exported quarter is the first 100, and they are the least recently
        // touched rows in the table.
        updatedAt: new Date(Date.UTC(2025, 0, 1, 0, index)),
        data: invoiceData(index < IN_PERIOD ? '2025-02-15' : '2026-02-15'),
      }),
    ),
  );
});

describe('buildAccountingExport past the read cap', () => {
  it('exports every invoice of the requested quarter, not those that survived an unrelated cap', async () => {
    const csv = await buildAccountingExport('company-1', '2025-01-01', '2025-03-31');

    expect(sumInvoiceGross(csv)).toBe(IN_PERIOD * GROSS_PER_INVOICE);
  });

  it('keeps the period the filter, not the read order — a later quarter is equally complete', async () => {
    const csv = await buildAccountingExport('company-1', '2026-01-01', '2026-03-31');

    expect(sumInvoiceGross(csv)).toBe((TOTAL_INVOICES - IN_PERIOD) * GROSS_PER_INVOICE);
  });
});
