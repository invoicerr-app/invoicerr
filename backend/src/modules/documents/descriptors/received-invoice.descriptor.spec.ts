import { DocumentTypeRegistry } from './type-registry';
import { buildReceivedInvoiceDescriptor } from './received-invoice.descriptor';

/**
 * Root TODO item 18 — the descriptor's own shape, independent of DocumentsService wiring (that side
 * is documents.service.received-invoice.spec.ts's job). The one thing every descriptor spec in this
 * module proves first: registering it does not throw — i.e. it passes `validateLifecycle`
 * (descriptors/lifecycle.ts), called by `DocumentTypeRegistry.register()`.
 */
describe('received-invoice.descriptor — passes validateLifecycle and has the declared shape', () => {
  it('registers without throwing — the lifecycle declaration is internally consistent', () => {
    const registry = new DocumentTypeRegistry();
    expect(() => registry.register(buildReceivedInvoiceDescriptor())).not.toThrow();
  });

  it('declares exactly three statuses, starting at "received" — no "draft" exists for this type', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    expect(descriptor.statuses?.map((s) => s.id)).toEqual(['received', 'approved', 'rejected']);
    expect(descriptor.initialStatus).toBe('received');
  });

  it('declares no numbering — a received invoice is never assigned OUR sequence', () => {
    expect(buildReceivedInvoiceDescriptor().numbering).toBeUndefined();
  });

  it('declares no email template — this type structurally never sends', () => {
    expect(buildReceivedInvoiceDescriptor().email).toBeUndefined();
  });

  it('declares no usesLegalMentions — BG-1 statutory mentions are an issuance concern', () => {
    expect(buildReceivedInvoiceDescriptor().usesLegalMentions).toBeUndefined();
  });

  it('every field is optional — a plain scanned PDF must still be recordable with everything blank', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    for (const field of descriptor.fields) {
      expect(field.required).not.toBe(true);
    }
  });

  it('declares the nine expected business fields, no fewer, no more — TODO_PRODUIT.md T5(a) added "lines"', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    expect(descriptor.fields.map((f) => f.key).sort()).toEqual(
      [
        'supplier',
        'supplierNumber',
        'issueDate',
        'dueDate',
        'currency',
        'netAmount',
        'vatAmount',
        'grossAmount',
        'lines',
      ].sort(),
    );
  });

  it('"lines" reuses the array field kind, four subfields, no min — an enrichment, never a new requirement', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    const lines = descriptor.fields.find((f) => f.key === 'lines');
    expect(lines?.kind).toBe('array');
    expect(lines?.required).toBe(false);
    expect(lines?.min).toBeUndefined();
    expect(lines?.fields?.map((f) => f.key).sort()).toEqual(
      ['description', 'quantity', 'unitPrice', 'vatRate'].sort(),
    );
  });

  it('"lines[].vatRate" never uses this company\'s own VAT-rate catalog — the supplier\'s rate may be foreign', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    const lines = descriptor.fields.find((f) => f.key === 'lines');
    const vatRate = lines?.fields?.find((f) => f.key === 'vatRate');
    expect(vatRate?.kind).toBe('select');
    expect(vatRate?.usesVatRateCatalog).toBeUndefined();
    expect(vatRate?.allowCustomValue).toBe(true);
    expect(vatRate?.options).toEqual([]);
  });

  it('never declares fileRef/fileName/fileMime as fields — they are system data, not user-typed', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    const keys = descriptor.fields.map((f) => f.key);
    expect(keys).not.toContain('fileRef');
    expect(keys).not.toContain('fileName');
    expect(keys).not.toContain('fileMime');
  });

  it('the "supplier" field is a plain text field, not a reference to the client entity', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    const supplier = descriptor.fields.find((f) => f.key === 'supplier');
    expect(supplier?.kind).toBe('text');
    expect(supplier?.entity).toBeUndefined();
  });

  it('declares "dashboard" as its only contribution — no "statistics" in this wave', () => {
    expect(buildReceivedInvoiceDescriptor().contributions).toEqual(['dashboard']);
  });

  it('listItem leads with supplier/supplierNumber, then issueDate/grossAmount', () => {
    const descriptor = buildReceivedInvoiceDescriptor();
    expect(descriptor.listItem).toEqual({
      titleFields: ['supplier', 'supplierNumber'],
      secondaryFields: ['issueDate', 'grossAmount'],
    });
  });
});
