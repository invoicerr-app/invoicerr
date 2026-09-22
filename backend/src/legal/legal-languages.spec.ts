import {
  DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  isLegalDocumentLanguage,
  LEGAL_DOCUMENT_LANGUAGES,
  parseAcceptLanguageHeader,
} from './legal-languages';

describe('isLegalDocumentLanguage', () => {
  it('accepts every code in the closed set', () => {
    for (const lang of LEGAL_DOCUMENT_LANGUAGES) {
      expect(isLegalDocumentLanguage(lang)).toBe(true);
    }
  });

  it('rejects an unsupported code, garbage, and non-strings without throwing', () => {
    expect(isLegalDocumentLanguage('es')).toBe(false);
    expect(isLegalDocumentLanguage('FR')).toBe(false); // case-sensitive — callers normalize first
    expect(isLegalDocumentLanguage('')).toBe(false);
    expect(isLegalDocumentLanguage(undefined)).toBe(false);
    expect(isLegalDocumentLanguage(42)).toBe(false);
  });

  it('the default language is English and is itself a member of the set', () => {
    expect(DEFAULT_LEGAL_DOCUMENT_LANGUAGE).toBe('en');
    expect(isLegalDocumentLanguage(DEFAULT_LEGAL_DOCUMENT_LANGUAGE)).toBe(true);
  });
});

describe('parseAcceptLanguageHeader', () => {
  it('returns [] for an absent or empty header', () => {
    expect(parseAcceptLanguageHeader(undefined)).toEqual([]);
    expect(parseAcceptLanguageHeader(null)).toEqual([]);
    expect(parseAcceptLanguageHeader('')).toEqual([]);
  });

  it('orders by descending q, defaulting an untagged entry to q=1', () => {
    expect(parseAcceptLanguageHeader('fr-FR,fr;q=0.9,en;q=0.8')).toEqual(['fr', 'en']);
  });

  it('collapses a region subtag onto its primary language (fr-FR and fr are the same preference)', () => {
    expect(parseAcceptLanguageHeader('fr-FR;q=0.9,de;q=0.95')).toEqual(['de', 'fr']);
  });

  it('deduplicates, keeping the first (highest-priority) occurrence', () => {
    expect(parseAcceptLanguageHeader('fr;q=0.5,fr-CA;q=0.9')).toEqual(['fr']);
  });

  it('drops an entry with a malformed q rather than throwing, but keeps the rest', () => {
    expect(parseAcceptLanguageHeader('fr;q=not-a-number,de;q=0.5')).toEqual(['fr', 'de']);
  });

  it('is stable for equal-quality entries (keeps header order, never shuffles)', () => {
    expect(parseAcceptLanguageHeader('pl,it,pt')).toEqual(['pl', 'it', 'pt']);
  });

  it('a single unweighted tag is its own one-element result', () => {
    expect(parseAcceptLanguageHeader('de')).toEqual(['de']);
  });
});
