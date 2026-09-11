import prisma from '@/prisma/prisma.service';

import { CurrencyRateSweepRunner } from './currency-rate-sweep-runner';
import { fetchEcbDailyRates } from './ecb-rates-client';

// Same "mock the prisma singleton default export" shape archive/persistence.spec.ts and
// conformity/authority-events.persistence.spec.ts already use for a plain-function persistence file
// — this runner talks to `prisma.currencyRate` directly, never through a service class.
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    currencyRate: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
  },
}));

jest.mock('./ecb-rates-client');

const findMany = prisma.currencyRate.findMany as jest.Mock;
const createMany = prisma.currencyRate.createMany as jest.Mock;
const fetchEcb = fetchEcbDailyRates as jest.Mock;

describe('CurrencyRateSweepRunner.runSweep', () => {
  afterEach(() => jest.resetAllMocks());

  it('inserts one ecb-sourced row, with the right shape, for an existing company pair', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) });
    findMany
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'USD' }]) // active pairs
      .mockResolvedValueOnce([]); // no ecb row yet for this asOf

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

  it('skips a pair whose currency the ECB feed does not cover, without inserting a guessed rate', async () => {
    fetchEcb.mockResolvedValue({ referenceDate: '2026-09-11', rates: new Map([['USD', 1.0812]]) }); // no MRO
    findMany
      .mockResolvedValueOnce([{ companyId: 'company-1', from: 'EUR', to: 'MRO' }])
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
