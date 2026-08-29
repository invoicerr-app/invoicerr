import { VatRateCatalog } from './registry';
import { CountryVatRatesFile } from './schema';
import { PrismaVatRateClient, VatRateRow, seedVatRates } from './seed';

/**
 * A tiny in-memory stand-in for the `VatRate` table — real filtering/upsert/delete semantics, not
 * canned mock returns, so these tests exercise the actual idempotency logic in `seedVatRates`
 * rather than merely asserting it called the methods it calls.
 */
class FakeVatRateTable {
  rows: (VatRateRow & { id: string })[] = [];
  private nextId = 1;

  readonly client: PrismaVatRateClient = {
    vatRate: {
      upsert: async ({ where, create, update }) => {
        const key = where.countryCode_sourceId_validFrom;
        const existing = this.rows.find(
          (r) =>
            r.countryCode === key.countryCode &&
            r.sourceId === key.sourceId &&
            r.validFrom.getTime() === key.validFrom.getTime(),
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
          .map((r) => ({ id: r.id, sourceId: r.sourceId, validFrom: r.validFrom })),
      deleteMany: async ({ where }) => {
        const ids = new Set(where.id.in);
        this.rows = this.rows.filter((r) => !ids.has(r.id));
        return null;
      },
    },
    $transaction: async (fn) => fn(this.client),
  };
}

function oneCountryFixture(rates: CountryVatRatesFile['rates']): CountryVatRatesFile[] {
  return [{ countryCode: 'ZZ', rates }];
}

const STANDARD_20 = {
  validFrom: '1900-01-01',
  value: {
    id: 'zz-standard',
    rate: 20,
    label: 'Standard',
    category: 'STANDARD' as const,
    confidence: 'OFFICIAL' as const,
    source: 'fixture',
    sourceCheckedAt: '2026-01-01',
  },
};

describe('seedVatRates', () => {
  it('is idempotent: seeding the same catalog twice does not duplicate rows', async () => {
    const table = new FakeVatRateTable();
    const catalog = new VatRateCatalog(oneCountryFixture([STANDARD_20]));

    const first = await seedVatRates(table.client, catalog);
    expect(first.upserted).toBe(1);
    expect(table.rows).toHaveLength(1);

    const second = await seedVatRates(table.client, catalog);
    expect(second.upserted).toBe(1); // re-upserted, not re-inserted
    expect(second.deleted).toBe(0);
    expect(table.rows).toHaveLength(1); // still exactly one row
  });

  it('adding a rate to the file is enough to make it appear on the next seed', async () => {
    const table = new FakeVatRateTable();
    const before = new VatRateCatalog(oneCountryFixture([STANDARD_20]));
    await seedVatRates(table.client, before);
    expect(table.rows).toHaveLength(1);

    const REDUCED_10 = {
      validFrom: '1900-01-01',
      value: {
        id: 'zz-reduced',
        rate: 10,
        label: 'Reduced',
        category: 'REDUCED' as const,
        confidence: 'OFFICIAL' as const,
        source: 'fixture',
        sourceCheckedAt: '2026-01-01',
      },
    };
    const after = new VatRateCatalog(oneCountryFixture([STANDARD_20, REDUCED_10]));
    const summary = await seedVatRates(table.client, after);

    expect(summary.upserted).toBe(2); // both re-upserted this pass
    expect(table.rows).toHaveLength(2);
    expect(table.rows.some((r) => r.sourceId === 'zz-reduced' && r.rate === 10)).toBe(true);
  });

  it('editing a rate value in the file updates the existing row in place (no duplicate)', async () => {
    const table = new FakeVatRateTable();
    const before = new VatRateCatalog(oneCountryFixture([STANDARD_20]));
    await seedVatRates(table.client, before);

    const changed = new VatRateCatalog(
      oneCountryFixture([{ ...STANDARD_20, value: { ...STANDARD_20.value, rate: 21 } }]),
    );
    await seedVatRates(table.client, changed);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].rate).toBe(21);
  });

  it('removing a rate from the file makes it disappear on the next seed', async () => {
    const table = new FakeVatRateTable();
    const REDUCED_10 = {
      validFrom: '1900-01-01',
      value: {
        id: 'zz-reduced',
        rate: 10,
        label: 'Reduced',
        category: 'REDUCED' as const,
        confidence: 'OFFICIAL' as const,
        source: 'fixture',
        sourceCheckedAt: '2026-01-01',
      },
    };
    const withBoth = new VatRateCatalog(oneCountryFixture([STANDARD_20, REDUCED_10]));
    await seedVatRates(table.client, withBoth);
    expect(table.rows).toHaveLength(2);

    const onlyStandard = new VatRateCatalog(oneCountryFixture([STANDARD_20]));
    const summary = await seedVatRates(table.client, onlyStandard);

    expect(summary.deleted).toBe(1);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].sourceId).toBe('zz-standard');
  });

  it('a rate change over time (same id, new validFrom) seeds as a second, distinct row', async () => {
    const table = new FakeVatRateTable();
    // Two windows for the SAME id, distinguished by validFrom — reflects the real fr.json shape
    // (19.6% until 2014-01-01, then 20%).
    const realistic = new VatRateCatalog(
      oneCountryFixture([
        { validFrom: '1900-01-01', validTo: '2020-01-01', value: { ...STANDARD_20.value, rate: 18 } },
        { validFrom: '2020-01-01', value: { ...STANDARD_20.value, rate: 20 } },
      ]),
    );

    const summary = await seedVatRates(table.client, realistic);
    expect(summary.upserted).toBe(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows.map((r) => r.rate).sort()).toEqual([18, 20]);

    // Both rows survive an idempotent reseed.
    const again = await seedVatRates(table.client, realistic);
    expect(again.deleted).toBe(0);
    expect(table.rows).toHaveLength(2);
  });

  it('seeds the real catalog (FR/IT/PL/MX) without throwing and without deleting anything from empty', async () => {
    const table = new FakeVatRateTable();
    const summary = await seedVatRates(table.client);
    expect(summary.upserted).toBeGreaterThan(0);
    expect(summary.deleted).toBe(0);
    expect(table.rows.some((r) => r.countryCode === 'FR' && r.sourceId === 'fr-standard')).toBe(true);
  });
});
