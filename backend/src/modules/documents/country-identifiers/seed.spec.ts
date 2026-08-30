import { CountryIdentifierRequirementsCatalog } from './registry';
import { IdentifierSchemeFact } from './schema';
import {
  PrismaCountryIdentifierRequirementsClient,
  CountryIdentifierRequirementRow,
  seedCountryIdentifierRequirements,
} from './seed';

/**
 * A tiny in-memory stand-in for the `CountryIdentifierRequirement` table — real
 * filtering/upsert/delete semantics, not canned mock returns, so these tests exercise the actual
 * idempotency logic in `seedCountryIdentifierRequirements` rather than merely asserting it called
 * the methods it calls. Same fixture shape as country-policy/seed.spec.ts's own
 * `FakeCountryPolicyTable`.
 */
class FakeCountryIdentifierRequirementsTable {
  rows: (CountryIdentifierRequirementRow & { id: string })[] = [];
  private nextId = 1;

  readonly client: PrismaCountryIdentifierRequirementsClient = {
    countryIdentifierRequirement: {
      upsert: async ({ where, create, update }) => {
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
        this.rows
          .filter((r) => r.countryCode === where.countryCode)
          .map((r) => ({ id: r.id, scheme: r.scheme })),
      deleteMany: async ({ where }) => {
        const ids = new Set(where.id.in);
        this.rows = this.rows.filter((r) => !ids.has(r.id));
        return null;
      },
    },
    $transaction: async (fn) => fn(this.client),
  };
}

function oneCountryFixture(countryCode: string, schemes: IdentifierSchemeFact[]) {
  return new CountryIdentifierRequirementsCatalog([{ countryCode, schemes }]);
}

const LEGAL_ID_FACT: IdentifierSchemeFact = {
  scheme: 'LEGAL_ID',
  appliesTo: 'BOTH',
  label: 'Fixture ID',
  required: true,
  provenance: { kind: 'legal', sourceText: 'fixture legal text', sourceCheckedAt: '2026-01-01' },
};

const VAT_FACT: IdentifierSchemeFact = {
  scheme: 'VAT',
  appliesTo: 'COMPANY',
  label: 'Fixture VAT',
  required: false,
  provenance: { kind: 'unverified', resolutionNote: 'fixture resolution note' },
};

describe('seedCountryIdentifierRequirements', () => {
  it('is idempotent: seeding the same catalog twice does not duplicate rows', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const catalog = oneCountryFixture('ZZ', [LEGAL_ID_FACT]);

    const first = await seedCountryIdentifierRequirements(table.client, catalog);
    expect(first.upserted).toBe(1);
    expect(table.rows).toHaveLength(1);

    const second = await seedCountryIdentifierRequirements(table.client, catalog);
    expect(second.upserted).toBe(1); // re-upserted, not re-inserted
    expect(second.deleted).toBe(0);
    expect(table.rows).toHaveLength(1); // still exactly one row
  });

  it('adding a scheme to the file is enough to make it appear on the next seed', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const before = oneCountryFixture('ZZ', [LEGAL_ID_FACT]);
    await seedCountryIdentifierRequirements(table.client, before);
    expect(table.rows).toHaveLength(1);

    const after = oneCountryFixture('ZZ', [LEGAL_ID_FACT, VAT_FACT]);
    const result = await seedCountryIdentifierRequirements(table.client, after);

    expect(result.upserted).toBe(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows.map((r) => r.scheme).sort()).toEqual(['LEGAL_ID', 'VAT']);
  });

  it('removing a scheme from the file removes its row on the next seed', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const before = oneCountryFixture('ZZ', [LEGAL_ID_FACT, VAT_FACT]);
    await seedCountryIdentifierRequirements(table.client, before);
    expect(table.rows).toHaveLength(2);

    const after = oneCountryFixture('ZZ', [LEGAL_ID_FACT]);
    const result = await seedCountryIdentifierRequirements(table.client, after);

    expect(result.deleted).toBe(1);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].scheme).toBe('LEGAL_ID');
  });

  it('editing a fact (e.g. flipping required) updates the row in place rather than duplicating it', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    await seedCountryIdentifierRequirements(table.client, oneCountryFixture('ZZ', [LEGAL_ID_FACT]));
    expect(table.rows[0].required).toBe(true);

    const optionalNow: IdentifierSchemeFact = { ...LEGAL_ID_FACT, required: false };
    await seedCountryIdentifierRequirements(table.client, oneCountryFixture('ZZ', [optionalNow]));

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].required).toBe(false);
  });

  it("seeds several countries independently — one country's rows never leak into another's", async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const catalog = new CountryIdentifierRequirementsCatalog([
      { countryCode: 'AA', schemes: [LEGAL_ID_FACT] },
      { countryCode: 'BB', schemes: [VAT_FACT] },
    ]);

    await seedCountryIdentifierRequirements(table.client, catalog);

    expect(table.rows.find((r) => r.countryCode === 'AA')?.scheme).toBe('LEGAL_ID');
    expect(table.rows.find((r) => r.countryCode === 'BB')?.scheme).toBe('VAT');
    expect(table.rows).toHaveLength(2);
  });

  // The provenance guard — the requirement this whole module exists to keep honest: a fact with no
  // sourced provenance must never reach the database, whatever catalog it arrives through (this
  // test builds one BY HAND, bypassing the JSON file loader in data/all.ts entirely, so it proves
  // the GUARD, not just that the shipped JSON files happen to be well-formed).
  it('a fact with NO provenance at all fails the whole seed — nothing is written, for any country', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const unsourced = {
      scheme: 'LEGAL_ID',
      appliesTo: 'BOTH',
      label: 'Fixture ID',
      required: true,
    } as IdentifierSchemeFact; // no `provenance` key
    const catalog = new CountryIdentifierRequirementsCatalog([
      { countryCode: 'ZZ', schemes: [unsourced] },
      { countryCode: 'AA', schemes: [LEGAL_ID_FACT] }, // a well-formed country, seeded FIRST alphabetically
    ]);

    await expect(seedCountryIdentifierRequirements(table.client, catalog)).rejects.toThrow(
      /no valid provenance/,
    );
    // Not a partial write: ZZ sorts after AA, so if the guard only ran per-transaction rather than
    // before ANY write, AA's row could have landed. It must not have.
    expect(table.rows).toHaveLength(0);
  });

  it('an "unverified" fact with no resolutionNote also fails the seed', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const bareUnverified: IdentifierSchemeFact = {
      scheme: 'LEGAL_ID',
      appliesTo: 'BOTH',
      label: 'Fixture ID',
      required: true,
      provenance: { kind: 'unverified' } as never,
    };

    await expect(
      seedCountryIdentifierRequirements(table.client, oneCountryFixture('ZZ', [bareUnverified])),
    ).rejects.toThrow(/no resolutionNote/);
    expect(table.rows).toHaveLength(0);
  });

  it('a "legal" fact with no sourceText also fails the seed', async () => {
    const table = new FakeCountryIdentifierRequirementsTable();
    const bareLegal: IdentifierSchemeFact = {
      scheme: 'LEGAL_ID',
      appliesTo: 'BOTH',
      label: 'Fixture ID',
      required: true,
      provenance: { kind: 'legal', sourceCheckedAt: '2026-01-01' } as never,
    };

    await expect(
      seedCountryIdentifierRequirements(table.client, oneCountryFixture('ZZ', [bareLegal])),
    ).rejects.toThrow(/missing sourceText/);
    expect(table.rows).toHaveLength(0);
  });
});
