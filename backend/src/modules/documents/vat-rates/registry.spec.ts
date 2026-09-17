import { CountryVatRatesFile } from './schema';
import {
  resolveVatRateFact,
  resolveVatRatePercentage,
  VatRateCatalog,
  vatRateFieldOptions,
} from './registry';

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

// Italy's own real shape: TWO rates sharing the identical percentage (0%) but meaning two entirely
// different legal regimes — the exact case `value` being the rate's own `id`, not its bare
// percentage, exists to keep distinguishable in the first place.
const IT_FILE: CountryVatRatesFile = {
  countryCode: 'IT',
  rates: [
    {
      id: 'it-esente',
      rate: 0,
      label: 'Esente',
      category: 'EXEMPT',
      provenance: { kind: 'unverified', resolutionNote: 'note' },
    },
    {
      id: 'it-non-imponibile',
      rate: 0,
      label: 'Non imponibile',
      category: 'ZERO',
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
  // THE MUTATION TARGET: `value` used to be the bare percentage (`String(rate.rate)`) — two rates
  // sharing the same percentage (Italy's `it-esente`/`it-non-imponibile`, both 0%) would then be
  // OFFERED as, and STORED as, the exact same indistinguishable string.
  it('turns a known catalog into { value, label } options, value as the rate’s own stable id', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    const resolution = vatRateFieldOptions(catalog, 'FR');

    expect(resolution.known).toBe(true);
    expect(resolution.options).toEqual([
      { value: 'fr-standard', label: '20% — Taux normal' },
      { value: 'fr-reduced', label: '5.5% — Taux réduit' },
    ]);
  });

  it('two same-percentage rates (Italy) get two DISTINCT option values — never collapsed into one indistinguishable "0"', () => {
    const catalog = new VatRateCatalog([IT_FILE]);
    const resolution = vatRateFieldOptions(catalog, 'IT');

    expect(resolution.options).toEqual([
      { value: 'it-esente', label: '0% — Esente' },
      { value: 'it-non-imponibile', label: '0% — Non imponibile' },
    ]);
  });

  // BACKWARD COMPATIBILITY — see `DocumentFieldDescriptor.legacyOptions`'s own header
  // (descriptors/types.ts): never offered as a fresh choice, but present so a document already
  // carrying the OLD bare-percentage value keeps validating.
  it('also returns legacyOptions — the bare-percentage form, for documents saved before this change', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    const resolution = vatRateFieldOptions(catalog, 'FR');

    expect(resolution.legacyOptions).toEqual([
      { value: '20', label: '20% — Taux normal' },
      { value: '5.5', label: '5.5% — Taux réduit' },
    ]);
  });

  it('is honest about an unknown country — known: false, empty options AND legacyOptions, never a guess', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    const resolution = vatRateFieldOptions(catalog, 'DE');

    expect(resolution.known).toBe(false);
    expect(resolution.options).toEqual([]);
    expect(resolution.legacyOptions).toEqual([]);
  });

  it('treats an empty/undefined country code the same as an unknown one, never throws', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(vatRateFieldOptions(catalog, '')).toEqual({ known: false, options: [], legacyOptions: [] });
  });
});

describe('resolveVatRatePercentage', () => {
  it('resolves the CANONICAL id form to its own percentage', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(resolveVatRatePercentage(catalog, 'FR', 'fr-standard')).toBe(20);
    expect(resolveVatRatePercentage(catalog, 'FR', 'fr-reduced')).toBe(5.5);
  });

  it('ALSO resolves the LEGACY bare-percentage form — a document saved before ids existed', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(resolveVatRatePercentage(catalog, 'FR', '20')).toBe(20);
    expect(resolveVatRatePercentage(catalog, 'FR', '5.5')).toBe(5.5);
  });

  it('returns null for a value that matches neither form for this country', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(resolveVatRatePercentage(catalog, 'FR', '19')).toBeNull();
    expect(resolveVatRatePercentage(catalog, 'FR', 'it-esente')).toBeNull();
    expect(resolveVatRatePercentage(catalog, 'FR', 'not-a-rate')).toBeNull();
  });

  it('resolves each of two same-percentage Italian rates to the SAME percentage, by their own distinct id', () => {
    const catalog = new VatRateCatalog([IT_FILE]);
    expect(resolveVatRatePercentage(catalog, 'IT', 'it-esente')).toBe(0);
    expect(resolveVatRatePercentage(catalog, 'IT', 'it-non-imponibile')).toBe(0);
  });
});

describe('resolveVatRateFact', () => {
  it('returns the full VatRateFact — category included — for the canonical id form', () => {
    const catalog = new VatRateCatalog([IT_FILE]);
    expect(resolveVatRateFact(catalog, 'IT', 'it-esente')).toMatchObject({
      id: 'it-esente',
      rate: 0,
      category: 'EXEMPT',
    });
    expect(resolveVatRateFact(catalog, 'IT', 'it-non-imponibile')).toMatchObject({
      id: 'it-non-imponibile',
      rate: 0,
      category: 'ZERO',
    });
  });

  it('is undefined for a value that resolves to neither an id nor a known percentage', () => {
    const catalog = new VatRateCatalog([FR_FILE]);
    expect(resolveVatRateFact(catalog, 'FR', 'not-a-rate')).toBeUndefined();
  });
});
