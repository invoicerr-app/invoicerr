import { CountryPolicyCatalog } from './registry';
import { DocumentActionRuleFact } from './schema';
import { PrismaCountryPolicyClient, DocumentCountryActionRuleRow, seedCountryPolicies } from './seed';

/**
 * A tiny in-memory stand-in for the `DocumentCountryActionRule` table — real filtering/upsert/delete
 * semantics, not canned mock returns, so these tests exercise the actual idempotency logic in
 * `seedCountryPolicies` rather than merely asserting it called the methods it calls. Same fixture
 * shape as the (removed) VAT rate catalog's own `FakeVatRateTable` — see git history for that
 * precedent.
 */
class FakeCountryPolicyTable {
  rows: (DocumentCountryActionRuleRow & { id: string })[] = [];
  private nextId = 1;

  readonly client: PrismaCountryPolicyClient = {
    documentCountryActionRule: {
      upsert: async ({ where, create, update }) => {
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
        this.rows
          .filter((r) => r.countryCode === where.countryCode)
          .map((r) => ({ id: r.id, typeId: r.typeId, actionId: r.actionId })),
      deleteMany: async ({ where }) => {
        const ids = new Set(where.id.in);
        this.rows = this.rows.filter((r) => !ids.has(r.id));
        return null;
      },
    },
    $transaction: async (fn) => fn(this.client),
  };
}

function oneCountryFixture(countryCode: string, rules: DocumentActionRuleFact[]) {
  return new CountryPolicyCatalog([{ countryCode, rules }]);
}

const ALLOW_SEND: DocumentActionRuleFact = {
  typeId: 'invoice',
  actionId: 'send',
  allowed: true,
  provenance: { kind: 'legal', sourceText: 'fixture legal text', sourceCheckedAt: '2026-01-01' },
};

const ALLOW_SAVE_DRAFT: DocumentActionRuleFact = {
  typeId: 'invoice',
  actionId: 'save-draft',
  allowed: true,
  provenance: { kind: 'unverified', resolutionNote: 'fixture resolution note' },
};

describe('seedCountryPolicies', () => {
  it('is idempotent: seeding the same catalog twice does not duplicate rows', async () => {
    const table = new FakeCountryPolicyTable();
    const catalog = oneCountryFixture('ZZ', [ALLOW_SEND]);

    const first = await seedCountryPolicies(table.client, catalog);
    expect(first.upserted).toBe(1);
    expect(table.rows).toHaveLength(1);

    const second = await seedCountryPolicies(table.client, catalog);
    expect(second.upserted).toBe(1); // re-upserted, not re-inserted
    expect(second.deleted).toBe(0);
    expect(table.rows).toHaveLength(1); // still exactly one row
  });

  it('adding a rule to the file is enough to make it appear on the next seed', async () => {
    const table = new FakeCountryPolicyTable();
    const before = oneCountryFixture('ZZ', [ALLOW_SEND]);
    await seedCountryPolicies(table.client, before);
    expect(table.rows).toHaveLength(1);

    const after = oneCountryFixture('ZZ', [ALLOW_SEND, ALLOW_SAVE_DRAFT]);
    const result = await seedCountryPolicies(table.client, after);

    expect(result.upserted).toBe(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows.map((r) => r.actionId).sort()).toEqual(['save-draft', 'send']);
  });

  it('removing a rule from the file removes its row on the next seed', async () => {
    const table = new FakeCountryPolicyTable();
    const before = oneCountryFixture('ZZ', [ALLOW_SEND, ALLOW_SAVE_DRAFT]);
    await seedCountryPolicies(table.client, before);
    expect(table.rows).toHaveLength(2);

    const after = oneCountryFixture('ZZ', [ALLOW_SEND]);
    const result = await seedCountryPolicies(table.client, after);

    expect(result.deleted).toBe(1);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].actionId).toBe('send');
  });

  it('editing a rule (e.g. flipping allowed) updates the row in place rather than duplicating it', async () => {
    const table = new FakeCountryPolicyTable();
    await seedCountryPolicies(table.client, oneCountryFixture('ZZ', [ALLOW_SEND]));
    expect(table.rows[0].allowed).toBe(true);

    const forbidSend: DocumentActionRuleFact = { ...ALLOW_SEND, allowed: false };
    await seedCountryPolicies(table.client, oneCountryFixture('ZZ', [forbidSend]));

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].allowed).toBe(false);
  });

  it("seeds several countries independently — one country's rows never leak into another's", async () => {
    const table = new FakeCountryPolicyTable();
    const catalog = new CountryPolicyCatalog([
      { countryCode: 'AA', rules: [ALLOW_SEND] },
      { countryCode: 'BB', rules: [ALLOW_SAVE_DRAFT] },
    ]);

    await seedCountryPolicies(table.client, catalog);

    expect(table.rows.find((r) => r.countryCode === 'AA')?.actionId).toBe('send');
    expect(table.rows.find((r) => r.countryCode === 'BB')?.actionId).toBe('save-draft');
    expect(table.rows).toHaveLength(2);
  });

  // The provenance guard — the requirement this whole module exists to keep honest: a rule with no
  // sourced provenance must never reach the database, whatever catalog it arrives through (this test
  // builds one BY HAND, bypassing the JSON file loader in data/all.ts entirely, so it proves the
  // GUARD, not just that the shipped JSON files happen to be well-formed).
  it('a rule with NO provenance at all fails the whole seed — nothing is written, for any country', async () => {
    const table = new FakeCountryPolicyTable();
    const unsourced = { typeId: 'invoice', actionId: 'send', allowed: true } as DocumentActionRuleFact; // no `provenance` key
    const catalog = new CountryPolicyCatalog([
      { countryCode: 'ZZ', rules: [unsourced] },
      { countryCode: 'AA', rules: [ALLOW_SEND] }, // a well-formed country, seeded FIRST alphabetically
    ]);

    await expect(seedCountryPolicies(table.client, catalog)).rejects.toThrow(/no valid provenance/);
    // Not a partial write: ZZ sorts after AA, so if the guard only ran per-transaction rather than
    // before ANY write, AA's row could have landed. It must not have.
    expect(table.rows).toHaveLength(0);
  });

  it('an "unverified" rule with no resolutionNote also fails the seed', async () => {
    const table = new FakeCountryPolicyTable();
    const bareUnverified: DocumentActionRuleFact = {
      typeId: 'invoice',
      actionId: 'send',
      allowed: true,
      provenance: { kind: 'unverified' } as never,
    };

    await expect(
      seedCountryPolicies(table.client, oneCountryFixture('ZZ', [bareUnverified])),
    ).rejects.toThrow(/no resolutionNote/);
    expect(table.rows).toHaveLength(0);
  });

  it('a "legal" rule with no sourceText also fails the seed', async () => {
    const table = new FakeCountryPolicyTable();
    const bareLegal: DocumentActionRuleFact = {
      typeId: 'invoice',
      actionId: 'send',
      allowed: true,
      provenance: { kind: 'legal', sourceCheckedAt: '2026-01-01' } as never,
    };

    await expect(seedCountryPolicies(table.client, oneCountryFixture('ZZ', [bareLegal]))).rejects.toThrow(
      /missing sourceText/,
    );
    expect(table.rows).toHaveLength(0);
  });
});
