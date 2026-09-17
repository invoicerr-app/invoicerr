/**
 * The BOOT half of the fix for the "`resetAndSeed` does not reseed the country policy"
 * note, extended to `CountryIdentifierRequirement` — the sibling table shares the identical gap (see
 * country-policy/boot-reseed.ts's own header for the full history). `readCountryIdentifierRequirements`
 * + `detectCountryIdentifierRequirementsDrift` (drift.ts, pure and independently spec'd) do the
 * DETECTION; this function decides what to do about it and, when there IS drift, calls the existing
 * `seedCountryIdentifierRequirements` to actually fix it — see boot-reseed.service.ts for the
 * `OnModuleInit` wiring and the decision to run this in EVERY environment, including production.
 */
import {
  CountryIdentifierRequirementsCatalog,
  defaultCountryIdentifierRequirementsCatalog,
} from './registry';
import { CountryIdentifierRequirementsDriftReport, detectCountryIdentifierRequirementsDrift } from './drift';
import {
  COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT,
  PrismaCountryIdentifierRequirementsClient,
  seedCountryIdentifierRequirements,
} from './seed';

export interface CountryIdentifierRequirementsBootReseedSummary {
  drift: CountryIdentifierRequirementsDriftReport;
  /** 0 when `drift.inSync` — no write was even attempted. */
  upserted: number;
  /** 0 when `drift.inSync`. */
  deleted: number;
  /** Whether `seedCountryIdentifierRequirements` actually ran. */
  reseeded: boolean;
}

export async function detectAndReseedCountryIdentifierRequirementsDrift(
  prisma: PrismaCountryIdentifierRequirementsClient,
  catalog: CountryIdentifierRequirementsCatalog = defaultCountryIdentifierRequirementsCatalog,
): Promise<CountryIdentifierRequirementsBootReseedSummary> {
  const existingRows = await prisma.countryIdentifierRequirement.findMany({
    select: COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT,
  });
  const drift = detectCountryIdentifierRequirementsDrift(catalog, existingRows);

  if (drift.inSync) {
    return { drift, upserted: 0, deleted: 0, reseeded: false };
  }

  // `purgeRemovedCountries: false` — this is the ONLINE, per-process-boot path, running in EVERY
  // replica (API and worker alike) on EVERY boot, never the deliberate, single-run reseed
  // (`prisma/seed.ts`, `sync-schema.ts`) — see `seedCountryIdentifierRequirements`'s own parameter
  // doc comment (and country-policy/boot-reseed.ts's own call site, which this mirrors) for the full
  // "a stale replica would otherwise delete a newer replica's own country" reasoning. A country that
  // genuinely looks removed is still named in `drift.removedCountries` (and logged loudly by
  // `boot-reseed.service.ts`) — it is simply never ACTED ON by this automatic path.
  const seedSummary = await seedCountryIdentifierRequirements(prisma, catalog, false);
  return { drift, upserted: seedSummary.upserted, deleted: seedSummary.deleted, reseeded: true };
}
