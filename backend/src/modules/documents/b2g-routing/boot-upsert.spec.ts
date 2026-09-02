/**
 * `upsertB2gRoutingRules` — the boot-time upsert (`boot-upsert.service.ts`'s own `OnModuleInit`),
 * proven here against a hand-rolled FAKE prisma client (an in-memory `Map<countryCode, row>`), the
 * same "loosely-typed, no real DB" testability `country-policy/seed.spec.ts` already established for
 * its own `seedCountryPolicies`.
 *
 * The task's own explicit ask: "le boot-upsert idempotent (2 boots → mêmes lignes ; un fichier
 * modifié → la ligne suit)".
 */
import { defaultB2gRoutingCatalog, B2gRoutingCatalog } from './registry';
import { B2gRoutingRuleFact } from './schema';
import { PrismaB2gRoutingClient, upsertB2gRoutingRules } from './boot-upsert';

function legalFact(overrides: Partial<B2gRoutingRuleFact> = {}): B2gRoutingRuleFact {
  return {
    countryCode: 'XX',
    transportId: 'transport-a',
    formatSyntax: 'format-a',
    requiredClientIdentifiers: [],
    requiredDocumentFields: [],
    provenance: { kind: 'legal', sourceText: 'Some Act, art. 1.', sourceCheckedAt: '2026-09-01' },
    ...overrides,
  };
}

interface FakeRow {
  id: string;
  countryCode: string;
  [key: string]: unknown;
}

/** An in-memory stand-in for the `B2gRoutingRule` table — countryCode is the natural key, exactly
 *  like the real `@unique` column, so `upsert` behaves the same way a real one would. */
function buildFakePrisma(): { client: PrismaB2gRoutingClient; rows: () => FakeRow[] } {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;

  const client: PrismaB2gRoutingClient = {
    b2gRoutingRule: {
      upsert: async ({ where, create, update }) => {
        const existing = rows.get(where.countryCode);
        if (existing) {
          rows.set(where.countryCode, { ...existing, ...update });
        } else {
          rows.set(where.countryCode, { id: `row-${nextId++}`, ...create, countryCode: where.countryCode });
        }
        return undefined;
      },
      findMany: async () => [...rows.values()].map(({ id, countryCode }) => ({ id, countryCode })),
      deleteMany: async ({ where }) => {
        for (const [key, row] of rows) {
          if (where.id.in.includes(row.id)) rows.delete(key);
        }
        return undefined;
      },
    },
  };

  return { client, rows: () => [...rows.values()] };
}

describe('upsertB2gRoutingRules', () => {
  it('creates one row per country the first time it runs', async () => {
    const { client, rows } = buildFakePrisma();
    const catalog = new B2gRoutingCatalog([
      legalFact({ countryCode: 'FR' }),
      legalFact({ countryCode: 'DE' }),
    ]);

    const summary = await upsertB2gRoutingRules(client, catalog);

    expect(summary).toEqual({ upserted: 2, deleted: 0 });
    expect(
      rows()
        .map((r) => r.countryCode)
        .sort(),
    ).toEqual(['DE', 'FR']);
  });

  it('IDEMPOTENT — booting twice with the SAME catalog produces the exact same rows, no duplicates', async () => {
    const { client, rows } = buildFakePrisma();
    const catalog = new B2gRoutingCatalog([legalFact({ countryCode: 'FR', transportId: 'chorus-pro' })]);

    await upsertB2gRoutingRules(client, catalog);
    const afterFirstBoot = rows();
    const summary = await upsertB2gRoutingRules(client, catalog);
    const afterSecondBoot = rows();

    expect(summary).toEqual({ upserted: 1, deleted: 0 });
    expect(afterSecondBoot).toHaveLength(1);
    expect(afterSecondBoot[0].id).toBe(afterFirstBoot[0].id); // SAME row, not a new one
    expect(afterSecondBoot).toEqual(afterFirstBoot);
  });

  it('a CHANGED file (a different transportId on reboot) updates the SAME row in place — the line follows the file', async () => {
    const { client, rows } = buildFakePrisma();
    const v1 = new B2gRoutingCatalog([legalFact({ countryCode: 'FR', transportId: 'chorus-pro' })]);
    await upsertB2gRoutingRules(client, v1);
    const idBefore = rows()[0].id;

    const v2 = new B2gRoutingCatalog([legalFact({ countryCode: 'FR', transportId: 'ppf' })]);
    await upsertB2gRoutingRules(client, v2);

    expect(rows()).toHaveLength(1);
    expect(rows()[0].id).toBe(idBefore); // same row identity (countryCode), new content
    expect(rows()[0].transportId).toBe('ppf');
  });

  it('a country REMOVED from the catalog deletes its stale row on the next boot', async () => {
    const { client, rows } = buildFakePrisma();
    const withBoth = new B2gRoutingCatalog([
      legalFact({ countryCode: 'FR' }),
      legalFact({ countryCode: 'DE' }),
    ]);
    await upsertB2gRoutingRules(client, withBoth);
    expect(rows()).toHaveLength(2);

    const withOnlyFr = new B2gRoutingCatalog([legalFact({ countryCode: 'FR' })]);
    const summary = await upsertB2gRoutingRules(client, withOnlyFr);

    expect(summary).toEqual({ upserted: 1, deleted: 1 });
    expect(rows().map((r) => r.countryCode)).toEqual(['FR']);
  });

  it('a rule with UNVERIFIED provenance still loads and upserts — every B2G rule is a mandate regardless of citation grade', async () => {
    const { client, rows } = buildFakePrisma();
    const catalog = new B2gRoutingCatalog([
      legalFact({
        countryCode: 'XX',
        provenance: { kind: 'unverified', resolutionNote: 'Read the primary text once reachable.' },
      }),
    ]);

    const summary = await upsertB2gRoutingRules(client, catalog);

    expect(summary.upserted).toBe(1);
    expect(rows()[0].provenanceKind).toBe('unverified');
  });

  it('refuses to write ANY row when one country in the catalog is malformed — never a half-seeded table', async () => {
    const { client, rows } = buildFakePrisma();
    const catalog = new B2gRoutingCatalog([
      legalFact({ countryCode: 'FR' }),
      // Malformed: claims "legal" without a real citation — assertValidB2gRoutingFact must catch this.
      legalFact({
        countryCode: 'DE',
        provenance: { kind: 'legal', sourceText: '', sourceCheckedAt: '' },
      }),
    ]);

    await expect(upsertB2gRoutingRules(client, catalog)).rejects.toThrow();
    expect(rows()).toHaveLength(0);
  });

  // The REAL catalog (`data/all.ts`'s 14 shipped files), not a hand-rolled fake — the ONE test in
  // this file that exercises the actual `defaultB2gRoutingCatalog` default parameter, proving what
  // `B2gRoutingBootUpsertService`'s own boot log line ("N upserted, M deleted") reports for a REAL
  // boot reflects what `data/*.json` actually ships, not just what a synthetic fixture claims. Pins
  // the count so it moves — deliberately — the moment a country is added or removed from that
  // directory, never silently drifting between the two.
  it("the REAL default catalog (every file under data/*.json) upserts exactly 14 rows at boot — the 2026-09-02 B2G audit's count", async () => {
    const { client, rows } = buildFakePrisma();

    const summary = await upsertB2gRoutingRules(client, defaultB2gRoutingCatalog);

    expect(summary).toEqual({ upserted: 14, deleted: 0 });
    expect(
      rows()
        .map((r) => r.countryCode)
        .sort(),
    ).toEqual(['BE', 'CY', 'DE', 'EE', 'ES', 'FR', 'GR', 'IT', 'LT', 'LU', 'LV', 'MT', 'PL', 'SE']);
  });
});
