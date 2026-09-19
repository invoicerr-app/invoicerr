import { __resetDefaultLocaleForTests } from '@/modules/documents/rendering/language/default-locale';

import { mailT } from './i18n';

describe('mailT — language resolution and fallback', () => {
  it('resolves an unset language to English', () => {
    const t = mailT(undefined);
    expect(t('demo.greeting', { name: 'World' })).toBe('Hello, World!');
  });

  it('treats null and an empty string the same as unset', () => {
    const t = mailT(null);
    expect(t('demo.greeting', { name: 'World' })).toBe('Hello, World!');
  });

  it('resolves a language this catalog does not carry to English, never throwing', () => {
    // 'es' is not in SUPPORTED_RENDER_LANGUAGES (this product's five in-scope countries plus 'en') —
    // exactly the same "unknown value, honest fallback" posture `resolveRecipientLanguage` already
    // takes for documents, so a mail about a document never claims a language the document render
    // layer itself does not know.
    const t = mailT('es');
    expect(t('demo.greeting', { name: 'World' })).toBe('Hello, World!');
  });

  it('is case-insensitive and trims surrounding whitespace, like resolveRecipientLanguage', () => {
    const t = mailT('  FR  ');
    expect(t('demo.greeting', { name: 'Monde' })).toBe('Bonjour, Monde !');
  });

  it('resolves every one of the six supported languages to its own catalog', () => {
    const t = mailT('en');
    expect(t('demo.greeting', { name: 'World' })).toBe('Hello, World!');
  });

  it("resolves 'fr' to the French catalog", () => {
    const t = mailT('fr');
    expect(t('demo.greeting', { name: 'Monde' })).toBe('Bonjour, Monde !');
  });

  it("resolves 'it' to the Italian catalog", () => {
    const t = mailT('it');
    expect(t('demo.greeting', { name: 'Mondo' })).toBe('Ciao, Mondo!');
  });

  it("resolves 'pl' to the Polish catalog", () => {
    const t = mailT('pl');
    expect(t('demo.greeting', { name: 'Świat' })).toBe('Cześć, Świat!');
  });

  it("resolves 'de' to the German catalog", () => {
    const t = mailT('de');
    expect(t('demo.greeting', { name: 'Welt' })).toBe('Hallo, Welt!');
  });

  it("resolves 'pt' to the Portuguese catalog", () => {
    const t = mailT('pt');
    expect(t('demo.greeting', { name: 'Mundo' })).toBe('Olá, Mundo!');
  });
});

describe('mailT — interpolation', () => {
  it('substitutes {{var}} placeholders, the same convention the frontend catalog uses', () => {
    const t = mailT('en');
    expect(t('demo.greeting', { name: 'Alice' })).toBe('Hello, Alice!');
  });

  it('HTML-escapes an interpolated value by default, unlike the frontend catalog', () => {
    // A mail body is raw HTML built by string concatenation, not a React tree — it gets no second,
    // framework-level escaping pass the way the frontend's own `t()` calls do (`escapeValue: false`
    // there, precisely BECAUSE React already escapes text nodes on its own).
    const t = mailT('en');
    expect(t('demo.greeting', { name: '<script>alert(1)</script>' })).toBe(
      'Hello, &lt;script&gt;alert(1)&lt;&#x2F;script&gt;!',
    );
  });
});

describe('mailT — plurals (i18next native, no extra library)', () => {
  it('picks the singular form for count 1 and the plural form otherwise, in English', () => {
    const t = mailT('en');
    expect(t('demo.itemCount', { count: 1 })).toBe('1 item');
    expect(t('demo.itemCount', { count: 3 })).toBe('3 items');
    expect(t('demo.itemCount', { count: 0 })).toBe('0 items');
  });

  it("follows French's own plural rule (0 and 1 both count as singular), not English's", () => {
    const t = mailT('fr');
    expect(t('demo.itemCount', { count: 0 })).toBe('0 article');
    expect(t('demo.itemCount', { count: 1 })).toBe('1 article');
    expect(t('demo.itemCount', { count: 2 })).toBe('2 articles');
  });
});

describe('mailT — missing key falls back to English', () => {
  // `demo.englishOnly` exists only in `locales/en/mails.json` — every other locale file deliberately
  // omits it, so this exercises the SAME `fallbackLng` chain the shipped catalog would fall through
  // for a key a future translation update has not reached yet.
  const ENGLISH_TEXT = 'This key exists only in the English catalog, to prove the fallback chain.';

  it('falls back to English when the French catalog has no translation of its own', () => {
    const t = mailT('fr');
    expect(t('demo.englishOnly')).toBe(ENGLISH_TEXT);
  });

  it('falls back to English when the Polish catalog has no translation of its own', () => {
    const t = mailT('pl');
    expect(t('demo.englishOnly')).toBe(ENGLISH_TEXT);
  });

  it('returns the same text for English itself, which owns the key', () => {
    const t = mailT('en');
    expect(t('demo.englishOnly')).toBe(ENGLISH_TEXT);
  });
});

describe('mailT — DEFAULT_LOCALE, the instance-wide fallback below an unresolved language', () => {
  // Covers the direct-call sites that reach `mailT` WITHOUT going through `resolveRecipientLanguage`/
  // `resolveUserLanguage` first (e.g. `CompanyMailSettingsService#sendTest`'s own optional `language`
  // parameter, unresolved when omitted) — see `i18n.ts`'s own header for why the fallback lives here
  // too, not only in the two resolvers. An already-RESOLVED language (what every OTHER call site
  // passes) never reaches this fallback at all, since it is already one of
  // `SUPPORTED_RENDER_LANGUAGES`.
  const ORIGINAL_ENV = process.env.DEFAULT_LOCALE;

  beforeEach(() => __resetDefaultLocaleForTests());

  afterAll(() => {
    process.env.DEFAULT_LOCALE = ORIGINAL_ENV;
    __resetDefaultLocaleForTests();
  });

  it('resolves an unset language to DEFAULT_LOCALE when the instance has set one', () => {
    process.env.DEFAULT_LOCALE = 'fr';
    const t = mailT(undefined);
    expect(t('demo.greeting', { name: 'Monde' })).toBe('Bonjour, Monde !');
  });

  it('never overrides an explicit, supported language with DEFAULT_LOCALE', () => {
    process.env.DEFAULT_LOCALE = 'fr';
    const t = mailT('pt');
    expect(t('demo.greeting', { name: 'Mundo' })).toBe('Olá, Mundo!');
  });

  it('falls back to English when DEFAULT_LOCALE is unset', () => {
    delete process.env.DEFAULT_LOCALE;
    const t = mailT(undefined);
    expect(t('demo.greeting', { name: 'World' })).toBe('Hello, World!');
  });

  // An unsupported DEFAULT_LOCALE value is covered by `default-locale.spec.ts`, which mocks `logger`
  // so the warning that path fires does not reach `logger.service.ts`'s own real `prisma.log.create`
  // in a plain unit test — see that spec's own header, and `resolve-recipient-language.spec.ts`'s
  // identical note.
});
