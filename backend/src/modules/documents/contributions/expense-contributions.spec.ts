import {
  buildExpenseDashboardWidgets,
  buildExpenseStatisticsWidgets,
  expenseAmount,
} from './expense-contributions';
import * as persistence from '../persistence';
import { DocumentInstanceResult } from '../actions/action-registry';
import { MetricWidget, TableWidget } from './widgets';

jest.mock('../persistence');

const listDocuments = persistence.listDocuments as jest.Mock;

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

/** ISO "YYYY-MM-DD" for a date offset by `monthOffset` whole calendar months from `now` — built
 *  RELATIVE to `now` so these tests never hard-code a month and never break on the 1st. */
function dateInMonth(now: Date, monthOffset: number, day = 15): string {
  const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('expenseAmount', () => {
  it('reads data.amount directly — a plain flat field, not a line array', () => {
    expect(expenseAmount({ amount: 42.5 })).toBe(42.5);
  });

  it('treats a missing/non-numeric amount as 0 rather than throwing', () => {
    expect(expenseAmount({})).toBe(0);
    expect(expenseAmount({ amount: 'not-a-number' })).toBe(0);
  });
});

describe('buildExpenseDashboardWidgets', () => {
  const now = new Date('2026-08-30');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    listDocuments.mockReset();
  });

  afterEach(() => jest.useRealTimers());

  it('sums only the CURRENT month, grouped by currency — a last-month expense is excluded', async () => {
    listDocuments.mockResolvedValue([
      expense({ id: 'this-month-1', data: { amount: 100, currency: 'EUR', date: dateInMonth(now, 0, 5) } }),
      expense({ id: 'this-month-2', data: { amount: 50, currency: 'EUR', date: dateInMonth(now, 0, 20) } }),
      // A different currency, same month — must produce its OWN metric, never get added into EUR's.
      expense({ id: 'this-month-usd', data: { amount: 30, currency: 'USD', date: dateInMonth(now, 0, 10) } }),
      // Last month — excluded entirely, even though the amount would otherwise be large enough to
      // stand out if it leaked in.
      expense({ id: 'last-month', data: { amount: 9999, currency: 'EUR', date: dateInMonth(now, -1, 1) } }),
      // Next month — also excluded (a future-dated expense is not "this month" either).
      expense({ id: 'next-month', data: { amount: 9999, currency: 'EUR', date: dateInMonth(now, 1, 1) } }),
    ]);

    const widgets = (await buildExpenseDashboardWidgets({ companyId: 'c1' })) as MetricWidget[];

    expect(widgets).toHaveLength(2);
    const eur = widgets.find((w) => w.id === 'expense:this-month:EUR');
    const usd = widgets.find((w) => w.id === 'expense:this-month:USD');

    expect(eur).toMatchObject({ label: 'Expenses this month (EUR)', unit: 'EUR', value: 150 });
    expect(usd).toMatchObject({ label: 'Expenses this month (USD)', unit: 'USD', value: 30 });
  });

  it('an empty month produces ONE currency-less zero metric, never a guessed currency', async () => {
    listDocuments.mockResolvedValue([
      expense({ id: 'last-month', data: { amount: 500, currency: 'EUR', date: dateInMonth(now, -1, 1) } }),
    ]);

    const widgets = await buildExpenseDashboardWidgets({ companyId: 'c1' });

    expect(widgets).toEqual([
      { id: 'expense:this-month', kind: 'metric', label: 'Expenses this month', value: 0 },
    ]);
    // No `unit` at all — not even an empty string — for the currency-less zero.
    expect((widgets[0] as MetricWidget).unit).toBeUndefined();
  });

  it('no expenses at all is the same empty-month case', async () => {
    listDocuments.mockResolvedValue([]);

    const widgets = await buildExpenseDashboardWidgets({ companyId: 'c1' });

    expect(widgets).toEqual([
      { id: 'expense:this-month', kind: 'metric', label: 'Expenses this month', value: 0 },
    ]);
  });
});

describe('buildExpenseStatisticsWidgets', () => {
  beforeEach(() => listDocuments.mockReset());

  it('renders one detailed row per expense, most recent date first', async () => {
    listDocuments.mockResolvedValue([
      expense({
        id: 'older',
        data: { description: 'Taxi', amount: 12.3, currency: 'EUR', date: '2026-01-01' },
      }),
      expense({
        id: 'newer',
        data: { description: 'Hotel', amount: 200, currency: 'EUR', date: '2026-06-15' },
      }),
    ]);

    const widgets = await buildExpenseStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;

    expect(table.rows).toEqual([
      { date: '2026-06-15', description: 'Hotel', amount: 200, currency: 'EUR' },
      { date: '2026-01-01', description: 'Taxi', amount: 12.3, currency: 'EUR' },
    ]);
  });
});
