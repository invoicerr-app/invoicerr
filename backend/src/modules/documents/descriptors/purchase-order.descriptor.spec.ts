import { DocumentTypeRegistry } from './type-registry';
import { buildPurchaseOrderDescriptor } from './purchase-order.descriptor';

/**
 * Purchase orders & goods receipts ("bons de commande") — the descriptor's own shape, independent of
 * DocumentsService wiring, the same split every other descriptor spec in this module already holds
 * for its own type (see e.g. expense.descriptor.spec.ts, received-invoice.descriptor.spec.ts).
 */
describe('purchase-order.descriptor — passes validateLifecycle and has the declared shape', () => {
  it('registers without throwing — the lifecycle declaration is internally consistent', () => {
    const registry = new DocumentTypeRegistry();
    expect(() => registry.register(buildPurchaseOrderDescriptor())).not.toThrow();
  });

  it('declares the six expected fields, no fewer, no more', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    expect(descriptor.fields.map((f) => f.key).sort()).toEqual(
      ['supplier', 'issueDate', 'expectedDeliveryDate', 'currency', 'reference', 'notes', 'lines'].sort(),
    );
  });

  it('"supplier" is a required reference to the "supplier" entity, never "client" (the billable picker)', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    const supplier = descriptor.fields.find((f) => f.key === 'supplier');
    expect(supplier?.kind).toBe('reference');
    expect(supplier?.entity).toBe('supplier');
    expect(supplier?.required).toBe(true);
  });

  it('"lines" carries no article catalog link and no VAT rate — no stock effect, not a tax document', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    const lines = descriptor.fields.find((f) => f.key === 'lines');
    expect(lines?.kind).toBe('array');
    expect(lines?.required).toBe(true);
    expect(lines?.min).toBe(1);
    expect(lines?.prefillFrom).toBeUndefined();
    expect(lines?.fields?.map((f) => f.key).sort()).toEqual(['description', 'quantity', 'unitPrice'].sort());
    // No 'select' subfield at all — see totals/compute-totals.ts's own header on why this shape
    // deliberately produces no "no usable VAT rate" warning.
    expect(lines?.fields?.some((f) => f.kind === 'select')).toBe(false);
  });

  it('declares FIVE statuses, starting at "draft", mirroring the invoice\'s own shape (async send + cancel)', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    expect(descriptor.statuses?.map((s) => s.id)).toEqual([
      'draft',
      'sending',
      'sent',
      'send_failed',
      'cancelled',
    ]);
    expect(descriptor.initialStatus).toBe('draft');
  });

  it('numbers at "sending" — same async-send shape as quote/invoice', () => {
    expect(buildPurchaseOrderDescriptor().numbering).toEqual({ onEnterStatus: 'sending' });
  });

  it('declares exactly three actions: save-draft, send, cancel-order — deliberately NOT "cancel"', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    expect(descriptor.actions.map((a) => a.id).sort()).toEqual(['save-draft', 'send', 'cancel-order'].sort());
    // See this descriptor's own header: naming this action "cancel" would make it silently
    // unreachable from the generic action-button row (document-form.tsx/document-list.tsx both
    // filter out `action.id === "cancel"` unconditionally, on the assumption of a dedicated
    // custom-slot button this type does not have).
    expect(descriptor.actions.map((a) => a.id)).not.toContain('cancel');
  });

  it('"cancel-order" is only available from "sent"/"send_failed", and never declares a "cancel" status name conflict', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    const cancelOrder = descriptor.actions.find((a) => a.id === 'cancel-order');
    expect(cancelOrder?.availableWhen).toEqual(['sent', 'send_failed']);
    expect(cancelOrder?.transitions).toEqual([{ from: ['sent', 'send_failed'], to: 'cancelled' }]);
  });

  it('declares an email default and its standard translations, like every other outbound type', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    expect(descriptor.email).toBeDefined();
    expect(descriptor.emailTranslations?.fr).toBeDefined();
  });

  it('does not opt into any invoice-only rendering flag', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    expect(descriptor.usesLegalMentions).toBeUndefined();
    expect(descriptor.usesPaymentQr).toBeUndefined();
    expect(descriptor.usesPaymentMethods).toBeUndefined();
  });

  it('listItem leads with supplier, then issueDate/expectedDeliveryDate/currency/reference', () => {
    const descriptor = buildPurchaseOrderDescriptor();
    expect(descriptor.listItem).toEqual({
      titleFields: ['supplier'],
      secondaryFields: ['issueDate', 'expectedDeliveryDate', 'currency', 'reference'],
    });
  });
});
