import { resolveUserLanguage } from './resolve-user-language';

describe('resolveUserLanguage', () => {
  it("prefers the user's own locale over the company's default", () => {
    expect(resolveUserLanguage('it', 'fr')).toBe('it');
  });

  it("falls back to the company's default when the user has none", () => {
    expect(resolveUserLanguage(undefined, 'fr')).toBe('fr');
    expect(resolveUserLanguage(null, 'fr')).toBe('fr');
    expect(resolveUserLanguage('', 'fr')).toBe('fr');
  });

  it('falls back to English when neither the user nor the company has a usable language', () => {
    expect(resolveUserLanguage(undefined, undefined)).toBe('en');
    expect(resolveUserLanguage(null, null)).toBe('en');
  });

  it('ignores an unsupported user locale and falls through to the company default', () => {
    expect(resolveUserLanguage('es', 'de')).toBe('de');
  });

  it('ignores an unsupported company default too, landing on English', () => {
    expect(resolveUserLanguage(undefined, 'es')).toBe('en');
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(resolveUserLanguage('  IT  ', undefined)).toBe('it');
    expect(resolveUserLanguage(undefined, 'De')).toBe('de');
  });

  it('every one of the five in-scope countries plus English resolves to itself', () => {
    for (const code of ['en', 'fr', 'it', 'pl', 'de', 'pt']) {
      expect(resolveUserLanguage(code, undefined)).toBe(code);
    }
  });
});
