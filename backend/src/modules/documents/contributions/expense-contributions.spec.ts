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

    // `previousValue` is LAST month's total in the same currency (the 9999 EUR excluded from
    // `value` above); USD had nothing last month, so an honest 0 rather than an absent field.
    expect(eur).toMatchObject({
      label: 'Expenses this month (EUR)',
      unit: 'EUR',
      value: 150,
      previousValue: 9999,
    });
    expect(usd).toMatchObject({
      label: 'Expenses this month (USD)',
      unit: 'USD',
      value: 30,
      previousValue: 0,
    });
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

    // Neither expense set a category — an unset one is an empty string, never a crash or a
    // fabricated "uncategorized" bucket (see this file's own header on `expenseAmount`'s identical
    // rule for a missing `amount`).
    expect(table.rows).toEqual([
      { date: '2026-06-15', description: 'Hotel', category: '', amount: 200, currency: 'EUR' },
      { date: '2026-01-01', description: 'Taxi', category: '', amount: 12.3, currency: 'EUR' },
    ]);
  });

  // Enriched expense categories ("notes de frais enrichies") — the category a user actually picked
  // flows through to the statistics table verbatim (the raw option value, not its label — see this
  // file's own header on `translateWidget`'s "row data stays untranslated" convention).
  it('a chosen category flows through to the statistics table', async () => {
    listDocuments.mockResolvedValue([
      expense({
        id: 'categorized',
        data: {
          description: 'Printer paper',
          amount: 42,
          currency: 'EUR',
          date: '2026-03-01',
          category: 'office_supplies',
        },
      }),
    ]);

    const widgets = await buildExpenseStatisticsWidgets({ companyId: 'c1' });
    const table = widgets.find((w) => w.kind === 'table') as TableWidget;

    expect(table.columns.map((c) => c.key)).toContain('category');
    expect(table.rows).toEqual([
      {
        date: '2026-03-01',
        description: 'Printer paper',
        category: 'office_supplies',
        amount: 42,
        currency: 'EUR',
      },
    ]);
  });
});

describe('monthKey — one clock (UTC) on both sides of the comparison', () => {
  const { monthKey } = require('./expense-contributions');

  it('a date-only string and a full ISO instant of the same UTC day land in the same month', () => {
    // The exact live failure of 2026-08-31 ~22:15 UTC (00:15 CEST, Sept 1 locally): the expense was
    // dated "2026-08-31" (UTC day) while "now" keyed through LOCAL getters said September — the
    // widget for the expense's own month silently vanished. One UTC clock for both kills it.
    expect(monthKey('2026-08-31')).toBe('2026-08');
    expect(monthKey('2026-08-31T22:15:00.000Z')).toBe('2026-08');
    expect(monthKey('2026-08-31')).toBe(monthKey('2026-08-31T23:59:59.999Z'));
  });

  it('the first instant of a UTC month belongs to that month, whatever the server timezone', () => {
    expect(monthKey('2026-09-01')).toBe('2026-09');
    expect(monthKey('2026-09-01T00:00:00.000Z')).toBe('2026-09');
  });
});
