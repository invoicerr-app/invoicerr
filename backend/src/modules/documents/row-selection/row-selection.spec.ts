import { DocumentFieldDescriptor } from '../descriptors/types';
import { FieldKindRegistry } from '../descriptors/field-kinds';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import {
  referencedArrayFieldKeys,
  registerRowSelectionFieldKind,
  ROW_ID_KEY,
  rowIdOf,
  stampRowIds,
  validateRowSelectionShape,
} from './row-selection';

describe('rowSelection — the structural (synchronous) half', () => {
  describe('validateRowSelectionShape', () => {
    const field: DocumentFieldDescriptor = { key: 'picked', kind: 'rowSelection', label: 'Picked' };

    it('accepts a list of non-empty row ids', () => {
      expect(validateRowSelectionShape(['row-1', 'row-2'], { field, data: {} })).toBeNull();
    });

    it("accepts an empty selection — required-ness is validateAgainstDescriptor's own job", () => {
      expect(validateRowSelectionShape([], { field, data: {} })).toBeNull();
    });

    it('rejects a non-array value', () => {
      expect(validateRowSelectionShape('row-1', { field, data: {} })).toMatch(/must be a list/);
    });

    it('rejects a list containing something other than non-empty strings', () => {
      expect(validateRowSelectionShape(['row-1', 42], { field, data: {} })).toMatch(/row ids/);
      expect(validateRowSelectionShape([''], { field, data: {} })).toMatch(/row ids/);
    });

    it('rejects selecting the same row twice', () => {
      expect(validateRowSelectionShape(['row-1', 'row-1'], { field, data: {} })).toMatch(/more than once/);
    });

    it("honours min/max exactly like 'array' does", () => {
      const bounded: DocumentFieldDescriptor = { ...field, min: 1, max: 2 };
      expect(validateRowSelectionShape([], { field: bounded, data: {} })).toMatch(/at least 1/);
      expect(validateRowSelectionShape(['a', 'b', 'c'], { field: bounded, data: {} })).toMatch(/at most 2/);
      expect(validateRowSelectionShape(['a', 'b'], { field: bounded, data: {} })).toBeNull();
    });
  });

  it('registers under "rowSelection", resolvable from FieldKindRegistry exactly like a core kind', () => {
    const registry = new FieldKindRegistry();
    registerRowSelectionFieldKind(registry);
    expect(registry.has('rowSelection')).toBe(true);
    expect(
      registry.resolve('rowSelection')?.(['x'], {
        field: { key: 'x', kind: 'rowSelection', label: 'X' },
        data: {},
      }),
    ).toBeNull();
  });
});

describe('rowSelection — row identity (decision 1)', () => {
  describe('rowIdOf', () => {
    it('reads the stable id off a stamped row', () => {
      expect(rowIdOf({ [ROW_ID_KEY]: 'r1', description: 'Widget' })).toBe('r1');
    });

    it('is undefined for a row nobody has stamped — never fabricated', () => {
      expect(rowIdOf({ description: 'Widget' })).toBeUndefined();
    });

    it('is undefined for anything that is not a plain row object', () => {
      expect(rowIdOf('row')).toBeUndefined();
      expect(rowIdOf(null)).toBeUndefined();
      expect(rowIdOf(['x'])).toBeUndefined();
    });
  });

  const lineFields: DocumentFieldDescriptor[] = [{ key: 'description', kind: 'text', label: 'Designation' }];
  const invoiceFields: DocumentFieldDescriptor[] = [
    { key: 'lines', kind: 'array', label: 'Lines', fields: lineFields },
  ];

  it('stamps a fresh, stable id onto every row of a STAMPABLE array field that lacks one', () => {
    const data = { lines: [{ description: 'Widget' }, { description: 'Gadget' }] };
    const stamped = stampRowIds(invoiceFields, data, new Set(['lines']));

    const lines = stamped.lines as Record<string, unknown>[];
    expect(rowIdOf(lines[0])).toEqual(expect.any(String));
    expect(rowIdOf(lines[1])).toEqual(expect.any(String));
    expect(rowIdOf(lines[0])).not.toEqual(rowIdOf(lines[1]));
  });

  it('is idempotent: a row that already has an id keeps the EXACT same one', () => {
    const data = { lines: [{ [ROW_ID_KEY]: 'existing-id', description: 'Widget' }] };
    const stamped = stampRowIds(invoiceFields, data, new Set(['lines']));
    expect(rowIdOf((stamped.lines as Record<string, unknown>[])[0])).toBe('existing-id');
  });

  it('never mutates the input data or its rows', () => {
    const original = { lines: [{ description: 'Widget' }] };
    const snapshot = JSON.parse(JSON.stringify(original));
    stampRowIds(invoiceFields, original, new Set(['lines']));
    expect(original).toEqual(snapshot);
  });

  it('leaves an array field untouched when it is not in the stampable set', () => {
    const data = { lines: [{ description: 'Widget' }] };
    const stamped = stampRowIds(invoiceFields, data, new Set());
    expect(rowIdOf((stamped.lines as Record<string, unknown>[])[0])).toBeUndefined();
  });

  it('never touches a non-array kind, even one named the same as a stampable key', () => {
    const fields: DocumentFieldDescriptor[] = [{ key: 'lines', kind: 'text', label: 'Lines (not an array)' }];
    const data = { lines: 'not-an-array' };
    expect(stampRowIds(fields, data, new Set(['lines']))).toEqual(data);
  });
});

describe('rowSelection — on-demand identity: only where something currently selects from (decision 1)', () => {
  it('is empty for a type nothing points a rowSelection at', () => {
    const registry = new DocumentTypeRegistry();
    registry.register({
      id: 'quote',
      label: 'Quote',
      fields: [{ key: 'lines', kind: 'array', label: 'Lines', fields: [] }],
      actions: [],
    });

    expect(referencedArrayFieldKeys(registry, 'quote')).toEqual(new Set());
  });

  it('names exactly the array field a REGISTERED rowSelection field points at, nothing more', () => {
    const registry = new DocumentTypeRegistry();
    registry.register({
      id: 'invoice',
      label: 'Invoice',
      fields: [
        { key: 'lines', kind: 'array', label: 'Lines', fields: [] },
        { key: 'notes', kind: 'longText', label: 'Notes' },
      ],
      actions: [],
    });
    registry.register({
      id: 'credit-note',
      label: 'Credit note',
      fields: [
        { key: 'invoice', kind: 'reference', label: 'Invoice', entity: 'invoice' },
        {
          key: 'correctedLines',
          kind: 'rowSelection',
          label: 'Corrected lines',
          sourceField: 'invoice',
          sourceEntity: 'invoice',
          sourceArrayField: 'lines',
        },
      ],
      actions: [],
    });

    expect(referencedArrayFieldKeys(registry, 'invoice')).toEqual(new Set(['lines']));
    expect(referencedArrayFieldKeys(registry, 'credit-note')).toEqual(new Set());
  });
});
