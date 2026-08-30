import { DocumentFieldDescriptor } from '../descriptors/types';
import { applyFieldOverlay, cloneFields, FieldOverlayError } from './apply-overlay';
import { FieldOverlayOperation } from './schema';

const TRUNK_FIELDS: DocumentFieldDescriptor[] = [
  { key: 'client', kind: 'reference', label: 'Client', required: true, entity: 'client' },
  {
    key: 'currency',
    kind: 'select',
    label: 'Currency',
    required: true,
    options: [{ value: 'EUR', label: 'EUR' }],
  },
  {
    key: 'lines',
    kind: 'array',
    label: 'Lines',
    required: true,
    min: 1,
    fields: [
      { key: 'description', kind: 'text', label: 'Designation', required: true },
      { key: 'quantity', kind: 'number', label: 'Quantity', required: true, min: 0 },
      { key: 'unitPrice', kind: 'money', label: 'Unit price', required: true, min: 0 },
    ],
  },
];

describe('applyFieldOverlay — a country with NO overlay gets the trunk intact', () => {
  it('returns the exact same VALUES for an empty operations list', () => {
    const result = applyFieldOverlay(TRUNK_FIELDS, []);
    expect(result).toEqual(TRUNK_FIELDS);
  });

  it('never returns the SAME object identity, even with no operations — never lets a caller mutate the shared trunk', () => {
    const result = applyFieldOverlay(TRUNK_FIELDS, []);
    expect(result).not.toBe(TRUNK_FIELDS);
    expect(result[2]).not.toBe(TRUNK_FIELDS[2]); // the nested 'lines' field, too
    expect(result[2].fields).not.toBe(TRUNK_FIELDS[2].fields);

    // Mutating the result must never reach the original trunk fields.
    result.push({ key: 'rogue', kind: 'text', label: 'Rogue' });
    (result[2].fields as DocumentFieldDescriptor[]).push({
      key: 'rogue-row',
      kind: 'text',
      label: 'Rogue row',
    });
    expect(TRUNK_FIELDS).toHaveLength(3);
    expect(TRUNK_FIELDS[2].fields).toHaveLength(3);
  });
});

describe('applyFieldOverlay — add', () => {
  it('adds a new TOP-LEVEL field', () => {
    const operations: FieldOverlayOperation[] = [
      { op: 'add', path: '', field: { key: 'siren', kind: 'text', label: 'SIREN', required: true } },
    ];
    const result = applyFieldOverlay(TRUNK_FIELDS, operations);

    expect(result.map((f) => f.key)).toEqual(['client', 'currency', 'lines', 'siren']);
    expect(result.find((f) => f.key === 'siren')).toEqual({
      key: 'siren',
      kind: 'text',
      label: 'SIREN',
      required: true,
    });
  });

  it('adds a new field NESTED inside an array field (path targets the row shape)', () => {
    const operations: FieldOverlayOperation[] = [
      {
        op: 'add',
        path: 'lines',
        field: { key: 'discount', kind: 'number', label: 'Discount', required: false },
      },
    ];
    const result = applyFieldOverlay(TRUNK_FIELDS, operations);

    const lines = result.find((f) => f.key === 'lines');
    expect(lines?.fields?.map((f) => f.key)).toEqual(['description', 'quantity', 'unitPrice', 'discount']);
  });

  it('refuses to add a field whose key already exists — loudly, not a silent overwrite', () => {
    const operations: FieldOverlayOperation[] = [
      { op: 'add', path: '', field: { key: 'client', kind: 'text', label: 'Rogue client' } },
    ];
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(FieldOverlayError);
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(/already exists/);
  });
});

describe('applyFieldOverlay — modify', () => {
  it('patches an existing TOP-LEVEL field, keeping every untouched property', () => {
    const operations: FieldOverlayOperation[] = [
      { op: 'modify', path: '', key: 'client', patch: { required: false, helpText: 'Optional here.' } },
    ];
    const result = applyFieldOverlay(TRUNK_FIELDS, operations);

    expect(result.find((f) => f.key === 'client')).toEqual({
      key: 'client',
      kind: 'reference',
      label: 'Client',
      required: false,
      entity: 'client',
      helpText: 'Optional here.',
    });
  });

  it('patches a field NESTED inside an array field', () => {
    const operations: FieldOverlayOperation[] = [
      { op: 'modify', path: 'lines', key: 'unitPrice', patch: { label: 'Prix unitaire HT' } },
    ];
    const result = applyFieldOverlay(TRUNK_FIELDS, operations);

    const lines = result.find((f) => f.key === 'lines');
    expect(lines?.fields?.find((f) => f.key === 'unitPrice')?.label).toBe('Prix unitaire HT');
    // Every other row field is untouched.
    expect(lines?.fields?.find((f) => f.key === 'description')).toEqual(
      TRUNK_FIELDS[2].fields?.find((f) => f.key === 'description'),
    );
  });

  it('refuses to modify a field that does not exist — loudly, not a silent no-op', () => {
    const operations: FieldOverlayOperation[] = [
      { op: 'modify', path: '', key: 'ghost', patch: { required: false } },
    ];
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(FieldOverlayError);
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(/does not exist/);
  });
});

describe('applyFieldOverlay — remove', () => {
  it('removes an existing TOP-LEVEL field', () => {
    const operations: FieldOverlayOperation[] = [{ op: 'remove', path: '', key: 'currency' }];
    const result = applyFieldOverlay(TRUNK_FIELDS, operations);

    expect(result.map((f) => f.key)).toEqual(['client', 'lines']);
  });

  it('removes a field NESTED inside an array field', () => {
    const operations: FieldOverlayOperation[] = [{ op: 'remove', path: 'lines', key: 'quantity' }];
    const result = applyFieldOverlay(TRUNK_FIELDS, operations);

    const lines = result.find((f) => f.key === 'lines');
    expect(lines?.fields?.map((f) => f.key)).toEqual(['description', 'unitPrice']);
  });

  it('refuses to remove a field that does not exist — loudly, not a silent no-op', () => {
    const operations: FieldOverlayOperation[] = [{ op: 'remove', path: '', key: 'ghost' }];
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(FieldOverlayError);
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(/does not exist/);
  });
});

describe('applyFieldOverlay — path resolution errors', () => {
  it('refuses a path naming a field that does not exist', () => {
    const operations: FieldOverlayOperation[] = [{ op: 'remove', path: 'nope', key: 'x' }];
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(/does not name a field/);
  });

  it("refuses a path naming a field that is not an 'array' field", () => {
    const operations: FieldOverlayOperation[] = [{ op: 'remove', path: 'currency', key: 'x' }];
    expect(() => applyFieldOverlay(TRUNK_FIELDS, operations)).toThrow(/not an 'array' field/);
  });
});

describe('applyFieldOverlay — operations compose in order', () => {
  it('applies add, then modify, then remove, each seeing the previous operation’s result', () => {
    const operations: FieldOverlayOperation[] = [
      { op: 'add', path: '', field: { key: 'siren', kind: 'text', label: 'SIREN' } },
      { op: 'modify', path: '', key: 'siren', patch: { required: true } },
      { op: 'remove', path: '', key: 'currency' },
    ];
    const result = applyFieldOverlay(TRUNK_FIELDS, operations);

    expect(result.map((f) => f.key)).toEqual(['client', 'lines', 'siren']);
    expect(result.find((f) => f.key === 'siren')?.required).toBe(true);
  });
});

describe('cloneFields', () => {
  it('deep-clones nested array fields and option lists — no shared references anywhere', () => {
    const cloned = cloneFields(TRUNK_FIELDS);
    expect(cloned).toEqual(TRUNK_FIELDS);
    expect(cloned[1].options).not.toBe(TRUNK_FIELDS[1].options);
    expect(cloned[2].fields).not.toBe(TRUNK_FIELDS[2].fields);
  });
});
