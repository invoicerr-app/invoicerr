import { CountryPolicyCatalog } from './registry';
import { DocumentActionRuleFact } from './schema';
import { DocumentCountryActionRuleRow, rowFor } from './seed';
import { detectCountryPolicyDrift } from './drift';

/**
 * `detectCountryPolicyDrift` proven with plain in-memory fixtures — no fake Prisma client, no DB, no
 * `async` at all, per the task's own explicit ask ("teste la fonction de comparaison à froid avec
 * des fixtures en mémoire"). `existingRows` below stands in for "whatever `findMany` just returned",
 * built by hand from `rowFor` — the SAME transform `seedCountryPolicies` itself uses — so a fixture
 * that matches the catalog is genuinely indistinguishable from "the DB is actually in sync",  not a
 * hand-typed guess at the row shape.
 */
const ALLOW_SEND: DocumentActionRuleFact = {
  typeId: 'invoice',
  actionId: 'send',
  allowed: true,
  provenance: { kind: 'legal', sourceText: 'fixture legal text', sourceCheckedAt: '2026-01-01' },
};

const ALLOW_SAVE_DRAFT: DocumentActionRuleFact = {
  typeId: 'invoice',
  actionId: 'save-draft',
  allowed: true,
  provenance: { kind: 'unverified', resolutionNote: 'fixture resolution note' },
};

function catalogWith(countryCode: string, rules: DocumentActionRuleFact[]): CountryPolicyCatalog {
  return new CountryPolicyCatalog([{ countryCode, rules }]);
}

function rowsFor(countryCode: string, rules: DocumentActionRuleFact[]): DocumentCountryActionRuleRow[] {
  return rules.map((rule) => rowFor(countryCode, rule));
}

describe('detectCountryPolicyDrift', () => {
  it('reports IN SYNC when the DB rows exactly match the catalog', () => {
    const catalog = catalogWith('ZZ', [ALLOW_SEND, ALLOW_SAVE_DRAFT]);
    const existingRows = rowsFor('ZZ', [ALLOW_SEND, ALLOW_SAVE_DRAFT]);

    const report = detectCountryPolicyDrift(catalog, existingRows);

    expect(report).toEqual({ inSync: true, addedCountries: [], changedCountries: [], removedCountries: [] });
  });

  it('IN SYNC is order-independent — the DB read order never causes a false positive', () => {
    const catalog = catalogWith('ZZ', [ALLOW_SEND, ALLOW_SAVE_DRAFT]);
    // Reversed relative to the catalog's own order.
    const existingRows = rowsFor('ZZ', [ALLOW_SAVE_DRAFT, ALLOW_SEND]);

    expect(detectCountryPolicyDrift(catalog, existingRows).inSync).toBe(true);
  });

  it('detects an ADDED country — declared in the files, no row at all in the DB yet', () => {
    const catalog = catalogWith('ZZ', [ALLOW_SEND]);

    const report = detectCountryPolicyDrift(catalog, []);

    expect(report.inSync).toBe(false);
    expect(report.addedCountries).toEqual(['ZZ']);
    expect(report.changedCountries).toEqual([]);
    expect(report.removedCountries).toEqual([]);
  });

  // The exact case already named for the sibling table ("country-identifiers/seed.ts ne
  // purge jamais un pays entièrement retiré"): a country ENTIRELY removed from the catalog must
  // still be visible to the drift report, even though the catalog itself no longer names it at all.
  it('detects a REMOVED country — rows in the DB, no file for it at all', () => {
    const catalog = new CountryPolicyCatalog([]); // no countries at all
    const existingRows = rowsFor('ZZ', [ALLOW_SEND]);

    const report = detectCountryPolicyDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.removedCountries).toEqual(['ZZ']);
    expect(report.addedCountries).toEqual([]);
    expect(report.changedCountries).toEqual([]);
  });

  it('detects a CHANGED country — same rule, `allowed` flipped since the last reseed', () => {
    const catalog = catalogWith('ZZ', [ALLOW_SEND]);
    const stale = rowFor('ZZ', { ...ALLOW_SEND, allowed: false });

    const report = detectCountryPolicyDrift(catalog, [stale]);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['ZZ']);
  });

  it('detects a CHANGED country — a rule added to the file since the last reseed', () => {
    const catalog = catalogWith('ZZ', [ALLOW_SEND, ALLOW_SAVE_DRAFT]);
    const existingRows = rowsFor('ZZ', [ALLOW_SEND]); // DB is missing the new rule

    const report = detectCountryPolicyDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['ZZ']);
  });

  it('detects a CHANGED country — a rule removed from the file since the last reseed', () => {
    const catalog = catalogWith('ZZ', [ALLOW_SEND]);
    const existingRows = rowsFor('ZZ', [ALLOW_SEND, ALLOW_SAVE_DRAFT]); // DB still has the dropped rule

    const report = detectCountryPolicyDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['ZZ']);
  });

  it("several countries independently — one country's drift never masks another's sync", () => {
    const catalog = new CountryPolicyCatalog([
      { countryCode: 'AA', rules: [ALLOW_SEND] },
      { countryCode: 'BB', rules: [ALLOW_SEND] },
    ]);
    const existingRows = [
      ...rowsFor('AA', [ALLOW_SEND]), // in sync
      ...rowsFor('BB', [{ ...ALLOW_SEND, allowed: false }]), // drifted
    ];

    const report = detectCountryPolicyDrift(catalog, existingRows);

    expect(report.inSync).toBe(false);
    expect(report.changedCountries).toEqual(['BB']);
    expect(report.addedCountries).toEqual([]);
    expect(report.removedCountries).toEqual([]);
  });

  it('an empty catalog against an empty DB is IN SYNC — no phantom drift', () => {
    const catalog = new CountryPolicyCatalog([]);

    expect(detectCountryPolicyDrift(catalog, [])).toEqual({
      inSync: true,
      addedCountries: [],
      changedCountries: [],
      removedCountries: [],
    });
  });
});
