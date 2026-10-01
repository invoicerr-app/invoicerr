import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { CurrencyRateSweepRunner } from './currency-rate-sweep-runner';
import { fetchEcbDailyRates } from './ecb-rates-client';
import { fetchOpenErApiRates } from './open-er-api-rates-client';

/**
 * Issue #574 - "refresh the pairs a company actually uses", proven end-to-end against a REAL
 * Postgres: `currency-rate-sweep-runner.spec.ts` already proves every rule with a mocked
 * `prisma.currencyRate`/`company`/`client`/`documentPayment`/`$queryRaw`, but the three NEW grouped
 * queries this issue adds (`findCompanyReferenceCurrencies`/`findUsedCurrenciesByCompany`/
 * `findPaymentDocumentCurrencyPairs`, currency-rate-sweep-runner.ts) include TWO raw `$queryRaw`
 * calls reading `DocumentInstance.data ->> 'currency'` and a JOIN against `DocumentPayment` - exactly
 * the kind of SQL a mock cannot catch a typo in (a wrong column alias, a broken JOIN condition) but a
 * real database executes and fails loudly. Same "real Prisma, own company, cleaned up afterwards"
 * discipline `clients.duplicates.spec.ts`/`reconciliation/variance-acceptance.spec.ts` already hold -
 * the ECB/fallback HTTP clients stay mocked throughout (`vi.mock` below): "never call ECB or
 * exchangerate-api from CI" applies here exactly as much as to the fully-mocked spec.
 *
 * ## One wrinkle real-Prisma tests for THIS runner have that the others don't
 * `CurrencyRateSweepRunner.runSweep()` is deliberately GLOBAL - it scans every company's own rows,
 * not one tenant's (`findActiveCurrencyRatePairs`'s own header). Under this project's own
 * `pool: 'forks'`/`maxWorkers` (vitest.config.ts), several spec FILES run against the SAME database
 * at once, so a real `runSweep()` call here could, in principle, also touch a row some OTHER
 * concurrently-running spec file created. No OTHER spec file in this repository writes a
 * `CurrencyRate`/reads one back as an assertion (grep confirms it - only this module's own specs
 * touch that table, and every other one mocks Prisma), so this is a theoretical risk, not an observed
 * one; every assertion below is scoped to THIS test's own `companyId` regardless, so it holds even if
 * that ever stops being true.
 */
vi.mock('./ecb-rates-client');
vi.mock('./open-er-api-rates-client');

const fetchEcb = fetchEcbDailyRates as Mock;
const fetchOpenErApi = fetchOpenErApiRates as Mock;

let seq = 0;
function uniqueEmail(label: string): string {
  seq += 1;
  return `currency-rate-sweep-574-${label}-${Date.now()}-${seq}@example.com`;
}

describe('CurrencyRateSweepRunner.runSweep - real Postgres, scope (b) derivation (#574)', () => {
  let companyId: string;
  let documentId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Currency Sweep 574 Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: uniqueEmail('company'),
        referenceCurrency: 'EUR', // the (b) scope needs one to derive the "used vs reference" pairs
      },
    });
    companyId = company.id;

    // A client billing in GBP - "each currency used by its clients" (issue #574's own wording).
    await prisma.client.create({
      data: {
        companyId,
        name: 'GBP Client Ltd',
        address: '1 Client Street',
        postalCode: '00000',
        city: 'Londonville',
        country: 'United Kingdom',
        countryCode: 'GB',
        currency: 'GBP',
      },
    });

    // An invoice issued in USD - "each currency used by its documents".
    const document = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'sent', data: { currency: 'USD', total: 1000 } },
    });
    documentId = document.id;

    // A payment recorded in GBP against that USD invoice - "each payment-currency vs
    // invoice-currency pair", on top of "each currency used by its recorded payments" (GBP vs EUR).
    await prisma.documentPayment.create({
      data: {
        companyId,
        documentId,
        amountMinor: 50000,
        currency: 'GBP',
        documentAmountMinor: 63000, // arbitrary - settlement math is not what this test proves
        paidAt: new Date('2026-09-20'),
      },
    });
  });

  afterAll(async () => {
    await prisma.currencyRate.deleteMany({ where: { companyId } });
    await prisma.documentPayment.deleteMany({ where: { companyId } });
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  afterEach(() => vi.resetAllMocks());

  it('derives and inserts every pair this company actually uses, never typed by hand', async () => {
    fetchEcb.mockResolvedValue({
      referenceDate: '2026-09-21',
      rates: new Map([
        ['USD', 1.0812],
        ['GBP', 0.8567],
      ]),
    });

    const runner = new CurrencyRateSweepRunner();
    const result = await runner.runSweep();

    expect(result.ok).toBe(true);
    expect(fetchOpenErApi).not.toHaveBeenCalled(); // both USD and GBP are ECB-covered

    const rates = await prisma.currencyRate.findMany({
      where: { companyId },
      select: { from: true, to: true, source: true, asOf: true },
    });
    const pairs = rates.map((r) => `${r.from}->${r.to}`).sort();

    // USD->EUR: the invoice's own currency against the reference currency.
    // GBP->EUR: the client's AND the payment's currency against the reference currency (one row,
    // not two - the sweep's own de-duplication, proven in isolation by currency-rate-sweep.spec.ts).
    // GBP->USD: the payment's currency against THAT SPECIFIC invoice's own currency.
    expect(pairs).toEqual(['GBP->EUR', 'GBP->USD', 'USD->EUR']);
    expect(rates.every((r) => r.source === 'ecb')).toBe(true);
    expect(rates.every((r) => r.asOf.toISOString() === '2026-09-21T00:00:00.000Z')).toBe(true);
  });

  it('is idempotent on a second pass for the SAME reference date - no duplicate rows', async () => {
    fetchEcb.mockResolvedValue({
      referenceDate: '2026-09-21', // same day as the previous test - already fully refreshed
      rates: new Map([
        ['USD', 1.0812],
        ['GBP', 0.8567],
      ]),
    });

    const before = await prisma.currencyRate.count({ where: { companyId } });
    const result = await new CurrencyRateSweepRunner().runSweep();
    const after = await prisma.currencyRate.count({ where: { companyId } });

    expect(result.ok).toBe(true);
    expect(after).toBe(before); // not re-inserted - idempotency holds for scope (b) pairs too
  });
});
