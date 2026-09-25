import { vi, type Mock } from 'vitest';

import * as currencyRatesStore from '../../company/currency-rates/currency-rates.store';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import * as persistence from '../persistence';
import { filterLikeListAllDocuments } from '../__tests__/fake-document-instance-table';
import { DocumentInstanceResult } from '../actions/action-registry';
import { buildInvoiceDashboardWidgetsWithConsolidation } from './invoice-contributions';
import { MetricWidget } from './widgets';

vi.mock('../persistence');
vi.mock('../settlement/payments');
// The factory is async — unlike Jest, Vitest's `importActual` returns a Promise (it re-runs the
// real module through Vite's own SSR loader rather than Node's synchronous `require`), so this
// mock factory must be `async` and the actual module must be `await`ed. See the migration recipe's
// own "jest.requireActual" entry for why this is the single biggest semantic difference between the
// two mocking APIs — nothing here polls or races on it, so there's no other change.
vi.mock('../settlement/credits', async () => {
  const actual = await vi.importActual('../settlement/credits');
  return { ...actual, listCreditNotes: vi.fn() };
});
vi.mock('../../company/currency-rates/currency-rates.store', async () => {
  const actual = await vi.importActual('../../company/currency-rates/currency-rates.store');
  return { ...actual, getReferenceCurrency: vi.fn(), listCurrencyRates: vi.fn() };
});

const listAllDocuments = persistence.listAllDocuments as Mock;

/** Hands the code under test only the rows the QUERY would have returned. The client/status/type
 *  narrowing moved into SQL when the read stopped being capped, so a mock returning a fixture
 *  verbatim would feed it rows production never sees. Fixtures here stay small on purpose — they
 *  prove the rules around the read; the cap-crossing fixtures live in `*.read-cap.spec.ts`. */
function seedDocuments(rows: DocumentInstanceResult[]): void {
  listAllDocuments.mockImplementation(async (_companyId: string, options = {}) =>
    filterLikeListAllDocuments(rows, options),
  );
}

const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as Mock;
const listPaymentsInRange = settlementPayments.listPaymentsInRange as Mock;
const listCreditNotes = settlementCredits.listCreditNotes as Mock;
const getReferenceCurrency = currencyRatesStore.getReferenceCurrency as Mock;
const listCurrencyRates = currencyRatesStore.listCurrencyRates as Mock;

function invoice(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'inv-1',
    typeId: 'invoice',
    status: 'sent',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('buildInvoiceDashboardWidgetsWithConsolidation', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-30'));
    listAllDocuments.mockReset();
    sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
    listPaymentsInRange.mockReset().mockResolvedValue([]);
    listCreditNotes.mockReset().mockResolvedValue([]);
    getReferenceCurrency.mockReset();
    listCurrencyRates.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('no referenceCurrency set: the per-currency pending totals are returned, no consolidated metric', async () => {
    seedDocuments([
      invoice({
        id: 'sent-1',
        data: { currency: 'EUR', dueDate: '2026-09-01', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
    ]);
    getReferenceCurrency.mockResolvedValue(null);
    listCurrencyRates.mockResolvedValue([]);

    const widgets = (await buildInvoiceDashboardWidgetsWithConsolidation({
      companyId: 'c1',
    })) as MetricWidget[];

    expect(widgets.find((w) => w.id === 'invoice:pending-total:EUR')).toMatchObject({
      label: 'Pending invoices total (EUR)',
      unit: 'EUR',
      value: 100,
    });
    expect(widgets.find((w) => w.id === 'invoice:pending-total:consolidated')).toBeUndefined();
  });

  it('every pending currency resolves: adds ONE consolidated metric, hand-checked, naming the rate used', async () => {
    seedDocuments([
      invoice({
        id: 'sent-eur',
        data: { currency: 'EUR', dueDate: '2026-09-01', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
      invoice({
        id: 'sent-usd',
        data: { currency: 'USD', dueDate: '2026-09-02', lines: [{ quantity: 1, unitPrice: 50 }] },
      }),
    ]);
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([
      {
        id: 'r1',
        companyId: 'c1',
        from: 'USD',
        to: 'EUR',
        rate: 0.92,
        asOf: new Date('2026-08-15'),
        source: 'manual',
        createdAt: new Date('2026-08-15'),
      },
    ]);

    const widgets = (await buildInvoiceDashboardWidgetsWithConsolidation({
      companyId: 'c1',
    })) as MetricWidget[];

    // 100 EUR untouched + 50 USD * 0.92 = 46 EUR converted -> 146 EUR consolidated.
    expect(widgets.find((w) => w.id === 'invoice:pending-total:consolidated')).toMatchObject({
      label: 'Pending invoices total (consolidated, converted)',
      unit: 'EUR (converted)',
      approx: true,
      value: 146,
      warnings: ['USD→EUR @ 0.92 (manual, 2026-08-15)'],
    });
  });

  it('a currency with no resolvable rate: no consolidated metric, and the missing currency is named', async () => {
    seedDocuments([
      invoice({
        id: 'sent-eur',
        data: { currency: 'EUR', dueDate: '2026-09-01', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
      invoice({
        id: 'sent-jpy',
        data: { currency: 'JPY', dueDate: '2026-09-03', lines: [{ quantity: 1, unitPrice: 1000 }] },
      }),
    ]);
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([]);

    const widgets = (await buildInvoiceDashboardWidgetsWithConsolidation({
      companyId: 'c1',
    })) as MetricWidget[];

    expect(widgets.find((w) => w.id === 'invoice:pending-total:consolidated')).toBeUndefined();
    expect(widgets.find((w) => w.id === 'invoice:pending-total:JPY')?.warnings).toEqual([
      'No JPY→EUR rate is set — consolidated total omitted.',
    ]);
    expect(widgets.find((w) => w.id === 'invoice:pending-total:EUR')?.warnings).toEqual([
      'No JPY→EUR rate is set — consolidated total omitted.',
    ]);
  });

  it('collections (issue #417) consolidate independently of pending, same rates, own id/label, no link', async () => {
    seedDocuments([
      invoice({
        id: 'sent-eur',
        status: 'sent',
        data: { currency: 'EUR', issueDate: '2026-08-01', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
      invoice({
        id: 'sent-usd',
        status: 'sent',
        data: { currency: 'USD', issueDate: '2026-08-01', lines: [{ quantity: 1, unitPrice: 100 }] },
      }),
    ]);
    listPaymentsInRange.mockResolvedValue([
      {
        documentId: 'sent-eur',
        amountMinor: 10000,
        currency: 'EUR',
        paidAt: new Date('2026-08-10'),
        documentAmountMinor: 10000,
        conversionRate: null,
        conversionRateAsOf: null,
        conversionSource: null,
        method: null,
        note: null,
        createdAt: new Date('2026-08-10'),
        id: 'p1',
      },
      {
        documentId: 'sent-usd',
        amountMinor: 5000,
        currency: 'USD',
        paidAt: new Date('2026-08-11'),
        documentAmountMinor: 5000,
        conversionRate: null,
        conversionRateAsOf: null,
        conversionSource: null,
        method: null,
        note: null,
        createdAt: new Date('2026-08-11'),
        id: 'p2',
      },
    ]);
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([
      {
        id: 'r1',
        companyId: 'c1',
        from: 'USD',
        to: 'EUR',
        rate: 0.92,
        asOf: new Date('2026-08-15'),
        source: 'manual',
        createdAt: new Date('2026-08-15'),
      },
    ]);

    const widgets = (await buildInvoiceDashboardWidgetsWithConsolidation({
      companyId: 'c1',
    })) as MetricWidget[];

    // 100 EUR untouched + 50 USD * 0.92 = 46 EUR converted -> 146 EUR consolidated.
    const consolidated = widgets.find((w) => w.id === 'invoice:collected:consolidated');
    expect(consolidated).toMatchObject({
      label: 'Collected this month (consolidated, converted)',
      unit: 'EUR (converted)',
      approx: true,
      value: 146,
      warnings: ['USD→EUR @ 0.92 (manual, 2026-08-15)'],
    });
    expect(consolidated?.link).toBeUndefined();
  });

  it('nothing pending at all: no per-currency total widgets, consolidation never attempted', async () => {
    seedDocuments([]);
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([]);

    const widgets = await buildInvoiceDashboardWidgetsWithConsolidation({ companyId: 'c1' });

    expect(widgets.some((w) => w.id.startsWith('invoice:pending-total:'))).toBe(false);
    expect(getReferenceCurrency).not.toHaveBeenCalled();
  });
});
