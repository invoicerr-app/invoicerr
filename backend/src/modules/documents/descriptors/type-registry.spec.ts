import { DocumentTypeDescriptor } from './types';
import { DocumentTypeRegistry, UnknownDocumentTypeError } from './type-registry';

function descriptor(id: string): DocumentTypeDescriptor {
  return { id, label: id, fields: [], actions: [] };
}

describe('DocumentTypeRegistry', () => {
  it('resolves a descriptor that was registered', () => {
    const registry = new DocumentTypeRegistry();
    registry.register(descriptor('quote'));

    expect(registry.resolve('quote').id).toBe('quote');
  });

  it('lists every registered descriptor', () => {
    const registry = new DocumentTypeRegistry();
    registry.register(descriptor('quote'));
    registry.register(descriptor('invoice'));

    expect(
      registry
        .list()
        .map((d) => d.id)
        .sort(),
    ).toEqual(['invoice', 'quote']);
  });

  it('refuses an unknown document type cleanly, instead of returning undefined', () => {
    const registry = new DocumentTypeRegistry();
    registry.register(descriptor('quote'));

    expect(() => registry.resolve('invoice')).toThrow(UnknownDocumentTypeError);
    expect(() => registry.resolve('invoice')).toThrow(/Unknown document type "invoice"/);
  });

  it('refuses registering the same id twice', () => {
    const registry = new DocumentTypeRegistry();
    registry.register(descriptor('quote'));

    expect(() => registry.register(descriptor('quote'))).toThrow(/already registered/);
  });

  it('has() reports presence without throwing', () => {
    const registry = new DocumentTypeRegistry();
    registry.register(descriptor('quote'));

    expect(registry.has('quote')).toBe(true);
    expect(registry.has('invoice')).toBe(false);
  });
});
