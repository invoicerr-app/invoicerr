import { FieldKindRegistry, registerCoreFieldKinds } from './field-kinds';
import { DocumentFieldDescriptor } from './types';
import { stripSidecarKeys, validateAgainstDescriptor } from './validate';

describe('validateAgainstDescriptor', () => {
  const registry = new FieldKindRegistry();
  registerCoreFieldKinds(registry);

  const lineFields: DocumentFieldDescriptor[] = [
    { key: 'description', kind: 'text', label: 'Designation', required: true },
    { key: 'quantity', kind: 'number', label: 'Quantity', required: true, min: 0 },
  ];

  const fields: DocumentFieldDescriptor[] = [
    { key: 'client', kind: 'reference', label: 'Client', required: true, entity: 'client' },
    { key: 'notes', kind: 'longText', label: 'Notes', required: false },
    {
      key: 'currency',
      kind: 'select',
      label: 'Currency',
      required: true,
      options: [{ value: 'EUR', label: 'EUR' }],
    },
    { key: 'lines', kind: 'array', label: 'Lines', required: true, fields: lineFields },
  ];

  it('accepts fully valid data', () => {
    const errors = validateAgainstDescriptor(
      fields,
      {
        client: 'client-1',
        currency: 'EUR',
        lines: [{ description: 'Widget', quantity: 2 }],
      },
      registry,
    );
    expect(errors).toEqual([]);
  });

  it('reports a missing required field', () => {
    const errors = validateAgainstDescriptor(fields, { currency: 'EUR', lines: [] }, registry);
    expect(errors).toContainEqual({ key: 'client', message: '"Client" is required.' });
  });

  it('does not require an optional field', () => {
    const errors = validateAgainstDescriptor(
      fields,
      { client: 'client-1', currency: 'EUR', lines: [{ description: 'Widget', quantity: 1 }] },
      registry,
    );
    expect(errors.find((e) => e.key === 'notes')).toBeUndefined();
  });

  it('rejects a select value outside the offered options', () => {
    const errors = validateAgainstDescriptor(
      fields,
      { client: 'client-1', currency: 'XXX', lines: [{ description: 'Widget', quantity: 1 }] },
      registry,
    );
    expect(errors).toContainEqual({
      key: 'currency',
      message: '"Currency" is not one of the offered choices.',
    });
  });

  it('recurses into array rows and reports errors with an indexed path', () => {
    const errors = validateAgainstDescriptor(
      fields,
      { client: 'client-1', currency: 'EUR', lines: [{ description: '', quantity: -1 }] },
      registry,
    );
    expect(errors).toContainEqual({ key: 'lines[0].description', message: '"Designation" is required.' });
    expect(errors).toContainEqual({ key: 'lines[0].quantity', message: '"Quantity" must be at least 0.' });
  });

  it('reports an unknown field kind instead of silently skipping it', () => {
    const withUnknownKind: DocumentFieldDescriptor[] = [
      { key: 'rating', kind: 'plugin:acme.rating', label: 'Rating' },
    ];
    const errors = validateAgainstDescriptor(withUnknownKind, { rating: 5 }, registry);
    expect(errors).toEqual([
      {
        key: 'rating',
        message: '"Rating" has field kind "plugin:acme.rating", which no validator is registered for.',
      },
    ]);
  });
});

describe('stripSidecarKeys', () => {
  it('removes every top-level key starting with "__", keeps everything else untouched', () => {
    const data = { client: 'client-1', __crossBorderMentions: [{ text: 'fabricated' }], notes: 'hello' };
    expect(stripSidecarKeys([], data)).toEqual({ client: 'client-1', notes: 'hello' });
  });

  it('recurses into declared "array" field rows, stripping each row\'s own "__" keys', () => {
    const lineFields: DocumentFieldDescriptor[] = [
      { key: 'description', kind: 'text', label: 'Designation' },
      { key: 'vatRate', kind: 'select', label: 'VAT rate', options: [] },
    ];
    const fields: DocumentFieldDescriptor[] = [
      { key: 'lines', kind: 'array', label: 'Lines', fields: lineFields },
    ];
    const data = {
      lines: [
        {
          description: 'Widget',
          vatRate: '20',
          __crossBorderCategory: 'AE',
          __crossBorderExemptionReason: 'x',
        },
      ],
    };

    const cleaned = stripSidecarKeys(fields, data);

    expect(cleaned.lines).toEqual([{ description: 'Widget', vatRate: '20' }]);
  });

  it('never mutates the original object — a caller still holding a reference sees it unchanged', () => {
    const original = { __crossBorderMentions: 'x', client: 'client-1' };
    const cleaned = stripSidecarKeys([], original);
    expect(original).toEqual({ __crossBorderMentions: 'x', client: 'client-1' });
    expect(cleaned).not.toBe(original);
  });

  it('a row that is not itself an object (or an array field with no declared row fields) is left as-is, never crashes', () => {
    const fields: DocumentFieldDescriptor[] = [{ key: 'lines', kind: 'array', label: 'Lines' }];
    expect(stripSidecarKeys(fields, { lines: ['not-an-object', 42, null] })).toEqual({
      lines: ['not-an-object', 42, null],
    });
    expect(stripSidecarKeys(fields, { lines: 'not-an-array' })).toEqual({ lines: 'not-an-array' });
  });

  it('a document with no sidecar keys at all round-trips unchanged (structurally)', () => {
    const data = { client: 'client-1', lines: [{ description: 'Widget' }] };
    expect(stripSidecarKeys([{ key: 'lines', kind: 'array', label: 'Lines', fields: [] }], data)).toEqual(
      data,
    );
  });
});
