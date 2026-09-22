/**
 * The three-way match (purchase order / goods receipts / supplier invoice), over a company whose
 * goods-receipt history crosses the read cap.
 *
 * The receipts for one purchase order used to be found by filtering the 500 most recently touched
 * goods receipts in memory. Past that, a receipt the warehouse genuinely recorded was absent from the
 * match, which then reported a quantity variance against goods that HAD been received — a variance a
 * human is asked to accept or dispute, on an invoice about to be paid. Both conditions now go into
 * the query, so the receipt is found however old it is; the fixture makes it the least recently
 * touched row of 600.
 */
import { vi } from 'vitest';

import { documentInstanceRow, seedDocumentInstances } from '../__tests__/fake-document-instance-table';
import { ROW_ID_KEY } from '../row-selection/row-selection';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});

const { resolveReceivedInvoiceReconciliation } = await import('./resolve-received-invoice-reconciliation');

/** Past the 500-row cap this scan used to apply. */
const UNRELATED_RECEIPTS = 600;

const ORDERED_QUANTITY = 10;

beforeEach(() => {
  seedDocumentInstances([
    documentInstanceRow({
      id: 'recv-1',
      typeId: 'received-invoice',
      status: 'received',
      data: {
        purchaseOrder: 'po-1',
        lines: [{ [ROW_ID_KEY]: 'l1', description: 'Widget', quantity: ORDERED_QUANTITY, unitPrice: 100 }],
      },
    }),
    documentInstanceRow({
      id: 'po-1',
      typeId: 'purchase-order',
      status: 'sent',
      data: {
        lines: [{ [ROW_ID_KEY]: 'l1', description: 'Widget', quantity: ORDERED_QUANTITY, unitPrice: 100 }],
      },
    }),
    // THE receipt that proves the goods arrived — the least recently touched row in the table.
    documentInstanceRow({
      id: 'gr-the-one',
      typeId: 'goods-receipt',
      status: 'recorded',
      updatedAt: new Date(Date.UTC(2020, 0, 1)),
      data: {
        purchaseOrder: 'po-1',
        lines: [{ [ROW_ID_KEY]: 'l1', description: 'Widget', quantityReceived: ORDERED_QUANTITY }],
      },
    }),
    // Receipts against OTHER purchase orders, all more recent — what a capped read kept instead.
    ...Array.from({ length: UNRELATED_RECEIPTS }, (_, index) =>
      documentInstanceRow({
        id: `gr-${String(index).padStart(5, '0')}`,
        typeId: 'goods-receipt',
        status: 'recorded',
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: {
          purchaseOrder: `po-other-${index}`,
          lines: [{ [ROW_ID_KEY]: 'l1', description: 'Widget', quantityReceived: 99 }],
        },
      }),
    ),
  ]);
});

describe('resolveReceivedInvoiceReconciliation past the read cap', () => {
  it('counts the goods receipt that proves delivery, however long ago it was recorded', async () => {
    const result = await resolveReceivedInvoiceReconciliation('company-1', 'recv-1');

    expect(result.hasPurchaseOrder).toBe(true);
    expect(result.lines?.[0]?.quantityReceived).toBe(ORDERED_QUANTITY);
    expect(result.lines?.[0]?.quantityVarianceValue).toBe(0);
    expect(result.overallVerdict).toBe('within-tolerance');
  });

  it('still reports a genuine shortfall when the receipt really is short', async () => {
    seedDocumentInstances([
      documentInstanceRow({
        id: 'recv-1',
        typeId: 'received-invoice',
        status: 'received',
        data: {
          purchaseOrder: 'po-1',
          lines: [{ [ROW_ID_KEY]: 'l1', description: 'Widget', quantity: ORDERED_QUANTITY, unitPrice: 100 }],
        },
      }),
      documentInstanceRow({
        id: 'po-1',
        typeId: 'purchase-order',
        status: 'sent',
        data: {
          lines: [{ [ROW_ID_KEY]: 'l1', description: 'Widget', quantity: ORDERED_QUANTITY, unitPrice: 100 }],
        },
      }),
      documentInstanceRow({
        id: 'gr-the-one',
        typeId: 'goods-receipt',
        status: 'recorded',
        data: {
          purchaseOrder: 'po-1',
          lines: [{ [ROW_ID_KEY]: 'l1', description: 'Widget', quantityReceived: 4 }],
        },
      }),
    ]);

    const result = await resolveReceivedInvoiceReconciliation('company-1', 'recv-1');

    expect(result.lines?.[0]?.quantityReceived).toBe(4);
    expect(result.lines?.[0]?.quantityVarianceValue).not.toBe(0);
    expect(result.overallVerdict).toBe('to-review');
  });
});
