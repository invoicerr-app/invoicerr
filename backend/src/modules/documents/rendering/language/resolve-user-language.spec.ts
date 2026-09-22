import { __resetDefaultLocaleForTests } from './default-locale';
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

  describe('DEFAULT_LOCALE — the instance-wide step between the company default and English', () => {
    const ORIGINAL_ENV = process.env.DEFAULT_LOCALE;

    beforeEach(() => __resetDefaultLocaleForTests());

    afterAll(() => {
      process.env.DEFAULT_LOCALE = ORIGINAL_ENV;
      __resetDefaultLocaleForTests();
    });

    it('is used only when neither the user nor the company has a usable language', () => {
      process.env.DEFAULT_LOCALE = 'fr';
      expect(resolveUserLanguage(undefined, undefined)).toBe('fr');
    });

    it('never overrides a user locale that is actually set', () => {
      process.env.DEFAULT_LOCALE = 'fr';
      expect(resolveUserLanguage('pt', undefined)).toBe('pt');
    });

    it('never overrides a company language that is actually set', () => {
      process.env.DEFAULT_LOCALE = 'fr';
      expect(resolveUserLanguage(undefined, 'de')).toBe('de');
    });

    it('falls through to English when unset', () => {
      delete process.env.DEFAULT_LOCALE;
      expect(resolveUserLanguage(undefined, undefined)).toBe('en');
    });

    // An unsupported DEFAULT_LOCALE value is covered by `default-locale.spec.ts`, which mocks
    // `logger` — see `resolve-recipient-language.spec.ts`'s own identical note for why that case does
    // not belong in this file.
  });
});
