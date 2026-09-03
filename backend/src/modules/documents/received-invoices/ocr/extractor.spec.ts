import { ExtractorNotReadyError, ReceivedDocumentExtractorRegistry } from './extractor';

describe('ReceivedDocumentExtractorRegistry', () => {
  it('resolves an extractor that was registered and supports the mime', () => {
    const registry = new ReceivedDocumentExtractorRegistry();
    const extractor = {
      id: 'stub',
      supports: (mime: string) => mime === 'application/pdf',
      extract: jest.fn(),
    };
    registry.register(extractor);

    expect(registry.resolveFor('application/pdf')).toBe(extractor);
  });

  it('returns undefined — never throws — when nothing is registered at all (the honest, everyday default)', () => {
    const registry = new ReceivedDocumentExtractorRegistry();

    expect(registry.resolveFor('application/pdf')).toBeUndefined();
  });

  it('returns undefined when something IS registered but declares no support for this mime', () => {
    const registry = new ReceivedDocumentExtractorRegistry();
    registry.register({ id: 'stub', supports: () => false, extract: jest.fn() });

    expect(registry.resolveFor('application/pdf')).toBeUndefined();
  });

  it('resolves the FIRST matching extractor when more than one supports the same mime', () => {
    const registry = new ReceivedDocumentExtractorRegistry();
    const first = { id: 'first', supports: () => true, extract: jest.fn() };
    const second = { id: 'second', supports: () => true, extract: jest.fn() };
    registry.register(first);
    registry.register(second);

    expect(registry.resolveFor('application/pdf')).toBe(first);
  });

  it('lists every registered extractor, id only', () => {
    const registry = new ReceivedDocumentExtractorRegistry();
    registry.register({ id: 'a', supports: () => true, extract: jest.fn() });
    registry.register({ id: 'b', supports: () => true, extract: jest.fn() });

    expect(registry.list()).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('has() reports presence by id without throwing', () => {
    const registry = new ReceivedDocumentExtractorRegistry();
    registry.register({ id: 'stub', supports: () => true, extract: jest.fn() });

    expect(registry.has('stub')).toBe(true);
    expect(registry.has('nope')).toBe(false);
  });

  it('refuses registering the same id twice', () => {
    const registry = new ReceivedDocumentExtractorRegistry();
    registry.register({ id: 'stub', supports: () => true, extract: jest.fn() });

    expect(() => registry.register({ id: 'stub', supports: () => true, extract: jest.fn() })).toThrow(
      /already registered/,
    );
  });

  // The open-registry proof, the same shape `transport-registry.spec.ts`'s own "a third-party
  // transport registers and resolves exactly like the built-in one" already establishes: nothing
  // about this registry, or about `apply-ocr-fallback.ts`, needs to change for a THIRD PARTY to add a
  // brand-new extractor.
  it('a third-party extractor registers and resolves exactly like a built-in one would', async () => {
    const registry = new ReceivedDocumentExtractorRegistry();
    const thirdParty = {
      id: 'acme-ocr',
      supports: (mime: string) => mime === 'application/pdf',
      extract: jest.fn().mockResolvedValue({ fields: { supplier: 'Acme-read supplier' } }),
    };
    registry.register(thirdParty);

    const resolved = registry.resolveFor('application/pdf');
    expect(resolved).toBe(thirdParty);
    await expect(resolved!.extract(new Uint8Array(), 'application/pdf')).resolves.toEqual({
      fields: { supplier: 'Acme-read supplier' },
    });
  });
});

describe('ExtractorNotReadyError', () => {
  it('carries the extractor id and a human message, named distinctly from a generic Error', () => {
    const err = new ExtractorNotReadyError('mistral-ocr', 'not configured');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ExtractorNotReadyError');
    expect(err.extractorId).toBe('mistral-ocr');
    expect(err.message).toBe('not configured');
  });
});
