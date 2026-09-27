import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildExpenseDescriptor } from '../descriptors/expense.descriptor';
import { buildGoodsReceiptDescriptor } from '../descriptors/goods-receipt.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildPurchaseOrderDescriptor } from '../descriptors/purchase-order.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { buildReceivedInvoiceDescriptor } from '../descriptors/received-invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { printsStatusLine } from './status-line-policy';

/**
 * Issue #494 - which renders print "Status: <status>", pinned against every real descriptor and every
 * status it declares. If a type gains a status, this table has to say which side it falls on.
 */
const TYPES: [string, () => DocumentTypeDescriptor][] = [
  ['invoice', buildInvoiceDescriptor],
  ['credit-note', buildCreditNoteDescriptor],
  ['quote', buildQuoteDescriptor],
  ['purchase-order', buildPurchaseOrderDescriptor],
  ['goods-receipt', buildGoodsReceiptDescriptor],
  ['expense', buildExpenseDescriptor],
  ['received-invoice', buildReceivedInvoiceDescriptor],
];

/** The statuses whose on-demand render still prints a status line: a working copy, not issued. */
const WORKING_COPY_STATUSES: Record<string, string[]> = {
  invoice: ['draft'],
  'credit-note': ['draft'],
  quote: ['draft', 'sending', 'sent', 'send_failed', 'refused'],
  'purchase-order': ['draft', 'sending', 'sent', 'send_failed', 'cancelled'],
  'goods-receipt': ['draft', 'recorded'],
  expense: ['draft'],
  'received-invoice': ['received', 'approved', 'rejected'],
};

describe('status-line-policy (issue #494)', () => {
  describe.each(TYPES)('%s', (typeId, build) => {
    const descriptor = build();
    const statuses = (descriptor.statuses ?? []).map((s) => s.id);

    it('declares the statuses this table knows about', () => {
      expect(statuses.length).toBeGreaterThan(0);
      for (const status of WORKING_COPY_STATUSES[typeId]) expect(statuses).toContain(status);
    });

    it.each(statuses)('a delivery render at "%s" prints no status line', (status) => {
      expect(printsStatusLine(descriptor, status, 'delivery')).toBe(false);
    });

    it.each(statuses)('an on-demand render at "%s" prints one only for a working copy', (status) => {
      expect(printsStatusLine(descriptor, status, 'on-demand')).toBe(
        WORKING_COPY_STATUSES[typeId].includes(status),
      );
    });
  });
});
