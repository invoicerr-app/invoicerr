import { buildCreditNoteDescriptor } from './credit-note.descriptor';
import { buildGoodsReceiptDescriptor } from './goods-receipt.descriptor';
import { buildReceivedInvoiceDescriptor } from './received-invoice.descriptor';
import type { DocumentTypeDescriptor } from './types';

function leadingKeys(descriptor: DocumentTypeDescriptor, count: number): string[] {
  return descriptor.fields.slice(0, count).map((field) => field.key);
}

describe('a document created from another one asks for that source document first', () => {
  it('credit note: the corrected invoice, then its client, then the date and the currency', () => {
    expect(leadingKeys(buildCreditNoteDescriptor(), 4)).toEqual([
      'invoice',
      'client',
      'issueDate',
      'currency',
    ]);
  });

  it('goods receipt: the purchase order, then the receipt date', () => {
    expect(leadingKeys(buildGoodsReceiptDescriptor(), 2)).toEqual(['purchaseOrder', 'receiptDate']);
  });

  it('received invoice: the purchase order, then the supplier', () => {
    expect(leadingKeys(buildReceivedInvoiceDescriptor(), 2)).toEqual(['purchaseOrder', 'supplier']);
  });
});
