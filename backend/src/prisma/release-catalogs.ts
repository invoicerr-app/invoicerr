/**
 * The DELIBERATE, single-run purge for every country catalog that mirrors itself into the
 * database — `country-policy`, `country-identifiers`, `b2g-routing` today. See each catalog's own
 * `purgeRemovedCountries` doc comment (`country-policy/seed.ts`, `country-identifiers/seed.ts`,
 * `b2g-routing/boot-upsert.ts`) for why NO automatic boot path — `sync-schema.ts`'s production
 * boot, or any of the three `OnModuleInit` boot-reseed/boot-upsert services running per-replica —
 * is allowed to purge a whole country's rows: an old replica (or a single self-hosted instance)
 * still running yesterday's shorter catalog must never be the thing that deletes a country a
 * newer image already seeded, mid-rollout. Something still has to purge a country once it is
 * GENUINELY gone from `data/*.json`, or its rows (and, for country-policy/country-identifiers, any
 * stale per-rule/per-scheme row within a KEPT country from those same automatic paths refusing to
 * touch it) would linger forever. This function is that something — see
 * `backend/scripts/release-catalogs.ts` for the CLI entry point (`npm run catalogs:release`), meant
 * to run once per deployment that changes any of the three catalogs, never automatically.
 *
 * Idempotent: an unchanged catalog upserts the same rows and purges nothing further on a repeat
 * run — the same guarantee every underlying seed/upsert function already provides on its own.
 */
import {
  COUNTRY_POLICY_ROW_SELECT,
  PrismaCountryPolicyClient,
  seedCountryPolicies,
} from '../modules/documents/country-policy/seed';
import { defaultCountryPolicyCatalog } from '../modules/documents/country-policy/registry';
import {
  COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT,
  PrismaCountryIdentifierRequirementsClient,
  seedCountryIdentifierRequirements,
} from '../modules/documents/country-identifiers/seed';
import { defaultCountryIdentifierRequirementsCatalog } from '../modules/documents/country-identifiers/registry';
import { PrismaB2gRoutingClient, upsertB2gRoutingRules } from '../modules/documents/b2g-routing/boot-upsert';
import { defaultB2gRoutingCatalog } from '../modules/documents/b2g-routing/registry';

// Deliberately loosely typed, not the generated Prisma Client type — same reasoning as each
// underlying seed/upsert function's own client interface (see their headers): an internal release
// utility, not a public API, trivially driven by a hand-rolled fake in tests
// (release-catalogs.spec.ts). Reuses the three catalogs' own row-select constants for the
// "which countries existed before this run" reads below, rather than declaring a fourth, narrower
// select shape that could quietly drift from what `deleteMany`'s own comparison actually uses.
//
// Built from indexed-access member types (`PrismaCountryPolicyClient['documentCountryActionRule']`)
// rather than `extends PrismaCountryPolicyClient, PrismaCountryIdentifierRequirementsClient, ...`:
// the two seeds' own `$transaction` signatures are each self-referential (`(tx: <own client type>)
// => ...`), and TypeScript refuses to merge two DIFFERENT self-referential `$transaction` shapes via
// `extends` ("Named property '$transaction' ... are not identical"). Declaring `$transaction` once
// here, self-referential to THIS interface, sidesteps the conflict entirely — and is exactly as
// truthful: a real Prisma client's `$transaction` really does hand back a client with every table
// this interface names, for any subset of them a caller asks for.
export interface PrismaCatalogReleaseClient {
  documentCountryActionRule: PrismaCountryPolicyClient['documentCountryActionRule'];
  countryIdentifierRequirement: PrismaCountryIdentifierRequirementsClient['countryIdentifierRequirement'];
  b2gRoutingRule: PrismaB2gRoutingClient['b2gRoutingRule'];
  $transaction: <T>(fn: (tx: PrismaCatalogReleaseClient) => Promise<T>) => Promise<T>;
}

export interface CatalogReleaseCounts {
  upserted: number;
  deleted: number;
  /** Countries that had at least one row before this run but are absent from the catalog now —
   *  named here because `upserted`/`deleted` alone only ever report a COUNT, never WHICH country a
   *  deletion belonged to, and "which country did this run just remove" is exactly what an operator
   *  needs to see before trusting a release that touches production data. */
  removedCountries: string[];
}

export interface CatalogReleaseSummary {
  countryPolicy: CatalogReleaseCounts;
  countryIdentifiers: CatalogReleaseCounts;
  b2gRouting: CatalogReleaseCounts;
}

function removedCountries(existingCountryCodes: string[], keptCountryCodes: readonly string[]): string[] {
  const keep = new Set(keptCountryCodes);
  return [...new Set(existingCountryCodes)].filter((code) => !keep.has(code)).sort();
}

export async function releaseCatalogs(prisma: PrismaCatalogReleaseClient): Promise<CatalogReleaseSummary> {
  // Snapshot which countries the DB already knows about BEFORE seeding, purely to name them in the
  // returned summary — see `CatalogReleaseCounts.removedCountries`'s own doc comment for why this
  // read has to happen up front, before the purge it is reporting on has already erased the evidence.
  const [policyRowsBefore, identifierRowsBefore, b2gRowsBefore] = await Promise.all([
    prisma.documentCountryActionRule.findMany({ select: COUNTRY_POLICY_ROW_SELECT }),
    prisma.countryIdentifierRequirement.findMany({ select: COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT }),
    prisma.b2gRoutingRule.findMany({ select: { id: true, countryCode: true } }),
  ]);

  const removedPolicyCountries = removedCountries(
    policyRowsBefore.map((row) => row.countryCode),
    defaultCountryPolicyCatalog.countries(),
  );
  const removedIdentifierCountries = removedCountries(
    identifierRowsBefore.map((row) => row.countryCode),
    defaultCountryIdentifierRequirementsCatalog.countries(),
  );
  const removedB2gCountries = removedCountries(
    b2gRowsBefore.map((row) => row.countryCode),
    defaultB2gRoutingCatalog.countries(),
  );

  // `purgeRemovedCountries: true` on all three — explicit, not relying on each function's own
  // default, so this call site stays the correct, self-documenting answer to "where does the actual
  // purge happen" even if a future change ever flipped one of those defaults.
  const countryPolicy = await seedCountryPolicies(prisma, defaultCountryPolicyCatalog, true);
  const countryIdentifiers = await seedCountryIdentifierRequirements(
    prisma,
    defaultCountryIdentifierRequirementsCatalog,
    true,
  );
  const b2gRouting = await upsertB2gRoutingRules(prisma, defaultB2gRoutingCatalog, true);

  return {
    countryPolicy: { ...countryPolicy, removedCountries: removedPolicyCountries },
    countryIdentifiers: { ...countryIdentifiers, removedCountries: removedIdentifierCountries },
    b2gRouting: { ...b2gRouting, removedCountries: removedB2gCountries },
  };
}
