import { normalizeSignupLocale } from './signup-locale';

describe('normalizeSignupLocale', () => {
  it('keeps a supported language as-is', () => {
    expect(normalizeSignupLocale('fr')).toBe('fr');
    expect(normalizeSignupLocale('de')).toBe('de');
  });

  it('lowercases and trims before checking', () => {
    expect(normalizeSignupLocale('  IT  ')).toBe('it');
    expect(normalizeSignupLocale('Pl')).toBe('pl');
  });

  it('drops an unsupported language to null instead of storing garbage', () => {
    // 'ar' is a real, non-beta UI language on the frontend picker (see `lib/i18n.ts`'s own
    // SUPPORTED_LANGUAGES) but this render layer carries no strings for it — see
    // `supported-languages.ts`'s own header for why that gap is deliberate.
    expect(normalizeSignupLocale('ar')).toBeNull();
    expect(normalizeSignupLocale('es')).toBeNull();
    expect(normalizeSignupLocale('zh-CN')).toBeNull();
  });

  it('drops a missing/malformed value to null rather than throwing', () => {
    expect(normalizeSignupLocale(undefined)).toBeNull();
    expect(normalizeSignupLocale(null)).toBeNull();
    expect(normalizeSignupLocale(42)).toBeNull();
    expect(normalizeSignupLocale('')).toBeNull();
  });
});
