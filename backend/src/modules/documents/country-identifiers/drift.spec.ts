import { CountryIdentifierRequirementsCatalog } from './registry';
import { IdentifierSchemeFact } from './schema';
import { CountryIdentifierRequirementRow, rowFor } from './seed';
import { detectCountryIdentifierRequirementsDrift } from './drift';

/**
 * `detectCountryIdentifierRequirementsDrift` — sibling of country-policy/drift.spec.ts, same "plain
 * in-memory fixtures, no fake client, no DB" discipline (the task's own explicit ask).
 */
const LEGAL_ID_FACT: IdentifierSchemeFact = {
  scheme: 'LEGAL_ID',
  appliesTo: 'BOTH',
  label: 'Fixture ID',
  required: true,
  provenance: { kind: 'legal', sourceText: 'fixture legal text', sourceCheckedAt: '2026-01-01' },
};

const VAT_FACT: IdentifierSchemeFact = {
  scheme: 'VAT',
  appliesTo: 'COMPANY',
  label: 'Fixture VAT',
  required: false,
  provenance: { kind: 'unverified', resolutionNote: 'fixture resolution note' },
};

function catalogWith(
  countryCode: string,
  schemes: IdentifierSchemeFact[],
): CountryIdentifierRequirementsCatalog {
  return new CountryIdentifierRequirementsCatalog([{ countryCode, schemes }]);
}

function rowsFor(countryCode: string, schemes: IdentifierSchemeFact[]): CountryIdentifierRequirementRow[] {
  return schemes.map((fact) => rowFor(countryCode, fact));
}

describe('detectCountryIdentifierRequirementsDrift', () => {
  it('reports IN SYNC when the DB rows exactly match the catalog', () => {
    const catalog = catalogWith('ZZ', [LEGAL_ID_FACT, VAT_FACT]);
    const existingRows = rowsFor('ZZ', [LEGAL_ID_FACT, VAT_FACT]);

    const report = detectCountryIdentifierRequirementsDrift(catalog, existingRows);

    expect(report).toEqual({ inSync: true, addedCountries: [], changedCountries: [], removedCountries: [] });
  });

  it('IN SYNC is order-independent — the DB read order never causes a false positive', () => {
    const catalog = catalogWith('ZZ', [LEGAL_ID_FACT, VAT_FACT]);
    const existingRows = rowsFor('ZZ', [VAT_FACT, LEGAL_ID_FACT]);

    expect(detectCountryIdentifierRequirementsDrift(catalog, existingRows).inSync).toBe(true);
  });

  it('detects an ADDED country — declared in the files, no row at all in the DB yet', () => {
    const catalog = catalogWith('ZZ', [LEGAL_ID_FACT]);

    const report = detectCountryIdentifierRequirementsDrift(catalog, []);

    expect(report.inSync).toBe(false);
    expect(report.addedCountries).toEqual(['ZZ']);
    expect(report.changedCountries).toEqual([]);
    expect(report.removedCountries).toEqual([]);
  });

  // The exact bug this fixes: a country ENTIRELY removed from the catalog must still be
  // visible to the drift report, even though the catalog itself no longer names it at all.
  it('detects a REMOVED country — rows in the DB, no file for it at all', () => {
    const catalog = new CountryIdentifierRequirementsCatalog([]);
    const existingRows = rowsFor('ZZ', [LEGAL_ID_FACT]);

    const report = detectCountryIdentifierRequirementsDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.removedCountries).toEqual(['ZZ']);
    expect(report.addedCountries).toEqual([]);
    expect(report.changedCountries).toEqual([]);
  });

  it('detects a CHANGED country — same scheme, `required` flipped since the last reseed', () => {
    const catalog = catalogWith('ZZ', [LEGAL_ID_FACT]);
    const stale = rowFor('ZZ', { ...LEGAL_ID_FACT, required: false });

    const report = detectCountryIdentifierRequirementsDrift(catalog, [stale]);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['ZZ']);
  });

  it('detects a CHANGED country — a scheme added to the file since the last reseed', () => {
    const catalog = catalogWith('ZZ', [LEGAL_ID_FACT, VAT_FACT]);
    const existingRows = rowsFor('ZZ', [LEGAL_ID_FACT]);

    const report = detectCountryIdentifierRequirementsDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['ZZ']);
  });

  it('detects a CHANGED country — a scheme removed from the file since the last reseed', () => {
    const catalog = catalogWith('ZZ', [LEGAL_ID_FACT]);
    const existingRows = rowsFor('ZZ', [LEGAL_ID_FACT, VAT_FACT]);

    const report = detectCountryIdentifierRequirementsDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['ZZ']);
  });

  it("several countries independently — one country's drift never masks another's sync", () => {
    const catalog = new CountryIdentifierRequirementsCatalog([
      { countryCode: 'AA', schemes: [LEGAL_ID_FACT] },
      { countryCode: 'BB', schemes: [LEGAL_ID_FACT] },
    ]);
    const existingRows = [
      ...rowsFor('AA', [LEGAL_ID_FACT]),
      ...rowsFor('BB', [{ ...LEGAL_ID_FACT, required: false }]),
    ];

    const report = detectCountryIdentifierRequirementsDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['BB']);
    expect(report.addedCountries).toEqual([]);
    expect(report.removedCountries).toEqual([]);
  });

  it('an empty catalog against an empty DB is IN SYNC — no phantom drift', () => {
    const catalog = new CountryIdentifierRequirementsCatalog([]);

    expect(detectCountryIdentifierRequirementsDrift(catalog, [])).toEqual({
      inSync: true,
      addedCountries: [],
      changedCountries: [],
      removedCountries: [],
    });
  });
});
