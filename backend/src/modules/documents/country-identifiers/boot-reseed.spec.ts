import {
  CountryIdentifierRequirementsCatalog,
  defaultCountryIdentifierRequirementsCatalog,
} from './registry';
import { IdentifierSchemeFact } from './schema';
import { CountryIdentifierRequirementRow, PrismaCountryIdentifierRequirementsClient } from './seed';
import { detectAndReseedCountryIdentifierRequirementsDrift } from './boot-reseed';

/**
 * `detectAndReseedCountryIdentifierRequirementsDrift` — sibling of
 * country-policy/boot-reseed.spec.ts, same fake-table discipline.
 */
class FakeCountryIdentifierRequirementsTable {
  rows: (CountryIdentifierRequirementRow & { id: string })[] = [];
  private nextId = 1;
  upsertCalls = 0;

  readonly client: PrismaCountryIdentifierRequirementsClient = {
    countryIdentifierRequirement: {
      upsert: async ({ where, create, update }) => {
        this.upsertCalls++;
        const key = where.countryCode_scheme;
        const existing = this.rows.find((r) => r.countryCode === key.countryCode && r.scheme === key.scheme);
        if (existing) {
          Object.assign(existing, update);
        } else {
          this.rows.push({ id: `row-${this.nextId++}`, ...create });
        }
        return null;
      },
      findMany: async ({ where }) =>
        this.rows.filter((r) => !where || r.countryCode === where.countryCode).map((r) => ({ ...r })),
      deleteMany: async ({ where }) => {
        const ids = new Set(where.id.in);
        this.rows = this.rows.filter((r) => !ids.has(r.id));
        return null;
      },
    },
    $transaction: async (fn) => fn(this.client),
  };
}

const LEGAL_ID_FACT: IdentifierSchemeFact = {
  scheme: 'LEGAL_ID',
  appliesTo: 'BOTH',
  label: 'Fixture ID',
  required: true,
  provenance: { kind: 'legal', sourceText: 'fixture legal text', sourceCheckedAt: '2026-01-01' },
};

function oneCountryFixture(countryCode: string, schemes: IdentifierSchemeFact[]) {
  return new CountryIdentifierRequirementsCatalog([{ countryCode, schemes }]);
}

describe('detectAndReseedCountryIdentifierRequirementsDrift', () => {
  it('a FRESH table (no rows at all) is drift, and gets fully seeded', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const catalog = oneCountryFixture('ZZ', [LEGAL_ID_FACT]);

    const summary = await detectAndReseedCountryIdentifierRequirementsDrift(table.client, catalog);

    expect(summary.reseeded).toBe(true);
    expect(summary.drift.addedCountries).toEqual(['ZZ']);
    expect(summary.upserted).toBe(1);
    expect(table.rows).toHaveLength(1);
  });

  it('a table ALREADY in sync is left alone — no write happens at all', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const catalog = oneCountryFixture('ZZ', [LEGAL_ID_FACT]);
    await detectAndReseedCountryIdentifierRequirementsDrift(table.client, catalog);
    const upsertCallsAfterFirstBoot = table.upsertCalls;

    const summary = await detectAndReseedCountryIdentifierRequirementsDrift(table.client, catalog);

    expect(summary.reseeded).toBe(false);
    expect(summary.drift.inSync).toBe(true);
    expect(summary.upserted).toBe(0);
    expect(summary.deleted).toBe(0);
    // The mutation this test is designed to catch: a version that always reseeds regardless of the
    // drift verdict would bump `upsertCalls` again here.
    expect(table.upsertCalls).toBe(upsertCallsAfterFirstBoot);
  });

  it('a CHANGED file is detected as drift AND corrected in the same call', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    await detectAndReseedCountryIdentifierRequirementsDrift(
      table.client,
      oneCountryFixture('ZZ', [LEGAL_ID_FACT]),
    );

    const optionalNow: IdentifierSchemeFact = { ...LEGAL_ID_FACT, required: false };
    const summary = await detectAndReseedCountryIdentifierRequirementsDrift(
      table.client,
      oneCountryFixture('ZZ', [optionalNow]),
    );

    expect(summary.reseeded).toBe(true);
    expect(summary.drift.changedCountries).toEqual(['ZZ']);
    expect(table.rows[0].required).toBe(false);
  });

  /**
   * THE MUTATION TARGET: a country REMOVED from the CURRENT PROCESS's own catalog is reported as
   * drift (so a genuine removal is still visible in `boot-reseed.service.ts`'s own log) but is
   * deliberately NEVER purged through this automatic, per-boot path — see
   * `seedCountryIdentifierRequirements`'s own `purgeRemovedCountries` doc comment (mirroring
   * country-policy/seed.ts's identical flag) for why: an OLD replica restarting with YESTERDAY's
   * catalog during a rolling deployment would otherwise see a country a NEWER replica already seeded
   * as "removed" (simply absent from the stale catalog it happens to be running) and delete it out
   * from under the new image. Only the deliberate, single-run `npm run catalogs:release`
   * (`scripts/release-catalogs.ts`) is allowed to actually purge a genuinely-removed country —
   * `sync-schema.ts`'s own boot path passes `false` too now, same reasoning.
   */
  it('a country REMOVED from the catalog entirely is detected as drift, reported, but NEVER purged through this automatic path', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const withBoth = new CountryIdentifierRequirementsCatalog([
      { countryCode: 'AA', schemes: [LEGAL_ID_FACT] },
      { countryCode: 'BB', schemes: [LEGAL_ID_FACT] },
    ]);
    await detectAndReseedCountryIdentifierRequirementsDrift(table.client, withBoth);

    const withOnlyAa = new CountryIdentifierRequirementsCatalog([
      { countryCode: 'AA', schemes: [LEGAL_ID_FACT] },
    ]);
    const summary = await detectAndReseedCountryIdentifierRequirementsDrift(table.client, withOnlyAa);

    expect(summary.reseeded).toBe(true);
    expect(summary.drift.removedCountries).toEqual(['BB']); // still NAMED, so the log still warns
    expect(summary.deleted).toBe(0); // but never ACTED ON by this automatic, per-boot path
    expect(table.rows.map((r) => r.countryCode).sort()).toEqual(['AA', 'BB']); // BB's rows survive
  });

  it('the REAL default catalog seeds cleanly on a fresh table with no drift-detection crash', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();

    const summary = await detectAndReseedCountryIdentifierRequirementsDrift(
      table.client,
      defaultCountryIdentifierRequirementsCatalog,
    );

    expect(summary.reseeded).toBe(true);
    expect(summary.upserted).toBeGreaterThan(0);
    expect(summary.deleted).toBe(0);
  });
});
