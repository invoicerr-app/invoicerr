import { TaxUnionCountryFact, TaxUnionsFile } from './schema';
import { TAX_UNIONS_FILE, TaxUnionRegistry } from './registry';

describe('TAX_UNIONS_FILE (loaded from data/tax-unions.json)', () => {
  it('loads without throwing - the file passed its own load-time validation', () => {
    expect(TAX_UNIONS_FILE.countries.length).toBeGreaterThan(0);
  });

  it('carries all 27 current EU member states, and exactly those', () => {
    const euCodes = TAX_UNIONS_FILE.countries.filter((c) => c.euMember).map((c) => c.code);
    expect(euCodes.sort()).toEqual(
      [
        'AT',
        'BE',
        'BG',
        'CY',
        'CZ',
        'DE',
        'DK',
        'EE',
        'ES',
        'FI',
        'FR',
        'GR',
        'HR',
        'HU',
        'IE',
        'IT',
        'LT',
        'LU',
        'LV',
        'MT',
        'NL',
        'PL',
        'PT',
        'RO',
        'SE',
        'SI',
        'SK',
      ].sort(),
    );
  });

  it('carries the 6 GCC Unified VAT Agreement signatories, and none of them as an EU member too', () => {
    const gccCodes = TAX_UNIONS_FILE.countries.filter((c) => c.gccMember).map((c) => c.code);
    expect(gccCodes.sort()).toEqual(['AE', 'BH', 'KW', 'OM', 'QA', 'SA'].sort());
    for (const c of TAX_UNIONS_FILE.countries) {
      expect(c.euMember && c.gccMember).toBe(false);
    }
  });

  it('Greece: ISO code GR, VAT prefix EL, both recognized by the OCR heuristic', () => {
    const gr = TAX_UNIONS_FILE.countries.find((c) => c.code === 'GR');
    expect(gr?.vatPrefix).toBe('EL');
    expect(gr?.peppolEas).toBe('9933');
  });
});

describe('TaxUnionRegistry', () => {
  const registry = new TaxUnionRegistry();

  it('taxUnionOf: EU member -> "EU"', () => {
    expect(registry.taxUnionOf('FR')).toBe('EU');
    expect(registry.taxUnionOf('de')).toBe('EU'); // case-insensitive, same as the pre-existing function
  });

  it('taxUnionOf: GCC member -> "GCC"', () => {
    expect(registry.taxUnionOf('SA')).toBe('GCC');
  });

  it('taxUnionOf: neither -> null, including an empty/undefined input', () => {
    expect(registry.taxUnionOf('US')).toBeNull();
    expect(registry.taxUnionOf('')).toBeNull();
  });

  it('peppolEasForPrefix: looks up by VAT PREFIX, not by ISO code - Greece resolves under "EL", never "GR"', () => {
    expect(registry.peppolEasForPrefix('EL')).toBe('9933');
    expect(registry.peppolEasForPrefix('GR')).toBeUndefined();
    expect(registry.peppolEasForPrefix('FR')).toBe('9957');
  });

  it('peppolEasForPrefix: an EU member with no published EAS entry (e.g. Denmark) -> undefined', () => {
    expect(registry.peppolEasForPrefix('DK')).toBeUndefined();
  });

  it('peppolEasForPrefix: a non-EU prefix, or no prefix at all -> undefined', () => {
    expect(registry.peppolEasForPrefix('US')).toBeUndefined();
    expect(registry.peppolEasForPrefix(undefined)).toBeUndefined();
    expect(registry.peppolEasForPrefix(null)).toBeUndefined();
  });

  it('ocrRecognizedPrefixes: carries both GR and EL for Greece, the non-EU neighbours, and XI', () => {
    const prefixes = registry.ocrRecognizedPrefixes();
    expect(prefixes.has('GR')).toBe(true);
    expect(prefixes.has('EL')).toBe(true);
    expect(prefixes.has('CH')).toBe(true);
    expect(prefixes.has('NO')).toBe(true);
    expect(prefixes.has('GB')).toBe(true);
    expect(prefixes.has('XI')).toBe(true);
    expect(prefixes.has('US')).toBe(false);
  });

  it('ocrRecognizedPrefixes: does not recognize a GCC member (no copy ever did)', () => {
    expect(registry.ocrRecognizedPrefixes().has('SA')).toBe(false);
  });

  // The regression-guard this PR's own report promised (break DE from the EU table, show the
  // consumer go red, restore it, show green) - see the PR body for the real backend/Cypress run;
  // this is the fast, DB-free version of the same proof, kept as a permanent regression test.
  it('a country removed from the table (e.g. a synthetic DE with no EU membership) loses EU tax treatment everywhere this registry answers for', () => {
    const file: TaxUnionsFile = JSON.parse(JSON.stringify(TAX_UNIONS_FILE));
    const de = file.countries.find((c: TaxUnionCountryFact) => c.code === 'DE');
    expect(de).toBeDefined();
    de!.euMember = false;

    const broken = new TaxUnionRegistry(file);
    expect(broken.taxUnionOf('DE')).toBeNull(); // was 'EU'

    de!.euMember = true;
    const restored = new TaxUnionRegistry(file);
    expect(restored.taxUnionOf('DE')).toBe('EU');
  });
});
