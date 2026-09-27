import { fromMinor, toMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../actions/action-registry';
import { buildReceivedInvoiceDescriptor } from '../descriptors/received-invoice.descriptor';
import { DashboardPeriod } from '../dto/dashboard-query.dto';
import { resolveDateFieldKey } from '../list-filters';
import { dateValueInRange, dayMs, listAllDocuments } from '../persistence';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { consolidateByCurrency, loadCurrencyContext } from './currency-consolidation';
import { MetricWidget, MetricWidgetLink, Widget } from './widgets';

/** `data.grossAmount` if it is actually a number, 0 otherwise — the same "a still-being-filled
 *  record is a normal state to aggregate over, not an error" rule expense-contributions.ts's own
 *  `expenseAmount` applies to a missing amount (see received-invoice.descriptor.ts's own header on
 *  why every money field here is optional: a plain scanned PDF may carry no extracted amount at
 *  all). */
function grossAmount(data: Record<string, unknown>): number {
  return typeof data.grossAmount === 'number' ? data.grossAmount : 0;
}

/** The received invoice's own `issueDate` field - resolvable (`list-filters.ts#resolveDateFieldKey`)
 *  even though it is OPTIONAL on this type (a plain scanned PDF may carry no extracted date at all,
 *  same reasoning as `grossAmount` above): a record with no readable date is simply excluded once a
 *  period is set, the exact same "can't honestly be placed in ANY range" rule
 *  `persistence.ts#dateValueInRange` already applies for `GET /documents`'s own filter - never
 *  guessed into either side of the boundary. */
const RECEIVED_INVOICE_DATE_FIELD_KEY = resolveDateFieldKey(buildReceivedInvoiceDescriptor());

/** Every received invoice from `all` whose own `RECEIVED_INVOICE_DATE_FIELD_KEY` value falls within
 *  `period`'s inclusive range - see invoice-contributions.ts's own identical `restrictToPeriod` for
 *  the full reasoning, duplicated per file rather than shared. `period` undefined -> `all`, the SAME
 *  reference, unchanged. */
function restrictToPeriod(
  all: DocumentInstanceResult[],
  period: DashboardPeriod | undefined,
): DocumentInstanceResult[] {
  if (!period || !RECEIVED_INVOICE_DATE_FIELD_KEY) return all;
  const fromMs = dayMs(period.dateFrom);
  const toMs = dayMs(period.dateTo);
  return all.filter((invoice) =>
    dateValueInRange(
      (invoice.data as Record<string, unknown> | null)?.[RECEIVED_INVOICE_DATE_FIELD_KEY],
      fromMs,
      toMs,
    ),
  );
}

/**
 * DASHBOARD: "received invoices pending" — a COUNT of every instance still at "received" (i.e., not
 * yet approved or rejected — see received-invoice.descriptor.ts's own lifecycle), plus, when at
 * least one of them carries a `grossAmount`, one additional metric PER CURRENCY actually present
 * among them. The count metric carries no `unit` (it is a count, not a sum) and is never excluded
 * from the response even when every pending record has an unset amount — "0 recorded so far" is
 * still a real, useful fact for an empty-looking dashboard.
 */
export const buildReceivedInvoiceDashboardWidgets: ContributionHandler = async ({ companyId, period }) => {
  // "received" pushed into SQL, paged until exhausted: both the count and the per-currency sums
  // below are aggregates over every pending received invoice. Filtering a capped page in memory made
  // a supplier invoice awaiting review for a long time drop out of the pending count and out of the
  // amount due — the oldest ones first, which are exactly the ones a reviewer needs to see.
  const allPending = await listAllDocuments(companyId, {
    typeId: 'received-invoice',
    status: ['received'],
  });
  // Restricted by the type's own resolved date field once a period is set (issue #418) - `allPending`
  // itself, unchanged, whenever no period is set (`restrictToPeriod`'s own header).
  const pending = restrictToPeriod(allPending, period);

  const pendingLink: MetricWidgetLink = { typeId: 'received-invoice', status: ['received'], ...period };
  const countMetric: MetricWidget = {
    id: 'received-invoice:pending-count',
    kind: 'metric',
    label: 'Received invoices pending review',
    value: pending.length,
    link: pendingLink,
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
      link: pendingLink,
    }));

  return [countMetric, ...amountMetrics];
};

/**
 * Wraps `buildReceivedInvoiceDashboardWidgets` with multi-currency consolidation
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
    link: perCurrencyWidgets[0].link,
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
