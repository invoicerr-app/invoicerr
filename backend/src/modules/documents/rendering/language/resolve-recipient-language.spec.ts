import { resolveRecipientLanguage } from './resolve-recipient-language';

describe('resolveRecipientLanguage', () => {
  it("prefers the client's own language over the company's default", () => {
    expect(resolveRecipientLanguage('it', 'fr')).toBe('it');
  });

  it("falls back to the company's default when the client has none", () => {
    expect(resolveRecipientLanguage(undefined, 'fr')).toBe('fr');
    expect(resolveRecipientLanguage(null, 'fr')).toBe('fr');
    expect(resolveRecipientLanguage('', 'fr')).toBe('fr');
  });

  it('falls back to English when neither the client nor the company has a usable language', () => {
    expect(resolveRecipientLanguage(undefined, undefined)).toBe('en');
    expect(resolveRecipientLanguage(null, null)).toBe('en');
  });

  it('ignores an unsupported client language and falls through to the company default', () => {
    // 'es' (Spanish) is not in SUPPORTED_RENDER_LANGUAGES — this product operates FR/PL/IT/PT/DE, not
    // Spain, so the render layer carries no strings for it yet (see supported-languages.ts's own
    // header). Never guessed, never thrown — just skipped, exactly like a garbage value would be.
    expect(resolveRecipientLanguage('es', 'de')).toBe('de');
  });

  it('ignores an unsupported company default too, landing on English', () => {
    expect(resolveRecipientLanguage(undefined, 'es')).toBe('en');
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(resolveRecipientLanguage('  IT  ', undefined)).toBe('it');
    expect(resolveRecipientLanguage(undefined, 'De')).toBe('de');
  });

  it('every one of the five in-scope countries plus English resolves to itself', () => {
    for (const code of ['en', 'fr', 'it', 'pl', 'de', 'pt']) {
      expect(resolveRecipientLanguage(code, undefined)).toBe(code);
    }
  });
});
