import { listDocuments } from '../persistence';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { MetricWidget, TableWidget, Widget } from './widgets';

/**
 * The SECOND real contribution, calqued on invoice-contributions.ts (see that file's own header for
 * the reasoning this one reuses rather than re-derives): still ARITHMETIC only (summing, counting),
 * never a fiscal rule.
 *
 * The expense descriptor (descriptors/expense.descriptor.ts) is NOT shaped like the invoice's: it
 * has a single flat `amount` money field, not an array of quantity×unitPrice lines. This matters —
 * compute-totals.ts's `computeDocumentTotals` only ever recognizes an 'array' field carrying BOTH a
 * 'money' and a 'number' subfield (its own `findLineArrayFields`); handing it an expense's descriptor
 * would find none and hand back an honest-looking zero for every single expense — quietly wrong,
 * worse than not using it at all. So this file reads `data.amount` directly, the correct arithmetic
 * for THIS shape, rather than reaching for a shared helper that does not fit it.
 */

/** How many document instances a contribution reads before aggregating — same explicit, honest cap
 *  as invoice-contributions.ts's own (persistence.ts's `listDocuments`), not a second convention. */
const CONTRIBUTION_READ_LIMIT = 500;

/** `data.amount` if it is actually a number, 0 otherwise — the same "a still-being-filled draft is a
 *  normal state to aggregate over, not an error" rule invoice-contributions.ts's own `invoiceTotal`
 *  applies to a missing line amount. */
function expenseAmount(data: Record<string, unknown>): number {
  return typeof data.amount === 'number' ? data.amount : 0;
}

/** "2026-08" for any parseable date-ish value, or null. Deliberately NOT imported from
 *  invoice-contributions.ts's own identical helper: each contribution file stays self-contained —
 *  one small pure helper per type, the same way each type's own amount arithmetic
 *  (`invoiceTotal`/`expenseAmount`) is not shared machinery either. */
function monthKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * DASHBOARD: "les dépenses du mois" — the exact wording the user asked for.
 *
 * A sum, unlike invoice-contributions.ts's own dashboard curve (which deliberately only COUNTS,
 * never sums, because invoices can carry different currencies): a monthly expense TOTAL is exactly
 * the number a user wants, and refusing to ever produce one because currencies theoretically differ
 * would throw out the useful case (almost always one currency a month) to guard against a rare one.
 * The guard here is not "never sum" but "never sum ACROSS currencies": expenses are grouped by
 * currency first, and one metric is emitted PER currency actually present this month — usually one,
 * occasionally more, each correctly labelled with its own currency rather than silently combined.
 *
 * Zero expenses this month, in ANY currency, is its own case: there is no currency left to label a
 * "0" with (picking one, say EUR, would misleadingly claim "no expenses in EUR specifically" out of
 * thin air), so this is the ONE metric with no currency at all — value 0, plain "Expenses this
 * month" label, no `unit` — a currency-less zero shown honestly rather than a guessed one.
 */
export const buildExpenseDashboardWidgets: ContributionHandler = async ({ companyId }) => {
  const expenses = await listDocuments(companyId, 'expense', CONTRIBUTION_READ_LIMIT);
  const thisMonth = monthKey(new Date().toISOString());

  const totalsByCurrency = new Map<string, number>();
  for (const expense of expenses) {
    const data = (expense.data ?? {}) as Record<string, unknown>;
    if (monthKey(data.date) !== thisMonth) continue; // last month, next month, unparseable: excluded

    const currency = typeof data.currency === 'string' && data.currency ? data.currency : 'UNKNOWN';
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + expenseAmount(data));
  }

  if (totalsByCurrency.size === 0) {
    const emptyMonthMetric: MetricWidget = {
      id: 'expense:this-month',
      kind: 'metric',
      label: 'Expenses this month',
      value: 0,
    };
    return [emptyMonthMetric];
  }

  // Sorted by currency code so the response is deterministic across calls/tests — the ordering
  // itself carries no meaning (there is no "primary" currency here).
  return [...totalsByCurrency.entries()]
    .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
    .map(
      ([currency, total]): MetricWidget => ({
        id: `expense:this-month:${currency}`,
        kind: 'metric',
        label: `Expenses this month (${currency})`,
        unit: currency,
        value: Number(total.toFixed(2)),
      }),
    );
};

/**
 * STATISTICS: "tout ultra détaillé" — one row per expense: date, description, amount, currency.
 * Most recent first (by the expense's own `date`, not `updatedAt`): there is no "urgency" ordering
 * the way invoice-contributions.ts's pending list has (nearest due date first) — only recency.
 * Rows with no parseable date sort last rather than crashing the sort.
 */
export const buildExpenseStatisticsWidgets: ContributionHandler = async ({ companyId }) => {
  const expenses = await listDocuments(companyId, 'expense', CONTRIBUTION_READ_LIMIT);

  const rows = expenses
    .map((expense) => {
      const data = (expense.data ?? {}) as Record<string, unknown>;
      return {
        date: typeof data.date === 'string' ? data.date : '',
        description: typeof data.description === 'string' ? data.description : '',
        amount: Number(expenseAmount(data).toFixed(2)),
        currency: typeof data.currency === 'string' ? data.currency : '',
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const tableWidget: TableWidget = {
    id: 'expense:all',
    kind: 'table',
    label: 'All expenses',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount' },
      { key: 'currency', label: 'Currency' },
    ],
    rows,
  };

  return [tableWidget];
};

export function registerExpenseContributions(registry: ContributionRegistry): void {
  registry.register('expense', 'dashboard', buildExpenseDashboardWidgets);
  registry.register('expense', 'statistics', buildExpenseStatisticsWidgets);
}

// Re-exported for tests that want to prove the arithmetic directly — same convention
// invoice-contributions.ts's own bottom export follows.
export type { Widget };
export { expenseAmount, monthKey };
