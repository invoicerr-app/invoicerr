import { RetentionCatalog } from './registry';
import { CountryRetentionFile } from './schema';

const FR: CountryRetentionFile = {
  countryCode: 'FR',
  rules: [{ label: 'fiscale', years: 6, legalRef: 'LPF art. L102 B' }],
};

describe('RetentionCatalog', () => {
  it('resolves a file by uppercase country code', () => {
    const catalog = new RetentionCatalog([FR]);
    expect(catalog.fileFor('fr')).toBe(FR);
    expect(catalog.fileFor('FR')).toBe(FR);
  });

  it('has() reflects whether a country was loaded', () => {
    const catalog = new RetentionCatalog([FR]);
    expect(catalog.has('FR')).toBe(true);
    expect(catalog.has('DE')).toBe(false);
  });

  it('returns undefined, never a fallback, for a country with no file at all', () => {
    const catalog = new RetentionCatalog([FR]);
    expect(catalog.fileFor('DE')).toBeUndefined();
    expect(catalog.fileFor(undefined)).toBeUndefined();
  });
});
