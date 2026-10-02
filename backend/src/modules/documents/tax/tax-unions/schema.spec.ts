import { assertValidTaxUnionCountryFact, assertValidTaxUnionsFile, TaxUnionsFile } from './schema';

const VALID_PROVENANCE = {
  euMembership: { kind: 'legal' as const, sourceText: 'x', sourceCheckedAt: '2026-10-02', source: 'y' },
  gccMembership: { kind: 'unverified' as const, resolutionNote: 'x' },
  peppolEas: { kind: 'legal' as const, sourceText: 'x', sourceCheckedAt: '2026-10-02', source: 'y' },
  ocrRecognition: { kind: 'unverified' as const, resolutionNote: 'x' },
};

function minimalFile(): TaxUnionsFile {
  return {
    // Deep-cloned every call: several tests mutate `file.provenance.<aspect>` in place, and a shared
    // reference would leak one test's mutation into every test that runs after it.
    provenance: JSON.parse(JSON.stringify(VALID_PROVENANCE)),
    countries: [
      { code: 'FR', iso3166: true, euMember: true, gccMember: false },
      { code: 'SA', iso3166: true, euMember: false, gccMember: true },
    ],
  };
}

describe('assertValidTaxUnionsFile', () => {
  it('accepts a minimal, internally consistent file', () => {
    expect(() => assertValidTaxUnionsFile(minimalFile(), 'ctx')).not.toThrow();
  });

  it('rejects a missing provenance block', () => {
    const file = minimalFile();
    // @ts-expect-error deliberately malformed for the test
    file.provenance = undefined;
    expect(() => assertValidTaxUnionsFile(file, 'ctx')).toThrow(/missing "provenance"/);
  });

  it('rejects a provenance aspect with neither "legal" nor "unverified" kind', () => {
    const file = minimalFile();
    // @ts-expect-error deliberately malformed for the test
    file.provenance.euMembership = { kind: 'guessed' };
    expect(() => assertValidTaxUnionsFile(file, 'ctx')).toThrow(/no valid provenance/);
  });

  it('rejects a "legal" provenance missing sourceText/sourceCheckedAt/source', () => {
    const file = minimalFile();
    // @ts-expect-error deliberately malformed for the test
    file.provenance.peppolEas = { kind: 'legal' };
    expect(() => assertValidTaxUnionsFile(file, 'ctx')).toThrow(/missing sourceText/);
  });

  it('rejects an "unverified" provenance missing resolutionNote', () => {
    const file = minimalFile();
    // @ts-expect-error deliberately malformed for the test
    file.provenance.gccMembership = { kind: 'unverified' };
    expect(() => assertValidTaxUnionsFile(file, 'ctx')).toThrow(/no resolutionNote/);
  });

  it('rejects an empty "countries" array', () => {
    const file = minimalFile();
    file.countries = [];
    expect(() => assertValidTaxUnionsFile(file, 'ctx')).toThrow(/non-empty array/);
  });

  it('rejects a duplicate country code', () => {
    const file = minimalFile();
    file.countries.push({ code: 'FR', iso3166: true, euMember: true, gccMember: false });
    expect(() => assertValidTaxUnionsFile(file, 'ctx')).toThrow(/duplicate country code/);
  });

  it('rejects an unsorted "countries" array', () => {
    const file = minimalFile();
    file.countries = [file.countries[1], file.countries[0]];
    expect(() => assertValidTaxUnionsFile(file, 'ctx')).toThrow(/must be sorted/);
  });

  it('rejects a row claiming both EU and GCC membership at once', () => {
    expect(() =>
      assertValidTaxUnionCountryFact({ code: 'XX', iso3166: true, euMember: true, gccMember: true }, 'ctx'),
    ).toThrow(/cannot be both/);
  });

  it('rejects a non-ISO row ("iso3166: false") with no explanatory "notes"', () => {
    expect(() =>
      assertValidTaxUnionCountryFact(
        { code: 'XI', iso3166: false, euMember: false, gccMember: false },
        'ctx',
      ),
    ).toThrow(/must carry a "notes"/);
  });

  it('accepts a non-ISO row that DOES carry an explanatory "notes"', () => {
    expect(() =>
      assertValidTaxUnionCountryFact(
        { code: 'XI', iso3166: false, euMember: false, gccMember: false, notes: 'Northern Ireland.' },
        'ctx',
      ),
    ).not.toThrow();
  });

  it('rejects a "vatPrefix" that differs from "code" with no explanatory "notes"', () => {
    expect(() =>
      assertValidTaxUnionCountryFact(
        { code: 'GR', iso3166: true, euMember: true, gccMember: false, vatPrefix: 'EL' },
        'ctx',
      ),
    ).toThrow(/carries no "notes"/);
  });
});
