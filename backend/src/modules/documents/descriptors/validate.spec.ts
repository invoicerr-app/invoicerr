import { FieldKindRegistry, registerCoreFieldKinds } from './field-kinds';
import { DocumentFieldDescriptor } from './types';
import { validateAgainstDescriptor } from './validate';

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
