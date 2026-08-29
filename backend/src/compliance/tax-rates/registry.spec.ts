import { CountryVatRatesFile } from './schema';
import { VatRateCatalog } from './registry';

const FIXTURE: CountryVatRatesFile[] = [
  {
    countryCode: 'ZZ',
    rates: [
      {
        validFrom: '1900-01-01',
        validTo: '2020-01-01',
        value: {
          id: 'zz-standard',
          rate: 15,
          label: 'Old standard',
          category: 'STANDARD',
          confidence: 'OFFICIAL',
          source: 'fixture',
          sourceCheckedAt: '2020-01-01',
        },
      },
      {
        validFrom: '2020-01-01',
        value: {
          id: 'zz-standard',
          rate: 18,
          label: 'Standard',
          category: 'STANDARD',
          confidence: 'OFFICIAL',
          source: 'fixture',
          sourceCheckedAt: '2026-01-01',
        },
      },
      {
        validFrom: '1900-01-01',
        value: {
          id: 'zz-reduced',
          rate: 5,
          label: 'Reduced',
          category: 'REDUCED',
          confidence: 'UNVERIFIED',
          source: 'fixture',
          sourceCheckedAt: '2026-01-01',
          notes: 'made up for the test',
        },
      },
    ],
  },
];

describe('VatRateCatalog', () => {
  const catalog = new VatRateCatalog(FIXTURE);

  it('lists the countries it was built with', () => {
    expect(catalog.countries()).toEqual(['ZZ']);
    expect(catalog.has('zz')).toBe(true); // case-insensitive, like ProfileRegistry
    expect(catalog.has('YY')).toBe(false);
  });

  it('temporality: resolves the rate in force at a given date, not just the latest one', () => {
    const before = catalog.ratesAt('ZZ', new Date('2015-06-01'));
    expect(before.find((r) => r.id === 'zz-standard')?.rate).toBe(15);

    const after = catalog.ratesAt('ZZ', new Date('2024-06-01'));
    expect(after.find((r) => r.id === 'zz-standard')?.rate).toBe(18);
  });

  it('a rate with no validTo stays in force indefinitely', () => {
    const farFuture = catalog.ratesAt('ZZ', new Date('2099-01-01'));
    expect(farFuture.find((r) => r.id === 'zz-reduced')?.rate).toBe(5);
  });

  it('returns an empty list for a country with no catalog file', () => {
    expect(catalog.ratesAt('YY', new Date())).toEqual([]);
    expect(catalog.allWindows('YY')).toEqual([]);
  });

  it('allWindows returns every temporal entry regardless of date, including historical ones', () => {
    const windows = catalog.allWindows('ZZ');
    expect(windows).toHaveLength(3);
    expect(windows.some((w) => w.value.rate === 15)).toBe(true);
  });

  it('the default catalog is built from the real data/*.json files and covers FR/IT/PL/MX', () => {
    const real = new VatRateCatalog();
    expect(real.countries()).toEqual(['FR', 'IT', 'MX', 'PL']);
  });
});
