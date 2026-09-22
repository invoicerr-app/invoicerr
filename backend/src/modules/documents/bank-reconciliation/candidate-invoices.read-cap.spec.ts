/**
 * The pool of outstanding invoices a bank statement line is matched against, over a company whose
 * invoice history crosses the read cap.
 *
 * An invoice missing from this pool is not merely absent from a screen: an incoming payment finds no
 * invoice to settle, silently. The fixture makes the LONG-UNPAID invoices the least recently touched
 * ones — the population a capped `updatedAt`-DESC read dropped first, and the population a bank
 * statement is most likely to be paying off.
 */
import { vi } from 'vitest';

import { documentInstanceRow, seedDocumentInstances } from '../__tests__/fake-document-instance-table';
import { ROW_ID_KEY } from '../row-selection/row-selection';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});
vi.mock('../settlement/payments', () => ({
  sumPaidMinorByDocument: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../accounting-export/client-labels', () => ({
  resolveClientLabels: vi.fn().mockResolvedValue(new Map()),
}));

const { resolveOutstandingInvoices } = await import('./candidate-invoices');

/** Past the 500-row cap this read used to apply. */
const INVOICE_COUNT = 600;
/** One line of 100.00 EUR at 0% VAT -> 10 000 minor outstanding per invoice. */
const OUTSTANDING_MINOR_PER_INVOICE = 10_000;

function invoiceData() {
  return {
    client: 'client-1',
    issueDate: '2026-01-01',
    dueDate: '2026-02-01',
    currency: 'EUR',
    lines: [{ [ROW_ID_KEY]: 'line-1', description: 'Widget', quantity: 1, unitPrice: 100, vatRate: '0' }],
  };
}

beforeEach(() => {
  seedDocumentInstances([
    ...Array.from({ length: INVOICE_COUNT }, (_, index) =>
      documentInstanceRow({
        id: `inv-${String(index).padStart(5, '0')}`,
        typeId: 'invoice',
        status: 'sent',
        displayNumber: `INV-${index}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: invoiceData(),
      }),
    ),
    // Never candidates: a draft was not issued, a cancelled invoice owes nothing.
    documentInstanceRow({ id: 'draft-1', status: 'draft', data: invoiceData() }),
    documentInstanceRow({ id: 'cancelled-1', status: 'cancelled', data: invoiceData() }),
  ]);
});

describe('resolveOutstandingInvoices past the read cap', () => {
  it('offers every outstanding invoice a bank line could settle, not one page of them', async () => {
    const candidates = await resolveOutstandingInvoices('company-1');

    const outstandingMinor = candidates.reduce((total, candidate) => total + candidate.outstandingMinor, 0);
    expect(outstandingMinor).toBe(INVOICE_COUNT * OUTSTANDING_MINOR_PER_INVOICE);
  });

  it('includes the OLDEST unpaid invoice — the one a capped, recency-ordered read dropped first', async () => {
    const candidates = await resolveOutstandingInvoices('company-1');

    const oldest = candidates.find((candidate) => candidate.documentId === 'inv-00000');
    expect(oldest?.outstandingMinor).toBe(OUTSTANDING_MINOR_PER_INVOICE);
  });
});
