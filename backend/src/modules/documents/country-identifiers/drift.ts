/**
 * Pure drift comparison between `data/*.json` (via a `CountryIdentifierRequirementsCatalog`) and
 * whatever `CountryIdentifierRequirement` currently holds — the DETECTION half of the fix for
 * the "`resetAndSeed` ne re-sème pas la politique pays" note, extended to this sibling
 * table (the same gap applies here identically). See country-policy/drift.ts's own header for the
 * full "why a pure, DB-free function" reasoning — this file mirrors it field-for-field.
 */
import { rowFor, CountryIdentifierRequirementRow } from './seed';
import { CountryIdentifierRequirementsCatalog } from './registry';

export interface CountryIdentifierRequirementsDriftReport {
  /** true when the DB already matches `data/*.json` exactly for every country — nothing to reseed. */
  inSync: boolean;
  /** Countries the files declare that have no row at all in the DB yet. */
  addedCountries: string[];
  /** Countries present in BOTH, but whose scheme content differs (a scheme added, removed, edited). */
  changedCountries: string[];
  /**
   * Countries with rows in the DB but ENTIRELY ABSENT from the files — the exact case
   * already named ("`country-identifiers/seed.ts` ne purge jamais un pays entièrement
   * retiré"). Called out separately from `changedCountries` because a naive per-country diff (walk
   * `catalog.countries()`, compare each) would never even look at these.
   */
  removedCountries: string[];
}

/** Stable content key for one row within a country — same reasoning as country-policy/drift.ts's
 *  own `rowContentKey`: natural key first, every other field follows, never `id`/timestamps. */
function rowContentKey(row: CountryIdentifierRequirementRow): string {
  return JSON.stringify({
    scheme: row.scheme,
    appliesTo: row.appliesTo,
    label: row.label,
    required: row.required,
    pattern: row.pattern,
    helpText: row.helpText,
    provenanceKind: row.provenanceKind,
    sourceText: row.sourceText,
    sourceCheckedAt: row.sourceCheckedAt ? row.sourceCheckedAt.toISOString() : null,
    resolutionNote: row.resolutionNote,
    notes: row.notes,
  });
}

/** Order-independent content signature for a whole country's rows. */
function countrySignature(rows: CountryIdentifierRequirementRow[]): string {
  return rows.map(rowContentKey).sort().join('\n');
}

export function detectCountryIdentifierRequirementsDrift(
  catalog: CountryIdentifierRequirementsCatalog,
  existingRows: CountryIdentifierRequirementRow[],
): CountryIdentifierRequirementsDriftReport {
  const countries = catalog.countries();
  const expectedByCountry = new Map<string, CountryIdentifierRequirementRow[]>(
    countries.map((countryCode) => [
      countryCode,
      catalog.schemesFor(countryCode).map((fact) => rowFor(countryCode, fact)),
    ]),
  );

  const actualByCountry = new Map<string, CountryIdentifierRequirementRow[]>();
  for (const row of existingRows) {
    const bucket = actualByCountry.get(row.countryCode);
    if (bucket) bucket.push(row);
    else actualByCountry.set(row.countryCode, [row]);
  }

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const countryCode of new Set([...expectedByCountry.keys(), ...actualByCountry.keys()])) {
    const expected = expectedByCountry.get(countryCode);
    const actual = actualByCountry.get(countryCode);

    if (expected && !actual) {
      added.push(countryCode);
    } else if (!expected && actual) {
      removed.push(countryCode);
    } else if (expected && actual && countrySignature(expected) !== countrySignature(actual)) {
      changed.push(countryCode);
    }
  }

  added.sort();
  changed.sort();
  removed.sort();

  return {
    inSync: added.length === 0 && changed.length === 0 && removed.length === 0,
    addedCountries: added,
    changedCountries: changed,
    removedCountries: removed,
  };
}
