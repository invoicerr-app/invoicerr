import { CountryVatRatesFile } from './schema';
import { VatRateCatalog, vatRateFieldOptions } from './registry';

const FR_FILE: CountryVatRatesFile = {
  countryCode: 'FR',
  rates: [
    {
      id: 'fr-standard',
      rate: 20,
      label: 'Taux normal',
      category: 'STANDARD',
      provenance: { kind: 'unverified', resolutionNote: 'note' },
    },
    {
      id: 'fr-reduced',
      rate: 5.5,
      label: 'Taux réduit',
      category: 'SUPER_REDUCED',
      provenance: { kind: 'unverified', resolutionNote: 'note' },
    },
  ],
};

describe('VatRateCatalog', () => {
  it('is case-insensitive and reports which countries it knows', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(catalog.has('fr')).toBe(true);
    expect(catalog.has('FR')).toBe(true);
    expect(catalog.has('DE')).toBe(false);
    expect(catalog.countries()).toEqual(['FR']);
  });

  it('returns every rate for a known country, in file order', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(catalog.ratesFor('FR').map((r) => r.id)).toEqual(['fr-standard', 'fr-reduced']);
  });

  it('returns an empty list — never throws — for a country with no file at all', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(catalog.ratesFor('DE')).toEqual([]);
  });
});

describe('vatRateFieldOptions', () => {
  it('turns a known catalog into { value, label } options, value as the rate’s string form', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    const resolution = vatRateFieldOptions(catalog, 'FR');

    expect(resolution.known).toBe(true);
    expect(resolution.options).toEqual([
      { value: '20', label: '20% — Taux normal' },
      { value: '5.5', label: '5.5% — Taux réduit' },
    ]);
  });

  it('is honest about an unknown country — known: false, empty options, never a guess', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    const resolution = vatRateFieldOptions(catalog, 'DE');

    expect(resolution.known).toBe(false);
    expect(resolution.options).toEqual([]);
  });

  it('treats an empty/undefined country code the same as an unknown one, never throws', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(vatRateFieldOptions(catalog, '')).toEqual({ known: false, options: [] });
  });
});
