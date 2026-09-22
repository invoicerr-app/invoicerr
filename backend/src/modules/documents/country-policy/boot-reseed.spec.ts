import { CountryPolicyCatalog, defaultCountryPolicyCatalog } from './registry';
import { DocumentActionRuleFact } from './schema';
import { DocumentCountryActionRuleRow, PrismaCountryPolicyClient } from './seed';
import { detectAndReseedCountryPolicyDrift } from './boot-reseed';

/**
 * `detectAndReseedCountryPolicyDrift` — the DECIDE-then-write half (boot-reseed.service.ts's own
 * `OnModuleInit` calls this). Driven against the SAME kind of hand-rolled, in-memory fake Prisma
 * client `seed.spec.ts`/`b2g-routing/boot-upsert.spec.ts` already use, real
 * filter/upsert/delete semantics included — so these tests prove the actual decision logic (does it
 * write when it should, does it skip when it shouldn't), not just that it called the methods it
 * calls.
 */
class FakeCountryPolicyTable {
  rows: (DocumentCountryActionRuleRow & { id: string })[] = [];
  private nextId = 1;
  /** How many times `upsert` was actually called across the whole run — the "did it skip the write
   *  entirely when in sync" assertion needs this, since `deleted`/`upserted` alone can't distinguish
   *  "wrote 0 rows because there was nothing to do" from "the catalog itself is empty". */
  upsertCalls = 0;

  readonly client: PrismaCountryPolicyClient = {
    documentCountryActionRule: {
      upsert: async ({ where, create, update }) => {
        this.upsertCalls++;
        const key = where.countryCode_typeId_actionId;
        const existing = this.rows.find(
          (r) => r.countryCode === key.countryCode && r.typeId === key.typeId && r.actionId === key.actionId,
        );
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

const ALLOW_SEND: DocumentActionRuleFact = {
  typeId: 'invoice',
  actionId: 'send',
  allowed: true,
  provenance: { kind: 'legal', sourceText: 'fixture legal text', sourceCheckedAt: '2026-01-01' },
};

function oneCountryFixture(countryCode: string, rules: DocumentActionRuleFact[]) {
  return new CountryPolicyCatalog([{ countryCode, rules }]);
}

describe('detectAndReseedCountryPolicyDrift', () => {
  it('a FRESH table (no rows at all) is drift, and gets fully seeded', async () => {
    const table = new FakeCountryPolicyTable();
    const catalog = oneCountryFixture('ZZ', [ALLOW_SEND]);

    const summary = await detectAndReseedCountryPolicyDrift(table.client, catalog);

    expect(summary.reseeded).toBe(true);
    expect(summary.drift.addedCountries).toEqual(['ZZ']);
    expect(summary.upserted).toBe(1);
    expect(table.rows).toHaveLength(1);
  });

  it('a table ALREADY in sync is left alone — no write happens at all', async () => {
    const table = new FakeCountryPolicyTable();
    const catalog = oneCountryFixture('ZZ', [ALLOW_SEND]);
    await detectAndReseedCountryPolicyDrift(table.client, catalog); // first boot: seeds it
    const upsertCallsAfterFirstBoot = table.upsertCalls;

    const summary = await detectAndReseedCountryPolicyDrift(table.client, catalog); // second boot: same catalog

    expect(summary.reseeded).toBe(false);
    expect(summary.drift.inSync).toBe(true);
    expect(summary.upserted).toBe(0);
    expect(summary.deleted).toBe(0);
    // The mutation this test is designed to catch: a version that always calls `seedCountryPolicies`
    // regardless of the drift verdict would bump `upsertCalls` again here.
    expect(table.upsertCalls).toBe(upsertCallsAfterFirstBoot);
  });

  it('a CHANGED file is detected as drift AND corrected in the same call', async () => {
    const table = new FakeCountryPolicyTable();
    await detectAndReseedCountryPolicyDrift(table.client, oneCountryFixture('ZZ', [ALLOW_SEND]));

    const forbidSend: DocumentActionRuleFact = { ...ALLOW_SEND, allowed: false };
    const summary = await detectAndReseedCountryPolicyDrift(
      table.client,
      oneCountryFixture('ZZ', [forbidSend]),
    );

    expect(summary.reseeded).toBe(true);
    expect(summary.drift.changedCountries).toEqual(['ZZ']);
    expect(table.rows[0].allowed).toBe(false); // actually corrected, not just detected
  });

  /**
   * THE MUTATION TARGET: a country REMOVED from the CURRENT PROCESS's own catalog is reported as
   * drift (so a genuine removal is still visible in `boot-reseed.service.ts`'s own log) but is
   * deliberately NEVER purged through this automatic, per-boot path — see `seedCountryPolicies`'s own
   * `purgeRemovedCountries` doc comment for why: an OLD replica restarting with YESTERDAY's catalog
   * during a rolling deployment would otherwise see a country a NEWER replica already seeded as
   * "removed" (simply absent from the stale catalog it happens to be running) and delete it out from
   * under the new image. Only the deliberate, single-run `npm run catalogs:release`
   * (`scripts/release-catalogs.ts`) is allowed to actually purge a genuinely-removed country —
   * `sync-schema.ts`'s own boot path passes `false` too now, same reasoning — see seed.spec.ts's own
   * coverage of that.
   */
  it('a country REMOVED from the catalog entirely is detected as drift, reported, but NEVER purged through this automatic path', async () => {
    const table = new FakeCountryPolicyTable();
    const withBoth = new CountryPolicyCatalog([
      { countryCode: 'AA', rules: [ALLOW_SEND] },
      { countryCode: 'BB', rules: [ALLOW_SEND] },
    ]);
    await detectAndReseedCountryPolicyDrift(table.client, withBoth);

    const withOnlyAa = new CountryPolicyCatalog([{ countryCode: 'AA', rules: [ALLOW_SEND] }]);
    const summary = await detectAndReseedCountryPolicyDrift(table.client, withOnlyAa);

    expect(summary.reseeded).toBe(true);
    expect(summary.drift.removedCountries).toEqual(['BB']); // still NAMED, so the log still warns
    expect(summary.deleted).toBe(0); // but never ACTED ON by this automatic, per-boot path
    expect(table.rows.map((r) => r.countryCode).sort()).toEqual(['AA', 'BB']); // BB's rows survive
  });

  // The REAL catalog, not a hand-rolled fixture — proves the real `data/*.json` files load and seed
  // cleanly through this path too, the same "one test against the shipped default" discipline
  // `b2g-routing/boot-upsert.spec.ts` already holds for its own default catalog.
  it('the REAL default catalog seeds cleanly on a fresh table with no drift-detection crash', async () => {
    const table = new FakeCountryPolicyTable();

    const summary = await detectAndReseedCountryPolicyDrift(table.client, defaultCountryPolicyCatalog);

    expect(summary.reseeded).toBe(true);
    expect(summary.upserted).toBeGreaterThan(0);
    expect(summary.deleted).toBe(0);
  });
});
