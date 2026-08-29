/**
 * Prisma's own seed entry point (`migrations.seed` in prisma.config.ts) — runs automatically after
 * `prisma migrate dev` / `migrate reset`, and on demand via `prisma db seed`. Not a new invocation
 * point: this is the existing, standard Prisma extension for "make the DB match reference data after
 * migrating", used here for the VAT rate catalog (backend/src/compliance/tax-rates/). Production
 * self-hosted instances get the same seeding from `sync-schema.ts`'s `syncDatabaseSchema()`, already
 * called once on every boot from `main.ts` — see that file's `seedVatRates` call.
 */
import prisma from '../src/prisma/prisma.service';
import { seedVatRates } from '../src/compliance/tax-rates/seed';

async function main() {
  const summary = await seedVatRates(prisma);
  console.log(`[seed] VAT rates: ${summary.upserted} upserted, ${summary.deleted} deleted (stale)`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
