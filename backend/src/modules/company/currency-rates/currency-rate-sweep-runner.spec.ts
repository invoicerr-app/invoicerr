import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { CurrencyRateSweepRunner } from './currency-rate-sweep-runner';
import { fetchEcbDailyRates } from './ecb-rates-client';
import { fetchOpenErApiRates } from './open-er-api-rates-client';

// Same "mock the prisma singleton default export" shape archive/persistence.spec.ts and
// conformity/authority-events.persistence.spec.ts already use for a plain-function persistence file
// — this runner talks to `prisma.currencyRate` directly, never through a service class.
// `company.findMany`/`client.groupBy`/`documentPayment.groupBy`/`$queryRaw` back the scope (b)
// queries (#574) — `findCompanyReferenceCurrencies`/`findUsedCurrenciesByCompany`/
// `findPaymentDocumentCurrencyPairs` in currency-rate-sweep-runner.ts.
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    currencyRate: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
    },
    client: {
      groupBy: vi.fn(),
    },
    documentPayment: {
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('./ecb-rates-client');
vi.mock('./open-er-api-rates-client');

const findMany = prisma.currencyRate.findMany as Mock;
const createMany = prisma.currencyRate.createMany as Mock;
const companyFindMany = prisma.company.findMany as Mock;
const clientGroupBy = prisma.client.groupBy as Mock;
const documentPaymentGroupBy = prisma.documentPayment.groupBy as Mock;
const queryRaw = prisma.$queryRaw as unknown as Mock;
const fetchEcb = fetchEcbDailyRates as Mock;
const fetchOpenErApi = fetchOpenErApiRates as Mock;

describe('CurrencyRateSweepRunner.runSweep', () => {
  // Scope (b) (#574) defaults to "nothing used, no company has a reference currency" for every test
  // below that doesn't say otherwise — `vi.resetAllMocks()` in `afterEach` wipes these between tests,
  // so a fresh `beforeEach` is what keeps the PRE-#574 tests (scope (a) only) passing unmodified: they
  // never cared about usage-derived pairs, and this keeps it that way instead of touching all seven.
  beforeEach(() => {
    companyFindMany.mockResolvedValue([]);
    clientGroupBy.mockResolvedValue([]);
    documentPaymentGroupBy.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
  });

  afterEach(() => vi.resetAllMocks());

  it('inserts one ecb-sourced row, with the right shape, for an existing company pair', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
    findMany
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'USD' }]) // active pairs
      .mockResolvedValueOnce([]); // no ecb/fallback row yet for this asOf

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 1, skipped: 0 });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId: 'company-1',
          from: 'EUR',
          to: 'USD',
          rate: '1.0812',
          asOf: new Date('2026-09-11T00:00:00.000Z'),
          source: 'ecb',
        },
      ],
    });
    // Definition-of-done item 2: both legs are ECB-covered, so nothing about the fallback is even
    // consulted — proves "same source, same behaviour" for the common case, not just "same result".
    expect(fetchOpenErApi).not.toHaveBeenCalled();
  });

  it('is idempotent — a pair already refreshed for the same (company, from, to, asOf) is skipped', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
    findMany
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'USD' }])
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'USD' }]); // already refreshed today

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 0, skipped: 1 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('skips a pair NEITHER source covers, without inserting a guessed rate', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) }); // no MRO
    fetchOpenErApi.mockResolvedValue({ rates: new Map([['USD', 1.16]]) }); // no MRO either — obsolete code
    findMany
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'MRO' }])
      .mockResolvedValueOnce([]);

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 0, skipped: 1 });
    expect(createMany).not.toHaveBeenCalled();
    // The fallback WAS tried (this is the "neither source" case, not "ECB-only"), just came up empty
    // too — proves the runner doesn't give up after the ECB alone.
    expect(fetchOpenErApi).toHaveBeenCalledTimes(1);
  });

  it('falls back to open.er-api.com for a pair the ECB does not cover, tagging the row with its OWN source', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) }); // no MAD
    fetchOpenErApi.mockResolvedValue({ rates: new Map([['MAD', 10.90371]]) });
    findMany
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'MAD' }])
      .mockResolvedValueOnce([]);

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 1, skipped: 0 });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          companyId: 'company-1',
          from: 'EUR',
          to: 'MAD',
          rate: '10.90371',
          asOf: new Date('2026-09-11T00:00:00.000Z'),
          // NEVER 'ecb' — this row was resolved through the fallback, and a reader must be able to
          // tell the two apart (definition-of-done item 1).
          source: 'exchangerate-api',
        },
      ],
    });
  });

  it('fetches the fallback at most ONCE per pass even when several pairs all need it', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map() }); // covers nothing
    fetchOpenErApi.mockResolvedValue({
      rates: new Map([
        ['MAD', 10.9],
        ['AED', 4.26],
      ]),
    });
    findMany
      .mockResolvedValueOnce([
        { companyId: 'company-1', from: 'EUR', to: 'MAD' },
        { companyId: 'company-1', from: 'EUR', to: 'AED' },
      ])
      .mockResolvedValueOnce([]);

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 2, skipped: 0 });
    expect(fetchOpenErApi).toHaveBeenCalledTimes(1);
  });

  it('does not crash the pass when the fallback itself fails — the pair is simply skipped', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map() }); // no MAD
    fetchOpenErApi.mockRejectedValue(new Error('open.er-api.com rates feed responded with HTTP 503'));
    findMany
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'MAD' }])
      .mockResolvedValueOnce([]);

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 0, skipped: 1 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('never throws when the ECB fetch fails — reports the failure instead of crashing the processor', async () => {
    fetchEcb.mockRejectedValue(new Error('ECB daily rates feed responded with HTTP 503'));

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({
      ok: false,
      companiesProcessed: 0,
      inserted: 0,
      skipped: 0,
      error: 'ECB daily rates feed responded with HTTP 503',
    });
    // Never even queried Postgres once the ECB leg itself failed — nothing to compute against.
    expect(findMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('processes multiple companies/pairs in one pass, mixing inserted and skipped outcomes', async () => {
    fetchEcb.mockResolvedValue({
      referenceDate: '2026-09-11',
      rates: new Map([
        ['USD', 1.0812],
        ['GBP', 0.8567],
      ]),
    });
    fetchOpenErApi.mockResolvedValue({ rates: new Map([['USD', 1.16]]) }); // no ZZZ either
    findMany
      .mockResolvedValueOnce([
        { companyId: 'company-1', from: 'EUR', to: 'USD' }, // fresh -> inserted
        { companyId: 'company-2', from: 'USD', to: 'GBP' }, // fresh -> inserted
        { companyId: 'company-2', from: 'EUR', to: 'ZZZ' }, // uncovered -> skipped
      ])
      .mockResolvedValueOnce([]); // nothing refreshed yet today

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result).toEqual({ ok: true, companiesProcessed: 2, inserted: 2, skipped: 1 });
    expect(createMany).toHaveBeenCalledTimes(1);
    const inserted = createMany.mock.calls[0][0].data;
    expect(inserted).toHaveLength(2);
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ companyId: 'company-1', from: 'EUR', to: 'USD', rate: '1.0812' }),
        expect.objectContaining({ companyId: 'company-2', from: 'USD', to: 'GBP' }),
      ]),
    );
  });

  // Issue #574 — scope (b): a pair derived from actual usage, never typed by hand, still gets
  // refreshed. `findMany` (currencyRate) returns NOTHING for scope (a) in every case below — the
  // company never entered a manual rate — so a row only ever appears because the usage-derived query
  // mocks below produced one.
  describe('scope (b) — pairs derived from actual document/client/payment usage', () => {
    it('derives and inserts a pair from a used currency against the reference currency, with no manual rate ever entered', async () => {
      fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // scope (a): nothing entered by hand
      companyFindMany.mockResolvedValue([{ id: 'company-1', referenceCurrency: 'EUR' }]);
      // documentRows (first $queryRaw call) then paymentDocumentPairs (second) — findUsedCurrenciesByCompany
      // also reads client/payment groupBy, both left at the default `[]` from `beforeEach`.
      queryRaw.mockResolvedValueOnce([{ companyId: 'company-1', currency: 'USD' }]).mockResolvedValueOnce([]);

      const runner = new CurrencyRateSweepRunner();
      const result = await runner.runSweep();

      expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 1, skipped: 0 });
      expect(createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ companyId: 'company-1', from: 'USD', to: 'EUR', source: 'ecb' })],
      });
    });

    it('derives and inserts a payment-currency vs document-currency pair', async () => {
      fetchEcb.mockResolvedValue({
        referenceDate: '2026-09-11',
        rates: new Map([
          ['USD', 1.0812],
          ['GBP', 0.8567],
        ]),
      });
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      companyFindMany.mockResolvedValue([{ id: 'company-1', referenceCurrency: null }]); // no reference currency at all
      queryRaw
        .mockResolvedValueOnce([]) // documentRows
        .mockResolvedValueOnce([{ companyId: 'company-1', paymentCurrency: 'GBP', documentCurrency: 'USD' }]);

      const runner = new CurrencyRateSweepRunner();
      const result = await runner.runSweep();

      // GBP -> USD crosses through EUR (currency-rate-sweep.spec.ts's own `computeCrossRate` cases).
      expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 1, skipped: 0 });
      expect(createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ companyId: 'company-1', from: 'GBP', to: 'USD', source: 'ecb' })],
      });
    });

    it('merges an active (scope a) pair with an identical derived (scope b) pair into ONE row, never two', async () => {
      fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
      // Scope (a): this company already typed USD->EUR by hand at some point.
      findMany
        .mockResolvedValueOnce([{ companyId: 'company-1', from: 'USD', to: 'EUR' }])
        .mockResolvedValueOnce([]);
      // Scope (b): the SAME pair also comes out of usage (a USD invoice, EUR reference currency).
      companyFindMany.mockResolvedValue([{ id: 'company-1', referenceCurrency: 'EUR' }]);
      queryRaw.mockResolvedValueOnce([{ companyId: 'company-1', currency: 'USD' }]).mockResolvedValueOnce([]);

      const runner = new CurrencyRateSweepRunner();
      const result = await runner.runSweep();

      expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 1, skipped: 0 });
      expect(createMany).toHaveBeenCalledTimes(1);
      expect(createMany.mock.calls[0][0].data).toHaveLength(1); // not two rows for the one pair
    });

    it('is still idempotent across a rerun for a scope (b)-derived pair — no second row for the same asOf', async () => {
      fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { companyId: 'company-1', from: 'USD', to: 'EUR' }, // already refreshed earlier today
      ]);
      companyFindMany.mockResolvedValue([{ id: 'company-1', referenceCurrency: 'EUR' }]);
      queryRaw.mockResolvedValueOnce([{ companyId: 'company-1', currency: 'USD' }]).mockResolvedValueOnce([]);

      const runner = new CurrencyRateSweepRunner();
      const result = await runner.runSweep();

      expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 0, skipped: 1 });
      expect(createMany).not.toHaveBeenCalled();
    });

    it('fetches the fallback to check quotability only when a used currency falls outside the ECB map, and reuses that SAME fetch for resolution', async () => {
      fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map() }); // covers nothing
      fetchOpenErApi.mockResolvedValue({ rates: new Map([['MAD', 10.9]]) });
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      companyFindMany.mockResolvedValue([{ id: 'company-1', referenceCurrency: 'EUR' }]);
      queryRaw.mockResolvedValueOnce([{ companyId: 'company-1', currency: 'MAD' }]).mockResolvedValueOnce([]);

      const runner = new CurrencyRateSweepRunner();
      const result = await runner.runSweep();

      expect(result).toEqual({ ok: true, companiesProcessed: 1, inserted: 1, skipped: 0 });
      expect(createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            companyId: 'company-1',
            from: 'MAD',
            to: 'EUR',
            source: 'exchangerate-api',
          }),
        ],
      });
      expect(fetchOpenErApi).toHaveBeenCalledTimes(1); // once, reused — never fetched twice for the same pass
    });

    it('never calls the fallback when every used currency is already ECB-covered — the common case stays untouched', async () => {
      fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      companyFindMany.mockResolvedValue([{ id: 'company-1', referenceCurrency: 'EUR' }]);
      queryRaw.mockResolvedValueOnce([{ companyId: 'company-1', currency: 'USD' }]).mockResolvedValueOnce([]);

      const runner = new CurrencyRateSweepRunner();
      await runner.runSweep();

      expect(fetchOpenErApi).not.toHaveBeenCalled();
    });

    it('derives no pair at all for a company with no referenceCurrency and no recorded payment', async () => {
      fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      companyFindMany.mockResolvedValue([{ id: 'company-1', referenceCurrency: null }]);
      queryRaw.mockResolvedValueOnce([{ companyId: 'company-1', currency: 'USD' }]).mockResolvedValueOnce([]);

      const runner = new CurrencyRateSweepRunner();
      const result = await runner.runSweep();

      expect(result).toEqual({ ok: true, companiesProcessed: 0, inserted: 0, skipped: 0 });
      expect(createMany).not.toHaveBeenCalled();
    });
  });
});
