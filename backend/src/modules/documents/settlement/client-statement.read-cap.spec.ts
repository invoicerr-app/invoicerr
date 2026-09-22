/**
 * The balance due on a client statement, over a company whose invoice history CROSSES the read cap.
 *
 * `client-statement.spec.ts` next door mocks `../persistence` wholesale, which is right for the
 * arithmetic it proves but means it can never see this: a mocked read hands back whatever array the
 * spec wrote, so it passes identically whether the real read covers the set or one page of it. This
 * file runs the real read against the in-memory table instead, with 600 sent invoices for one client
 * — past the 500-row cap that used to apply — and asserts the AMOUNT, which is what a user reads off
 * the statement.
 */
import { vi } from 'vitest';

import { documentInstanceRow, seedDocumentInstances } from '../__tests__/fake-document-instance-table';
import { ROW_ID_KEY } from '../row-selection/row-selection';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});
// A different table entirely (`DocumentPayment`), and not what this file proves — nothing is paid.
vi.mock('./payments', () => ({ sumPaidMinorByDocument: vi.fn().mockResolvedValue(new Map()) }));

const { resolveClientStatement } = await import('./client-statement');

/** Past the 500-row cap this read used to apply. */
const INVOICE_COUNT = 600;
/** One line of 100.00 EUR at 0% VAT -> 10 000 minor gross per invoice. */
const GROSS_MINOR_PER_INVOICE = 10_000;

function invoiceData(clientId: string) {
  return {
    client: clientId,
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
        // Oldest first by `updatedAt`, so the invoices a capped `updatedAt`-DESC read dropped are the
        // low-numbered ones — the shape a real company has, where old unpaid invoices are exactly
        // what a statement is asked about.
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: invoiceData('client-1'),
      }),
    ),
    // Another client's invoices, and a draft of this one: neither may reach the total.
    ...Array.from({ length: 300 }, (_, index) =>
      documentInstanceRow({
        id: `other-${String(index).padStart(5, '0')}`,
        status: 'sent',
        updatedAt: new Date(Date.UTC(2026, 6, 1, 0, index)),
        data: invoiceData('client-2'),
      }),
    ),
    documentInstanceRow({ id: 'draft-1', status: 'draft', data: invoiceData('client-1') }),
  ]);
});

describe('resolveClientStatement past the read cap', () => {
  it('owes the full balance of every sent invoice, not of the page that was read', async () => {
    const statement = await resolveClientStatement('company-1', 'client-1');

    const outstandingMinor = statement.totals.reduce(
      (total, currency) => total + currency.totalOutstandingMinor,
      0,
    );
    expect(outstandingMinor).toBe(INVOICE_COUNT * GROSS_MINOR_PER_INVOICE);
    expect(statement.totals).toHaveLength(1);
    expect(statement.totals[0].currency).toBe('EUR');
  });

  it("lists every one of the client's sent invoices, and nobody else's", async () => {
    const statement = await resolveClientStatement('company-1', 'client-1');

    expect(statement.documents).toHaveLength(INVOICE_COUNT);
    expect(statement.documents.every((row) => row.typeId === 'invoice')).toBe(true);
    expect(statement.documents.reduce((total, row) => total + row.amountMinor, 0)).toBe(
      INVOICE_COUNT * GROSS_MINOR_PER_INVOICE,
    );
  });

  it('still credits the invoices a credit note corrects, however many notes exist', async () => {
    // 600 credit notes — past the cap `listCreditNotes` used to apply — the LAST of which credits the
    // very first invoice in full. Under a capped, createdAt-ASC read the newest notes were the ones
    // dropped, so this credit never reduced anything and the client was chased for money already
    // credited.
    const existing = [
      ...Array.from({ length: INVOICE_COUNT }, (_, index) =>
        documentInstanceRow({
          id: `inv-${String(index).padStart(5, '0')}`,
          status: 'sent',
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
          data: invoiceData('client-1'),
        }),
      ),
      ...Array.from({ length: 600 }, (_, index) =>
        documentInstanceRow({
          id: `cn-${String(index).padStart(5, '0')}`,
          typeId: 'credit-note',
          status: 'sent',
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
          data:
            index === 599
              ? { invoice: 'inv-00000', currency: 'EUR', correctedLines: ['line-1'] }
              : { invoice: 'no-such-invoice', currency: 'EUR', correctedLines: ['line-1'] },
        }),
      ),
    ];
    seedDocumentInstances(existing);

    const statement = await resolveClientStatement('company-1', 'client-1');

    const outstandingMinor = statement.totals.reduce(
      (total, currency) => total + currency.totalOutstandingMinor,
      0,
    );
    expect(outstandingMinor).toBe((INVOICE_COUNT - 1) * GROSS_MINOR_PER_INVOICE);
  });
});
