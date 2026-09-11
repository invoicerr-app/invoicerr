/**
 * Pure drift comparison between `data/*.json` (via a `CountryPolicyCatalog`) and whatever
 * `DocumentCountryActionRule` currently holds — the DETECTION half of the fix for
 * "`resetAndSeed` ne re-sème pas la politique pays" note (the WRITE half stays `seedCountryPolicies`
 * in seed.ts, unchanged; see boot-reseed.ts for how the two are wired together).
 *
 * Deliberately separate from any Prisma client and from all I/O: this function takes rows already
 * fetched from the DB, so it is provable with plain in-memory fixtures (drift.spec.ts) — no fake
 * client, no DB, not even `async` — the same "prove the pure function, wire the I/O around it" split
 * b2g-routing/boot-upsert.ts already established (its own upsert loop IS the write; there was no
 * separate read-only detection step to split out there because every boot rewrites unconditionally —
 * see boot-reseed.ts's own header for why THIS mechanism chooses to detect first instead).
 */
import { rowFor, DocumentCountryActionRuleRow } from './seed';
import { CountryPolicyCatalog } from './registry';

export interface CountryPolicyDriftReport {
  /** true when the DB already matches `data/*.json` exactly for every country — nothing to reseed. */
  inSync: boolean;
  /** Countries the files declare that have no row at all in the DB yet. */
  addedCountries: string[];
  /** Countries present in BOTH, but whose rule content differs (a rule added, removed, or edited). */
  changedCountries: string[];
  /**
   * Countries with rows in the DB but ENTIRELY ABSENT from the files — the exact case
   * already named for `country-identifiers/seed.ts` ("ne purge jamais un pays retiré") and
   * which this table shares (see seed.ts's own whole-country-purge comment). Called out separately
   * from `changedCountries` because a naive per-country diff (walk `catalog.countries()`, compare
   * each) would never even look at these — the catalog doesn't name them at all.
   */
  removedCountries: string[];
}

/**
 * Stable content key for one row within a country. Natural key (`typeId`/`actionId`) FIRST, so a
 * genuine rule swap reads as "one row removed, one added" rather than a same-slot content change —
 * not that it matters for the country-level verdict below, but it keeps this key legible in a
 * debugger. Every other field follows, so `allowed`/provenance/`statuses`/`notes` edits are all
 * caught. Never `id`, `createdAt`, or `updatedAt`: those are DB bookkeeping the catalog has no
 * opinion about — comparing them would report drift on every single boot even when the files never
 * changed, which is exactly the noisy-alarm failure mode a drift check exists to avoid.
 */
function rowContentKey(row: DocumentCountryActionRuleRow): string {
  return JSON.stringify({
    typeId: row.typeId,
    actionId: row.actionId,
    allowed: row.allowed,
    provenanceKind: row.provenanceKind,
    sourceText: row.sourceText,
    sourceCheckedAt: row.sourceCheckedAt ? row.sourceCheckedAt.toISOString() : null,
    resolutionNote: row.resolutionNote,
    statuses: [...row.statuses].sort(),
    notes: row.notes,
  });
}

/** Order-independent content signature for a whole country's rows — sorting before joining means a
 *  different DB read order or a different file iteration order never reads as drift on its own. */
function countrySignature(rows: DocumentCountryActionRuleRow[]): string {
  return rows.map(rowContentKey).sort().join('\n');
}

export function detectCountryPolicyDrift(
  catalog: CountryPolicyCatalog,
  existingRows: DocumentCountryActionRuleRow[],
): CountryPolicyDriftReport {
  const countries = catalog.countries();
  const expectedByCountry = new Map<string, DocumentCountryActionRuleRow[]>(
    countries.map((countryCode) => [
      countryCode,
      catalog.rulesFor(countryCode).map((rule) => rowFor(countryCode, rule)),
    ]),
  );

  const actualByCountry = new Map<string, DocumentCountryActionRuleRow[]>();
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
