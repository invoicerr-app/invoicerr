/**
 * CLI entry point for `releaseCatalogs()` (`src/prisma/release-catalogs.ts`) — the ONLY thing in
 * this codebase allowed to purge a country's rows from `DocumentCountryActionRule`,
 * `CountryIdentifierRequirement` or `B2gRoutingRule` once it drops out of `data/*.json`. Every
 * automatic boot path (`sync-schema.ts`, and the three `OnModuleInit` boot-reseed/boot-upsert
 * services, one per catalog) passes `purgeRemovedCountries: false` instead — see
 * `src/prisma/release-catalogs.ts`'s own header for the full "why not at boot" account.
 *
 * Run once per deployment that changes any of those three catalogs — never automatically:
 *   cd backend && npm run catalogs:release
 *
 * Same "run by hand, after the fact" shape as `scripts/sync-legal-docs.ts`. Imports from `../src/`
 * with no file extension, same as `prisma/seed.ts` — resolved by `tsx` against the real TypeScript
 * source in a dev checkout, and against the already-compiled `.js` sibling in the shipped
 * production image (the Dockerfile flattens `dist/src/**` onto `backend/src/**`, so this exact
 * import path lands on real code either way; see the Dockerfile's own comment on that COPY).
 */
import prisma from '../src/prisma/prisma.service';
import { releaseCatalogs } from '../src/prisma/release-catalogs';

async function main() {
  const summary = await releaseCatalogs(prisma);

  for (const [catalogName, counts] of Object.entries(summary)) {
    const removedNote =
      counts.removedCountries.length > 0
        ? ` — countries removed entirely: ${counts.removedCountries.join(', ')}`
        : '';
    console.log(
      `[catalogs:release] ${catalogName}: ${counts.upserted} upserted, ${counts.deleted} deleted${removedNote}`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[catalogs:release] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
