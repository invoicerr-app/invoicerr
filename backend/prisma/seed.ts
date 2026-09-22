/**
 * Prisma's own seed entry point (`migrations.seed` in prisma.config.ts) — runs automatically after
 * `prisma migrate dev` / `migrate reset`, and on demand via `prisma db seed`. Not a new invocation
 * point: this is the existing, standard Prisma extension for "make the DB match reference data after
 * migrating", used here for the document-action country policy
 * (backend/src/modules/documents/country-policy/) and the country identifier-requirements catalog
 * (backend/src/modules/documents/country-identifiers/) — same "a country is data" family, seeded
 * the same way.
 *
 * DEV/CI ONLY — never a production release mechanism. `migrate dev`/`migrate reset`/`db seed` are
 * commands a developer or a CI job runs by hand against a throwaway database; production never runs
 * any of the three (it runs `migrate deploy` instead, from `sync-schema.ts`, which does NOT trigger
 * this Prisma seed hook at all). That is exactly why the two calls below are safe to leave on their
 * DEFAULT `purgeRemovedCountries: true` (whole-country purge included): a dev/CI database being
 * reset is never mid-rolling-deployment, so the race `seedCountryPolicies`'s own
 * `purgeRemovedCountries` doc comment names (an old replica racing a newer one's catalog) cannot
 * happen here. Production's equivalent, deliberate, single-run purge is
 * `scripts/release-catalogs.ts`'s `npm run catalogs:release` — see that file's own header; run it
 * once per deployment, never automatically.
 *
 * This file used to call the (removed) compliance engine's `seedVatRates` — that module no longer
 * exists (see `refactor!: suppression des documents légaux et du moteur de conformité`), which had
 * left this exact entry point pointing at nothing. Re-pointing it at the new country-policy seed
 * (rather than inventing a fourth entry point) is exactly the ask: reuse what already runs `migrate
 * dev`/`migrate reset`/`db seed`, don't add a new one.
 */
import prisma from '../src/prisma/prisma.service';
import { seedCountryPolicies } from '../src/modules/documents/country-policy/seed';
import { seedCountryIdentifierRequirements } from '../src/modules/documents/country-identifiers/seed';

async function main() {
  const summary = await seedCountryPolicies(prisma); // purgeRemovedCountries: true (default) — see header
  console.log(
    `[seed] document country policy: ${summary.upserted} upserted, ${summary.deleted} deleted (stale)`,
  );

  // Same idempotent reseed, same DEV/CI-only whole-country purge, for the SEPARATE country
  // identifier-requirements catalog (backend/src/modules/documents/country-identifiers/) — see that
  // seed's own header.
  const identifierSummary = await seedCountryIdentifierRequirements(prisma);
  console.log(
    `[seed] country identifier requirements: ${identifierSummary.upserted} upserted, ` +
      `${identifierSummary.deleted} deleted (stale)`,
  );
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
