import { CountryIdentifierRequirementsFile } from './schema';
import { CountryIdentifierRequirementsCatalog } from './registry';

const FR_FILE: CountryIdentifierRequirementsFile = {
  countryCode: 'FR',
  schemes: [
    {
      scheme: 'LEGAL_ID',
      appliesTo: 'BOTH',
      label: 'SIRET',
      required: true,
      provenance: { kind: 'unverified', resolutionNote: 'fixture' },
    },
  ],
};

describe('CountryIdentifierRequirementsCatalog', () => {
  it('is case-insensitive and reports which countries it knows', () => {
    const catalog = new CountryIdentifierRequirementsCatalog([FR_FILE]);
    expect(catalog.has('fr')).toBe(true);
    expect(catalog.has('FR')).toBe(true);
    expect(catalog.has('DE')).toBe(false);
    expect(catalog.countries()).toEqual(['FR']);
  });

  it('returns the schemes declared for a known country', () => {
    const catalog = new CountryIdentifierRequirementsCatalog([FR_FILE]);
    expect(catalog.schemesFor('FR')).toEqual(FR_FILE.schemes);
  });

  it('returns an empty list — never throws — for a country with no file at all', () => {
    const catalog = new CountryIdentifierRequirementsCatalog([FR_FILE]);
    expect(catalog.schemesFor('DE')).toEqual([]);
  });

  it('defaults to the real shipped catalog (FR and US — see data/all.ts)', () => {
    const catalog = new CountryIdentifierRequirementsCatalog();
    expect(catalog.countries()).toEqual(expect.arrayContaining(['FR', 'US']));
    expect(catalog.schemesFor('FR').length).toBeGreaterThan(0);
  });
});
