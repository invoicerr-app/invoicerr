import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { CurrencyRateSweepRunner } from './currency-rate-sweep-runner';
import { fetchEcbDailyRates } from './ecb-rates-client';
import { fetchOpenErApiRates } from './open-er-api-rates-client';

// Same "mock the prisma singleton default export" shape archive/persistence.spec.ts and
// conformity/authority-events.persistence.spec.ts already use for a plain-function persistence file
// — this runner talks to `prisma.currencyRate` directly, never through a service class.
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    currencyRate: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock('./ecb-rates-client');
vi.mock('./open-er-api-rates-client');

const findMany = prisma.currencyRate.findMany as Mock;
const createMany = prisma.currencyRate.createMany as Mock;
const fetchEcb = fetchEcbDailyRates as Mock;
const fetchOpenErApi = fetchOpenErApiRates as Mock;

describe('CurrencyRateSweepRunner.runSweep', () => {
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
});
