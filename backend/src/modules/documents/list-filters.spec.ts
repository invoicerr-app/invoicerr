import { resolveClientFieldKey, resolveDateFieldKey, resolveSearchTextFieldKeys } from './list-filters';
import { DocumentTypeDescriptor } from './descriptors/types';

function descriptor(overrides: Partial<DocumentTypeDescriptor>): DocumentTypeDescriptor {
  return { id: 'widget', label: 'Widget', fields: [], actions: [], ...overrides };
}

describe('resolveClientFieldKey', () => {
  it("finds the field referencing the 'client' entity (invoice/quote shape)", () => {
    const d = descriptor({
      fields: [
        { key: 'notes', kind: 'longText', label: 'Notes' },
        { key: 'client', kind: 'reference', label: 'Client', entity: 'client' },
      ],
    });
    expect(resolveClientFieldKey(d)).toBe('client');
  });

  it("ignores a reference field targeting a DIFFERENT entity (purchase-order's own 'supplier')", () => {
    const d = descriptor({
      fields: [{ key: 'supplier', kind: 'reference', label: 'Supplier', entity: 'supplier' }],
    });
    expect(resolveClientFieldKey(d)).toBeUndefined();
  });

  it('is undefined for a type with no reference fields at all (expense)', () => {
    const d = descriptor({ fields: [{ key: 'description', kind: 'text', label: 'Description' }] });
    expect(resolveClientFieldKey(d)).toBeUndefined();
  });
});

describe('resolveDateFieldKey', () => {
  it("prefers 'issueDate' when the type declares one", () => {
    const d = descriptor({
      fields: [
        { key: 'date', kind: 'date', label: 'Date' },
        { key: 'issueDate', kind: 'date', label: 'Issue date' },
      ],
    });
    expect(resolveDateFieldKey(d)).toBe('issueDate');
  });

  it("falls back to 'date' when there is no 'issueDate' (expense shape)", () => {
    const d = descriptor({ fields: [{ key: 'date', kind: 'date', label: 'Date' }] });
    expect(resolveDateFieldKey(d)).toBe('date');
  });

  it('ignores a same-named field that is not actually kind "date"', () => {
    const d = descriptor({ fields: [{ key: 'date', kind: 'text', label: 'Date (free text)' }] });
    expect(resolveDateFieldKey(d)).toBeUndefined();
  });

  it("is undefined for a type with neither 'issueDate' nor 'date' (e.g. goods-receipt's own 'receiptDate')", () => {
    const d = descriptor({ fields: [{ key: 'receiptDate', kind: 'date', label: 'Receipt date' }] });
    expect(resolveDateFieldKey(d)).toBeUndefined();
  });
});

describe('resolveSearchTextFieldKeys', () => {
  it('keeps a text titleField (expense: description)', () => {
    const d = descriptor({
      fields: [{ key: 'description', kind: 'text', label: 'Description' }],
      listItem: { titleFields: ['description'] },
    });
    expect(resolveSearchTextFieldKeys(d)).toEqual(['description']);
  });

  it('keeps a longText titleField too', () => {
    const d = descriptor({
      fields: [{ key: 'summary', kind: 'longText', label: 'Summary' }],
      listItem: { titleFields: ['summary'] },
    });
    expect(resolveSearchTextFieldKeys(d)).toEqual(['summary']);
  });

  it("drops a REFERENCE titleField (invoice: 'client' stores an id, not text)", () => {
    const d = descriptor({
      fields: [{ key: 'client', kind: 'reference', label: 'Client', entity: 'client' }],
      listItem: { titleFields: ['client'] },
    });
    expect(resolveSearchTextFieldKeys(d)).toEqual([]);
  });

  it('keeps only the text titleFields out of a mixed set', () => {
    const d = descriptor({
      fields: [
        { key: 'supplier', kind: 'reference', label: 'Supplier', entity: 'supplier-invoice-supplier' },
        { key: 'supplierNumber', kind: 'text', label: 'Supplier number' },
      ],
      listItem: { titleFields: ['supplier', 'supplierNumber'] },
    });
    expect(resolveSearchTextFieldKeys(d)).toEqual(['supplierNumber']);
  });

  it('is empty when the type declares no listItem.titleFields at all', () => {
    const d = descriptor({ fields: [{ key: 'description', kind: 'text', label: 'Description' }] });
    expect(resolveSearchTextFieldKeys(d)).toEqual([]);
  });
});
