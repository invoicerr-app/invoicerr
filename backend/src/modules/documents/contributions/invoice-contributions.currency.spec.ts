import * as currencyRatesStore from '../../company/currency-rates/currency-rates.store';
import * as settlementCredits from '../settlement/credits';
import * as settlementPayments from '../settlement/payments';
import * as persistence from '../persistence';
import { DocumentInstanceResult } from '../actions/action-registry';
import { buildInvoiceDashboardWidgetsWithConsolidation } from './invoice-contributions';
import { MetricWidget } from './widgets';

jest.mock('../persistence');
jest.mock('../settlement/payments');
jest.mock('../settlement/credits', () => {
  const actual = jest.requireActual('../settlement/credits');
  return { ...actual, listCreditNotes: jest.fn() };
});
jest.mock('../../company/currency-rates/currency-rates.store', () => {
  const actual = jest.requireActual('../../company/currency-rates/currency-rates.store');
  return { ...actual, getReferenceCurrency: jest.fn(), listCurrencyRates: jest.fn() };
});

const listDocuments = persistence.listDocuments as jest.Mock;
const sumPaidMinorByDocument = settlementPayments.sumPaidMinorByDocument as jest.Mock;
const listCreditNotes = settlementCredits.listCreditNotes as jest.Mock;
const getReferenceCurrency = currencyRatesStore.getReferenceCurrency as jest.Mock;
const listCurrencyRates = currencyRatesStore.listCurrencyRates as jest.Mock;

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
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30'));
    listDocuments.mockReset();
    sumPaidMinorByDocument.mockReset().mockResolvedValue(new Map());
    listCreditNotes.mockReset().mockResolvedValue([]);
    getReferenceCurrency.mockReset();
    listCurrencyRates.mockReset();
  });

  afterEach(() => jest.useRealTimers());

  it('no referenceCurrency set: the per-currency pending totals are returned, no consolidated metric', async () => {
    listDocuments.mockResolvedValue([
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
    listDocuments.mockResolvedValue([
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
    listDocuments.mockResolvedValue([
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

  it('nothing pending at all: no per-currency total widgets, consolidation never attempted', async () => {
    listDocuments.mockResolvedValue([]);
    getReferenceCurrency.mockResolvedValue('EUR');
    listCurrencyRates.mockResolvedValue([]);

    const widgets = await buildInvoiceDashboardWidgetsWithConsolidation({ companyId: 'c1' });

    expect(widgets.some((w) => w.id.startsWith('invoice:pending-total:'))).toBe(false);
    expect(getReferenceCurrency).not.toHaveBeenCalled();
  });
});
