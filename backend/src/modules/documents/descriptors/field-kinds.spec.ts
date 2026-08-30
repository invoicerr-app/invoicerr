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
});
