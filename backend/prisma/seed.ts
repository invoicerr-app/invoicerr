/**
 * Prisma's own seed entry point (`migrations.seed` in prisma.config.ts) — runs automatically after
 * `prisma migrate dev` / `migrate reset`, and on demand via `prisma db seed`. Not a new invocation
 * point: this is the existing, standard Prisma extension for "make the DB match reference data after
 * migrating", used here for the document-action country policy
 * (backend/src/modules/documents/country-policy/). Production self-hosted instances get the same
 * seeding from `sync-schema.ts`'s `syncDatabaseSchema()`, already called once on every boot from
 * `main.ts` — see that file's `seedCountryPolicies` call.
 *
 * This file used to call the (removed) compliance engine's `seedVatRates` — that module no longer
 * exists (see `refactor!: suppression des documents légaux et du moteur de conformité`), which had
 * left this exact entry point pointing at nothing. Re-pointing it at the new country-policy seed
 * (rather than inventing a fourth entry point) is exactly the ask: reuse what already runs `migrate
 * dev`/`migrate reset`/`db seed`, don't add a new one.
 */
import prisma from '../src/prisma/prisma.service';
import { seedCountryPolicies } from '../src/modules/documents/country-policy/seed';

async function main() {
  const summary = await seedCountryPolicies(prisma);
  console.log(
    `[seed] document country policy: ${summary.upserted} upserted, ${summary.deleted} deleted (stale)`,
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
