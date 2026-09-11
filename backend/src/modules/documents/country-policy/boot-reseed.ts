/**
 * The BOOT half of the fix for "`resetAndSeed` ne re-sème pas la politique pays"
 * note. Until now `DocumentCountryActionRule` was only ever written by `seedCountryPolicies` from
 * two entry points: `prisma/seed.ts` (the `migrate dev`/`migrate reset`/`db seed` hook —
 * `prisma.config.ts`'s `migrations.seed`) and `sync-schema.ts` (production API-role boot, called
 * from `main.ts` BEFORE Nest even starts). Neither runs for a dev/test backend that is simply
 * restarted, or for an already-migrated database an e2e run reuses — exactly the scenario that made
 * a JSON-only edit to `country-policy/data/*.json` silently 403 every document action until someone
 * remembered to run `prisma db seed` by hand.
 *
 * `readCountryActionRules` + `detectCountryPolicyDrift` (drift.ts, pure and independently spec'd) do
 * the DETECTION; this function decides what to do about it and, when there IS drift, calls the
 * existing `seedCountryPolicies` to actually fix it. See boot-reseed.service.ts for the
 * `OnModuleInit` wiring and the decision to run this in EVERY environment, including production.
 *
 * Reads before writing, and skips the write entirely when nothing has drifted — unlike
 * b2g-routing/boot-upsert.ts, which always re-upserts unconditionally (that table has no separate
 * detection step, so "upserted: 15" is logged every single boot whether or not anything changed).
 * This table's own policy files run bigger (every document type × every action × every country), so
 * a silent, log-worthy "nothing to do" outcome is worth distinguishing from a real correction rather
 * than reporting the same "N upserted" line at every boot regardless.
 */
import { CountryPolicyCatalog, defaultCountryPolicyCatalog } from './registry';
import { CountryPolicyDriftReport, detectCountryPolicyDrift } from './drift';
import { COUNTRY_POLICY_ROW_SELECT, PrismaCountryPolicyClient, seedCountryPolicies } from './seed';

export interface CountryPolicyBootReseedSummary {
  drift: CountryPolicyDriftReport;
  /** 0 when `drift.inSync` — no write was even attempted. */
  upserted: number;
  /** 0 when `drift.inSync`. */
  deleted: number;
  /** Whether `seedCountryPolicies` actually ran. */
  reseeded: boolean;
}

export async function detectAndReseedCountryPolicyDrift(
  prisma: PrismaCountryPolicyClient,
  catalog: CountryPolicyCatalog = defaultCountryPolicyCatalog,
): Promise<CountryPolicyBootReseedSummary> {
  const existingRows = await prisma.documentCountryActionRule.findMany({ select: COUNTRY_POLICY_ROW_SELECT });
  const drift = detectCountryPolicyDrift(catalog, existingRows);

  if (drift.inSync) {
    return { drift, upserted: 0, deleted: 0, reseeded: false };
  }

  const seedSummary = await seedCountryPolicies(prisma, catalog);
  return { drift, upserted: seedSummary.upserted, deleted: seedSummary.deleted, reseeded: true };
}
