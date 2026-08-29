import { FieldKindRegistry, registerCoreFieldKinds } from './field-kinds';
import { validateAgainstDescriptor } from './validate';

describe('FieldKindRegistry', () => {
  it('registers and resolves the 9 core kinds', () => {
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
});
