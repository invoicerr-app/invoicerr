import * as currencyRatesStore from '../../company/currency-rates/currency-rates.store';
import * as persistence from '../persistence';
import { DocumentInstanceResult } from '../actions/action-registry';
import { buildExpenseDashboardWidgetsWithConsolidation } from './expense-contributions';
import { MetricWidget } from './widgets';

jest.mock('../persistence');
// Same "mock only the DB-touching reads, keep the real pure mapper" discipline as
// currency-consolidation.spec.ts's own `loadCurrencyContext` tests.
jest.mock('../../company/currency-rates/currency-rates.store', () => {
  const actual = jest.requireActual('../../company/currency-rates/currency-rates.store');
  return { ...actual, getReferenceCurrency: jest.fn(), listCurrencyRates: jest.fn() };
});

const listDocuments = persistence.listDocuments as jest.Mock;
const getReferenceCurrency = currencyRatesStore.getReferenceCurrency as jest.Mock;
const listCurrencyRates = currencyRatesStore.listCurrencyRates as jest.Mock;

function expense(
  overrides: Partial<DocumentInstanceResult> & { data: Record<string, unknown> },
): DocumentInstanceResult {
  return {
    id: 'exp-1',
    typeId: 'expense',
    status: 'draft',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function dateInMonth(now: Date, day = 15): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

describe('buildExpenseDashboardWidgetsWithConsolidation', () => {
  const now = new Date('2026-08-30');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    listDocuments.mockReset();
    getReferenceCurrency.mockReset();
    listCurrencyRates.mockReset();
  });

  afterEach(() => jest.useRealTimers());

  it('no referenceCurrency set: the exact same widgets as the base handler, untouched — the default', async () => {
    listDocuments.mockResolvedValue([
      expense({ id: 'e1', data: { amount: 100, currency: 'EUR', date: dateInMonth(now) } }),
    ]);
    getReferenceCurrency.mockResolvedValue(null);
    listCurrencyRates.mockResolvedValue([]);

    const widgets = (await buildExpenseDashboardWidgetsWithConsolidation({
      companyId: 'c1',
    })) as MetricWidget[];

    expect(widgets).toEqual([
      {
        id: 'expense:this-month:EUR',
        kind: 'metric',
        label: 'Expenses this month (EUR)',
        unit: 'EUR',
        value: 100,
      },
    ]);
  });

  it('no expenses this month: the currency-less zero metric, consolidation never even attempted', async () => {
    listDocuments.mockResolvedValue([]);
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([]);

    const widgets = await buildExpenseDashboardWidgetsWithConsolidation({ companyId: 'c1' });

    expect(widgets).toEqual([
      { id: 'expense:this-month', kind: 'metric', label: 'Expenses this month', value: 0 },
    ]);
    // Never even asked — nothing to consolidate when there is no currency at all this month.
    expect(getReferenceCurrency).not.toHaveBeenCalled();
  });

  it('every encountered currency resolves: adds ONE consolidated metric, hand-checked, naming the rate used', async () => {
    listDocuments.mockResolvedValue([
      expense({ id: 'e-eur', data: { amount: 100, currency: 'EUR', date: dateInMonth(now) } }),
      expense({ id: 'e-usd', data: { amount: 50, currency: 'USD', date: dateInMonth(now) } }),
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

    const widgets = (await buildExpenseDashboardWidgetsWithConsolidation({
      companyId: 'c1',
    })) as MetricWidget[];

    // 100 EUR untouched + 50 USD * 0.92 = 46 EUR converted -> 146 EUR consolidated.
    const consolidated = widgets.find((w) => w.id === 'expense:this-month:consolidated');
    expect(consolidated).toMatchObject({
      label: 'Expenses this month (consolidated, converted)',
      unit: 'EUR (converted)',
      approx: true,
      value: 146,
      warnings: ['USD→EUR @ 0.92 (manual, 2026-08-15)'],
    });
    // The ordinary per-currency metrics are still there, untouched, with no warnings attached.
    expect(widgets.find((w) => w.id === 'expense:this-month:EUR')).toEqual({
      id: 'expense:this-month:EUR',
      kind: 'metric',
      label: 'Expenses this month (EUR)',
      unit: 'EUR',
      value: 100,
    });
  });

  it('a currency with no resolvable rate: NO consolidated widget, and the missing currency is named on the ordinary widgets', async () => {
    listDocuments.mockResolvedValue([
      expense({ id: 'e-eur', data: { amount: 100, currency: 'EUR', date: dateInMonth(now) } }),
      expense({ id: 'e-jpy', data: { amount: 1000, currency: 'JPY', date: dateInMonth(now) } }),
    ]);
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([]); // no JPY→EUR rate at all

    const widgets = (await buildExpenseDashboardWidgetsWithConsolidation({
      companyId: 'c1',
    })) as MetricWidget[];

    expect(widgets.find((w) => w.id === 'expense:this-month:consolidated')).toBeUndefined();
    const eur = widgets.find((w) => w.id === 'expense:this-month:EUR');
    const jpy = widgets.find((w) => w.id === 'expense:this-month:JPY');
    expect(eur?.warnings).toEqual(['No JPY→EUR rate is set — consolidated total omitted.']);
    expect(jpy?.warnings).toEqual(['No JPY→EUR rate is set — consolidated total omitted.']);
    // Values themselves are completely unaffected by the missing rate.
    expect(eur?.value).toBe(100);
    expect(jpy?.value).toBe(1000);
  });

  it('a DB failure resolving currency context degrades to "unchanged", never throws', async () => {
    listDocuments.mockResolvedValue([
      expense({ id: 'e1', data: { amount: 100, currency: 'EUR', date: dateInMonth(now) } }),
    ]);
    getReferenceCurrency.mockRejectedValue(new Error('connect ECONNREFUSED'));
    listCurrencyRates.mockResolvedValue([]);

    const widgets = await buildExpenseDashboardWidgetsWithConsolidation({ companyId: 'c1' });

    expect(widgets).toEqual([
      {
        id: 'expense:this-month:EUR',
        kind: 'metric',
        label: 'Expenses this month (EUR)',
        unit: 'EUR',
        value: 100,
      },
    ]);
  });
});
