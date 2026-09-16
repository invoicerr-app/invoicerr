import { DocumentTypeRegistry } from './type-registry';
import { buildGoodsReceiptDescriptor } from './goods-receipt.descriptor';

/**
 * Purchase orders & goods receipts, second pass (three-way match) — the
 * descriptor's own shape, independent of DocumentsService wiring, the same split every other
 * descriptor spec in this module
 * already holds for its own type (see e.g. purchase-order.descriptor.spec.ts, received-invoice.
 * descriptor.spec.ts).
 */
describe('goods-receipt.descriptor — passes validateLifecycle and has the declared shape', () => {
  it('registers without throwing — the lifecycle declaration is internally consistent', () => {
    const registry = new DocumentTypeRegistry();
    expect(() => registry.register(buildGoodsReceiptDescriptor())).not.toThrow();
  });

  it('declares the four expected fields, no fewer, no more', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    expect(descriptor.fields.map((f) => f.key).sort()).toEqual(
      ['purchaseOrder', 'receiptDate', 'notes', 'lines'].sort(),
    );
  });

  it('"purchaseOrder" is a required reference to the "purchase-order" entity', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    const purchaseOrder = descriptor.fields.find((f) => f.key === 'purchaseOrder');
    expect(purchaseOrder?.kind).toBe('reference');
    expect(purchaseOrder?.entity).toBe('purchase-order');
    expect(purchaseOrder?.required).toBe(true);
  });

  it('"lines" is a required array of description + quantityReceived only', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    const lines = descriptor.fields.find((f) => f.key === 'lines');
    expect(lines?.kind).toBe('array');
    expect(lines?.required).toBe(true);
    expect(lines?.min).toBe(1);
    expect(lines?.fields?.map((f) => f.key).sort()).toEqual(['description', 'quantityReceived'].sort());
  });

  it('declares exactly two statuses, starting at "draft"', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    expect(descriptor.statuses?.map((s) => s.id)).toEqual(['draft', 'recorded']);
    expect(descriptor.initialStatus).toBe('draft');
  });

  it('numbers at "recorded" — the shipped default prefix is "GOODS-RECEIPT-"', () => {
    expect(buildGoodsReceiptDescriptor().numbering).toEqual({ onEnterStatus: 'recorded' });
  });

  it('declares exactly three actions: save-draft, record, delete', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    expect(descriptor.actions.map((a) => a.id).sort()).toEqual(['save-draft', 'record', 'delete'].sort());
  });

  it('"record" is only available from "draft", and flips to "recorded"', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    const record = descriptor.actions.find((a) => a.id === 'record');
    expect(record?.availableWhen).toEqual(['draft']);
    expect(record?.transitions).toEqual([{ from: ['draft'], to: 'recorded' }]);
  });

  it('"delete" is only available from "draft" — a recorded receipt is part of the reconciliation trail', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    const del = descriptor.actions.find((a) => a.id === 'delete');
    expect(del?.availableWhen).toEqual(['draft']);
  });

  it('does not opt into any invoice-only rendering flag, and declares no email default', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    expect(descriptor.usesLegalMentions).toBeUndefined();
    expect(descriptor.usesPaymentQr).toBeUndefined();
    expect(descriptor.usesPaymentMethods).toBeUndefined();
    expect(descriptor.email).toBeUndefined();
  });

  it('listItem leads with purchaseOrder, then receiptDate', () => {
    const descriptor = buildGoodsReceiptDescriptor();
    expect(descriptor.listItem).toEqual({
      titleFields: ['purchaseOrder'],
      secondaryFields: ['receiptDate'],
    });
  });
});
