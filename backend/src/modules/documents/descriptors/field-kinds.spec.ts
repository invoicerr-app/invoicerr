import { FieldKindRegistry, registerCoreFieldKinds } from './field-kinds';
import { validateAgainstDescriptor } from './validate';

describe('FieldKindRegistry', () => {
  it('registers and resolves the 10 core kinds', () => {
    const registry = new FieldKindRegistry();
    registerCoreFieldKinds(registry);

    for (const kind of [
      'text',
      'longText',
      'number',
      'money',
      'date',
      'boolean',
      'select',
      'reference',
      'array',
      'rowSelection',
    ]) {
      expect(registry.has(kind)).toBe(true);
    }
  });

  it('refuses registering the same kind twice', () => {
    const registry = new FieldKindRegistry();
    registry.register('text', () => null);

    expect(() => registry.register('text', () => null)).toThrow(/already registered/);
  });

  it('is undefined, not thrown, for a kind nobody registered', () => {
    const registry = new FieldKindRegistry();
    expect(registry.resolve('plugin:acme.rating')).toBeUndefined();
  });

  // The point of the open registry: a plugin registers a new kind under a PREFIXED name and it is
  // immediately usable — no change to DocumentTypeRegistry, ActionRegistry, or the validation
  // orchestrator (validate.ts).
  it('a plugin-registered, prefixed kind validates data exactly like a core one', () => {
    const registry = new FieldKindRegistry();
    registerCoreFieldKinds(registry);
    registry.register('plugin:acme.rating', (value) =>
      typeof value === 'number' && value >= 1 && value <= 5 ? null : 'must be a rating from 1 to 5.',
    );

    const fields = [{ key: 'rating', kind: 'plugin:acme.rating', label: 'Rating', required: true }];

    expect(validateAgainstDescriptor(fields, { rating: 4 }, registry)).toEqual([]);
    expect(validateAgainstDescriptor(fields, { rating: 9 }, registry)).toEqual([
      { key: 'rating', message: '"Rating" must be a rating from 1 to 5.' },
    ]);
  });

  describe("'reference' — single- vs multi-target", () => {
    const registry = new FieldKindRegistry();
    registerCoreFieldKinds(registry);

    it('a SINGLE-target field (entity) keeps accepting a bare id string — unchanged behaviour', () => {
      const field = { key: 'client', kind: 'reference', label: 'Client', entity: 'client' };
      expect(validateAgainstDescriptor([field], { client: 'client-1' }, registry)).toEqual([]);
      expect(validateAgainstDescriptor([field], { client: '' }, registry)).toEqual([]); // empty ⇒ "missing", not invalid
      expect(validateAgainstDescriptor([field], { client: { entity: 'client', id: 'x' } }, registry)).toEqual(
        [{ key: 'client', message: '"Client" must reference an existing record.' }],
      );
    });

    it('a MULTI-target field (entities) requires the `{ entity, id }` shape, not a bare id', () => {
      const field = { key: 'origin', kind: 'reference', label: 'Origin', entities: ['quote', 'invoice'] };

      expect(validateAgainstDescriptor([field], { origin: { entity: 'quote', id: 'q1' } }, registry)).toEqual(
        [],
      );
      expect(
        validateAgainstDescriptor([field], { origin: { entity: 'invoice', id: 'i1' } }, registry),
      ).toEqual([]);
      expect(validateAgainstDescriptor([field], { origin: 'q1' }, registry)).toEqual([
        { key: 'origin', message: '"Origin" must reference an existing record (with its type).' },
      ]);
    });

    it('a MULTI-target field rejects an entity outside its declared list', () => {
      const field = { key: 'origin', kind: 'reference', label: 'Origin', entities: ['quote', 'invoice'] };

      expect(
        validateAgainstDescriptor([field], { origin: { entity: 'client', id: 'c1' } }, registry),
      ).toEqual([{ key: 'origin', message: '"Origin" must reference one of: quote, invoice.' }]);
    });
  });

  describe("'select' — allowCustomValue is an escape hatch for an EMPTY list only", () => {
    const registry = new FieldKindRegistry();
    registerCoreFieldKinds(registry);

    it('without allowCustomValue, a value outside the (non-empty) options is rejected — unchanged behaviour', () => {
      const field = {
        key: 'vatRate',
        kind: 'select',
        label: 'VAT rate',
        options: [{ value: '20', label: '20%' }],
      };
      expect(validateAgainstDescriptor([field], { vatRate: '20' }, registry)).toEqual([]);
      expect(validateAgainstDescriptor([field], { vatRate: '19' }, registry)).toEqual([
        { key: 'vatRate', message: '"VAT rate" is not one of the offered choices.' },
      ]);
    });

    it('allowCustomValue accepts ANYTHING when options is empty — the "no known catalog" case', () => {
      const field = {
        key: 'vatRate',
        kind: 'select',
        label: 'VAT rate',
        options: [],
        allowCustomValue: true,
      };
      expect(validateAgainstDescriptor([field], { vatRate: '17.5' }, registry)).toEqual([]);
      expect(validateAgainstDescriptor([field], { vatRate: 'whatever' }, registry)).toEqual([]);
    });

    it('allowCustomValue does NOT bypass a known, NON-EMPTY list — a scripted client cannot go around a real catalog', () => {
      const field = {
        key: 'vatRate',
        kind: 'select',
        label: 'VAT rate',
        options: [{ value: '20', label: '20%' }],
        allowCustomValue: true,
      };
      expect(validateAgainstDescriptor([field], { vatRate: '20' }, registry)).toEqual([]);
      expect(validateAgainstDescriptor([field], { vatRate: '17.5' }, registry)).toEqual([
        { key: 'vatRate', message: '"VAT rate" is not one of the offered choices.' },
      ]);
    });
  });

  // Root TODO item 16 follow-up (2026-09-01) — a REAL bug this task's own Cypress extension caught,
  // never a jest test: `resolveInvoiceCrossBorderTax` (documents/tax/resolve-invoice-tax.ts) replaces
  // a line's `vatRate` with a FOREIGN destination country's real rate (e.g. Germany's 19% for a FR
  // seller's OSS sale) and persists it as `instance.data` at "sending". `queue/processors/document-
  // action.processor.ts` then REPLAYS the send action through `DocumentsService.runAction` — which
  // re-validates that SAME data against this exact 'select' validator, using the SELLER's own
  // (FR) vatRate catalog. Every existing B2B case (reverse charge/intra-Community/export) resolves to
  // 0%, which happens to already be a valid FR rate — so this never surfaced until a REAL non-zero
  // OSS destination rate (this task's own de.json et al.) reached a genuine end-to-end send and threw
  // "Invalid document data" (verified live: `35-cross-border-tax.cy.ts`'s new OSS test failed with
  // exactly this error before the fix below, confirmed by fetching the failed document over the API —
  // `lastActionError: "Invalid document data"`, `data.lines[0].vatRate: "19"` already correctly
  // resolved). Fixed by a NARROW, additive exception — never a relaxation of `allowCustomValue`'s own
  // contract, proven unchanged by the three tests above.
  describe("'select' with usesVatRateCatalog — a cross-border-resolved row is exempt from the seller's own catalog", () => {
    const registry = new FieldKindRegistry();
    registerCoreFieldKinds(registry);
    const vatRateField = {
      key: 'vatRate',
      kind: 'select',
      label: 'VAT rate',
      options: [{ value: '20', label: '20%' }], // the SELLER's own (FR) catalog — 19% is foreign to it
      usesVatRateCatalog: true,
    };

    it('a row carrying __crossBorderCategory accepts a rate foreign to the seller catalog (the OSS destination rate)', () => {
      expect(
        validateAgainstDescriptor([vatRateField], { vatRate: '19', __crossBorderCategory: 'S' }, registry),
      ).toEqual([]);
    });

    it('a NORMAL row (no __crossBorderCategory) is still refused a value foreign to the seller catalog — the exception never leaks to ordinary drafts', () => {
      expect(validateAgainstDescriptor([vatRateField], { vatRate: '19' }, registry)).toEqual([
        { key: 'vatRate', message: '"VAT rate" is not one of the offered choices.' },
      ]);
    });

    it('a select field that does NOT declare usesVatRateCatalog gets no such exception, even with __crossBorderCategory present', () => {
      const otherField = { ...vatRateField, usesVatRateCatalog: undefined };
      expect(
        validateAgainstDescriptor([otherField], { vatRate: '19', __crossBorderCategory: 'S' }, registry),
      ).toEqual([{ key: 'vatRate', message: '"VAT rate" is not one of the offered choices.' }]);
    });
  });
});
