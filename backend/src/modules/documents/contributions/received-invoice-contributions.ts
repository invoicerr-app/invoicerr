import { fromMinor, toMinor } from '@/utils/financial';

import { listDocuments } from '../persistence';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { consolidateByCurrency, loadCurrencyContext } from './currency-consolidation';
import { MetricWidget, Widget } from './widgets';

/**
 * Root TODO item 18's own dashboard contribution — "factures reçues en attente" (count + amount by
 * currency). DASHBOARD only, deliberately: this task did not ask for a Statistics table the way
 * expense/invoice/credit-note each got one, and inventing one ahead of being asked would be exactly
 * the kind of unrequested scope this codebase avoids elsewhere (see credit-note.descriptor.ts's own
 * "no forced negative amounts" list). Calqued on expense-contributions.ts's own dashboard metric —
 * same reasoning reused: grouped BY currency, one metric per currency actually present, NEVER a
 * cross-currency sum, exactly the "grouped by currency, consolidation applies itself on top if a
 * reference currency is configured" discipline this whole module holds everywhere else.
 */
const CONTRIBUTION_READ_LIMIT = 500;

/** `data.grossAmount` if it is actually a number, 0 otherwise — the same "a still-being-filled
 *  record is a normal state to aggregate over, not an error" rule expense-contributions.ts's own
 *  `expenseAmount` applies to a missing amount (see received-invoice.descriptor.ts's own header on
 *  why every money field here is optional: a plain scanned PDF may carry no extracted amount at
 *  all). */
function grossAmount(data: Record<string, unknown>): number {
  return typeof data.grossAmount === 'number' ? data.grossAmount : 0;
}

/**
 * DASHBOARD: "received invoices pending" — a COUNT of every instance still at "received" (i.e., not
 * yet approved or rejected — see received-invoice.descriptor.ts's own lifecycle), plus, when at
 * least one of them carries a `grossAmount`, one additional metric PER CURRENCY actually present
 * among them. The count metric carries no `unit` (it is a count, not a sum) and is never excluded
 * from the response even when every pending record has an unset amount — "0 recorded so far" is
 * still a real, useful fact for an empty-looking dashboard.
 */
export const buildReceivedInvoiceDashboardWidgets: ContributionHandler = async ({ companyId }) => {
  const invoices = await listDocuments(companyId, 'received-invoice', CONTRIBUTION_READ_LIMIT);
  const pending = invoices.filter((invoice) => invoice.status === 'received');

  const countMetric: MetricWidget = {
    id: 'received-invoice:pending-count',
    kind: 'metric',
    label: 'Received invoices pending review',
    value: pending.length,
  };

  const totalsByCurrency = new Map<string, number>();
  for (const invoice of pending) {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    if (typeof data.grossAmount !== 'number') continue; // no amount recorded yet — nothing to sum
    const currency = typeof data.currency === 'string' && data.currency ? data.currency : 'UNKNOWN';
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + grossAmount(data));
  }

  if (totalsByCurrency.size === 0) return [countMetric];

  // Sorted by currency code so the response is deterministic across calls/tests — same convention as
  // expense-contributions.ts's own identical sort, for the same reason (no "primary" currency here).
  const amountMetrics: MetricWidget[] = [...totalsByCurrency.entries()]
    .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
    .map(([currency, total]) => ({
      id: `received-invoice:pending-amount:${currency}`,
      kind: 'metric',
      label: `Received invoices pending (${currency})`,
      unit: currency,
      value: Number(total.toFixed(2)),
    }));

  return [countMetric, ...amountMetrics];
};

/**
 * Wraps `buildReceivedInvoiceDashboardWidgets` with multi-currency consolidation (root TODO item 9)
 * — identical shape to `expense-contributions.ts`'s own
 * `buildExpenseDashboardWidgetsWithConsolidation` (see that function's own header for the full
 * reasoning this reuses verbatim): purely ADDITIVE over the base handler's own output, and a no-op
 * whenever no `referenceCurrency` is configured or a rate is missing. The count metric carries no
 * `unit`, so `perCurrencyWidgets` below naturally excludes it — no special-casing needed.
 */
export const buildReceivedInvoiceDashboardWidgetsWithConsolidation: ContributionHandler = async (ctx) => {
  const widgets = await buildReceivedInvoiceDashboardWidgets(ctx);

  const perCurrencyWidgets = widgets.filter(
    (widget): widget is MetricWidget => widget.kind === 'metric' && typeof widget.unit === 'string',
  );
  if (perCurrencyWidgets.length === 0) return widgets;

  const { referenceCurrency, rates } = await loadCurrencyContext(ctx.companyId);
  const amounts = perCurrencyWidgets.map((widget) => ({
    currency: widget.unit as string,
    totalMinor: toMinor(widget.value, widget.unit as string),
  }));
  const { consolidated, warnings } = consolidateByCurrency(amounts, referenceCurrency, rates, new Date());

  if (warnings.length > 0) {
    for (const widget of perCurrencyWidgets) widget.warnings = warnings;
    return widgets;
  }

  if (!consolidated) return widgets; // No referenceCurrency set — the default, unchanged behavior.

  const consolidatedMetric: MetricWidget = {
    id: 'received-invoice:pending-amount:consolidated',
    kind: 'metric',
    label: 'Received invoices pending (consolidated, converted)',
    unit: `${consolidated.currency} (converted)`,
    approx: true,
    value: Number(fromMinor(consolidated.totalMinor, consolidated.currency).toFixed(2)),
    warnings: consolidated.notes,
  };

  return [...widgets, consolidatedMetric];
};

export function registerReceivedInvoiceContributions(registry: ContributionRegistry): void {
  registry.register('received-invoice', 'dashboard', buildReceivedInvoiceDashboardWidgetsWithConsolidation);
}

// Re-exported for tests that want to prove the arithmetic directly — same convention
// expense-contributions.ts's own bottom export follows.
export type { Widget };
export { grossAmount };
