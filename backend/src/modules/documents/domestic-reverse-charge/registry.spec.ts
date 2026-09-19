import { DomesticReverseChargeCatalog } from './registry';
import { CountryDomesticReverseChargeFile } from './schema';

const FR_FIXTURE: CountryDomesticReverseChargeFile = {
  countryCode: 'FR',
  categories: [
    {
      key: 'construction-subcontracting',
      label: 'Construction subcontracting',
      legalRef: 'CGI art. 283, 2 nonies',
      provenance: {
        kind: 'legal',
        sourceText: 'la taxe est acquittée par le preneur.',
        sourceCheckedAt: '2026-09-13',
      },
    },
  ],
};

describe('DomesticReverseChargeCatalog', () => {
  it('has() is true only for a country with a shipped file', () => {
    const catalog = new DomesticReverseChargeCatalog([FR_FIXTURE]);
    expect(catalog.has('FR')).toBe(true);
    expect(catalog.has('fr')).toBe(true); // case-insensitive, same convention as MentionsCatalog
    expect(catalog.has('DE')).toBe(false);
  });

  it('categoriesFor() returns [] rather than undefined for an unknown country', () => {
    const catalog = new DomesticReverseChargeCatalog([FR_FIXTURE]);
    expect(catalog.categoriesFor('DE')).toEqual([]);
    expect(catalog.categoriesFor(undefined)).toEqual([]);
  });

  it('categoriesFor() returns the country’s own categories', () => {
    const catalog = new DomesticReverseChargeCatalog([FR_FIXTURE]);
    expect(catalog.categoriesFor('FR').map((c) => c.key)).toEqual(['construction-subcontracting']);
  });

  it('categoryFor() finds one category by key, scoped to its own country', () => {
    const catalog = new DomesticReverseChargeCatalog([FR_FIXTURE]);
    expect(catalog.categoryFor('FR', 'construction-subcontracting')?.legalRef).toBe('CGI art. 283, 2 nonies');
    expect(catalog.categoryFor('DE', 'construction-subcontracting')).toBeUndefined();
  });

  it('defaults to the real shipped catalog when constructed with no argument', () => {
    const catalog = new DomesticReverseChargeCatalog();
    expect(catalog.has('IT')).toBe(true);
    expect(catalog.categoriesFor('IT').length).toBeGreaterThan(0);
  });
});
