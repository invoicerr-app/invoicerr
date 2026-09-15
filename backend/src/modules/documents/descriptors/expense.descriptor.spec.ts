import { DocumentTypeRegistry } from './type-registry';
import { buildExpenseDescriptor } from './expense.descriptor';

/**
 * TODO_FEATURES.md rank 13 ("notes de frais enrichies") — the descriptor's own shape, independent of
 * DocumentsService wiring, same split `received-invoice.descriptor.spec.ts` already holds for its own
 * type. The "suppression" behaviour the frontend's "Remove" button relies on (clearing the field and
 * saving) is proven separately below, against `persistence.ts#upsertDocument` directly — see that
 * describe block's own header.
 */
describe('expense.descriptor — passes validateLifecycle and has the declared shape', () => {
  it('registers without throwing — the lifecycle declaration is internally consistent', () => {
    const registry = new DocumentTypeRegistry();
    expect(() => registry.register(buildExpenseDescriptor())).not.toThrow();
  });

  it('declares the nine expected fields, no fewer, no more', () => {
    const descriptor = buildExpenseDescriptor();
    expect(descriptor.fields.map((f) => f.key).sort()).toEqual(
      [
        'description',
        'amount',
        'currency',
        'date',
        'category',
        'attachment',
        'distanceKm',
        'ratePerKm',
        'notes',
      ].sort(),
    );
  });

  it('"attachment" is the 12th core kind, "file", optional', () => {
    const descriptor = buildExpenseDescriptor();
    const attachment = descriptor.fields.find((f) => f.key === 'attachment');
    expect(attachment?.kind).toBe('file');
    expect(attachment?.required).toBe(false);
  });

  it('"category" is a select with NO trunk options — a per-company view fills it in, never allowCustomValue', () => {
    // Product decision 2026-09-15 (see this file's own header): the closed, hardcoded catalog this
    // test used to assert on is GONE — categories are per-company data now
    // (expense-categories/persistence.ts), composed onto this exact field via
    // `applyExpenseCategoriesView` at describeTypeForCompany/runAction time, never present on the
    // TRUNK descriptor itself. See documents.service.expense-categories.spec.ts for the composed view.
    const descriptor = buildExpenseDescriptor();
    const category = descriptor.fields.find((f) => f.key === 'category');
    expect(category?.kind).toBe('select');
    expect(category?.required).toBe(false);
    expect(category?.allowCustomValue).toBeUndefined();
    expect(category?.options).toEqual([]);
  });

  it('"distanceKm"/"ratePerKm" ("kilométrage") are plain, optional, non-negative — no per-country rate baked in', () => {
    const descriptor = buildExpenseDescriptor();
    const distanceKm = descriptor.fields.find((f) => f.key === 'distanceKm');
    const ratePerKm = descriptor.fields.find((f) => f.key === 'ratePerKm');

    expect(distanceKm?.kind).toBe('number');
    expect(distanceKm?.required).toBe(false);
    expect(distanceKm?.min).toBe(0);

    expect(ratePerKm?.kind).toBe('money');
    expect(ratePerKm?.required).toBe(false);
    expect(ratePerKm?.min).toBe(0);
    expect(ratePerKm?.currencyField).toBe('currency');
  });

  it('every new field is required: false — an enrichment, never a new requirement on an existing expense', () => {
    const descriptor = buildExpenseDescriptor();
    // Jest's `expect` (unlike Chai's) takes no assertion message — the key under test is put IN the
    // compared value instead, so a failure still names which field broke (list-item.spec.ts's own
    // convention).
    for (const key of ['category', 'attachment', 'distanceKm', 'ratePerKm']) {
      const field = descriptor.fields.find((f) => f.key === key);
      expect({ key, required: field?.required }).toEqual({ key, required: false });
    }
  });

  it('listItem now also surfaces category, after amount/date', () => {
    const descriptor = buildExpenseDescriptor();
    expect(descriptor.listItem).toEqual({
      titleFields: ['description'],
      secondaryFields: ['amount', 'date', 'category'],
    });
  });

  it('still declares no numbering, no non-"draft" status — unchanged by this rank', () => {
    const descriptor = buildExpenseDescriptor();
    expect(descriptor.numbering).toBeUndefined();
    expect(descriptor.statuses?.map((s) => s.id)).toEqual(['draft']);
  });
});
