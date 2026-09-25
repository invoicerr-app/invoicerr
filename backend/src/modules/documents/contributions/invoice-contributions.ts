import { fromMinor, toMinor } from '@/utils/financial';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { countDocuments, listAllDocuments, listRecentDocuments } from '../persistence';
import { filterUnsettledInvoices, isOverdueInvoice } from '../settlement/unsettled-invoices';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { consolidateByCurrency, loadCurrencyContext } from './currency-consolidation';
import {
  MetricWidget,
  MetricWidgetLink,
  ShortListItem,
  ShortListWidget,
  TableWidget,
  TimeSeriesWidget,
  Widget,
} from './widgets';

/**
 * The FIRST real contribution, written to be the model every other one follows — see this module's
 * own comments for the reasoning, not just the shape. It covers exactly what was asked for the
 * invoice: a dashboard curve and a pending-invoices list, plus a statistics table so both locations
 * have one worked example. Everything here is ARITHMETIC (counting, summing a document's own line
 * amounts, or — since payments (and now credits — credit matching) landed — its own recorded
 * payments and the credit notes correcting it) — never a fiscal rule: no VAT INVENTED here (though
 * `computeDocumentTotals` and `computeSettlement` are reused verbatim from their own modules for the
 * "pending" filter below, not reimplemented), no rounding convention invented, no numbering. See
 * invoice.descriptor.ts's own header for the same boundary drawn for the invoice's FIELDS.
 */

/** The invoice's own base descriptor — see actions/invoice-actions.ts's identical constant for why a
 *  direct import is fine here: this file is already 100% invoice-specific (registered only for
 *  `'invoice'` at the bottom), unlike a generic contribution would be. Used only to feed
 *  `computeDocumentTotals` the field shape it needs for the "pending" filter below — `invoiceTotal`
 *  itself (this file's own arithmetic) stays independent of it, unchanged. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/** How many months the "invoices issued" curve covers — a small, fixed window; a real settings
 *  screen for this is future work, not something to half-build here for one widget. */
const CURVE_MONTHS = 6;

/** How many rows the STATISTICS table below lists — a display cap, and the only one left in this
 *  file. The table is a screen listing individual invoices, so showing the most recent N is a real
 *  answer; the widget says so in its own `warnings` the moment the company has more. Every
 *  AGGREGATE here (the dashboard's totals, the curve, the count metric) is computed over the whole
 *  set instead — a sum or a count read off a capped page is simply a wrong number. */
const STATISTICS_TABLE_ROW_LIMIT = 500;

interface InvoiceLineLike {
  quantity?: unknown;
  unitPrice?: unknown;
}

/** `quantity * unitPrice`, summed over the invoice's own `lines` — arithmetic on the document's OWN
 *  stored numbers, nothing else: no VAT, no discount, no rounding rule invented on top. A line
 *  missing either number contributes 0 rather than throwing — a still-being-filled draft is a normal
 *  state to aggregate over, not an error. */
function invoiceTotal(data: Record<string, unknown>): number {
  const lines = Array.isArray(data.lines) ? (data.lines as InvoiceLineLike[]) : [];
  return lines.reduce((sum, line) => {
    const quantity = typeof line.quantity === 'number' ? line.quantity : 0;
    const unitPrice = typeof line.unitPrice === 'number' ? line.unitPrice : 0;
    return sum + quantity * unitPrice;
  }, 0);
}

/** "2026-08" for any parseable date-ish value, or null — used to bucket invoices by ISSUE month. */
function monthKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  // UTC getters — same reasoning as expense-contributions.ts's own monthKey (see its comment: the
  // stored date-only strings ARE UTC midnights; mixing local getters with UTC-keyed "now" made an
  // issue dated "today" fall out of "this month" near a month boundary, caught by the battery).
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `"2026-08"` -> `{ dateFrom: "2026-08-01", dateTo: "2026-08-31" }`: the exact UTC calendar-month
 *  boundaries `monthKey` itself buckets by, reused so the "Invoiced this month" tile's `link` filters
 *  the list to precisely the same month the figure sums, never a boundary independently recomputed
 *  (and therefore possibly disagreeing) elsewhere. */
function monthRange(key: string): { dateFrom: string; dateTo: string } {
  const [year, month] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { dateFrom: `${key}-01`, dateTo: `${key}-${String(lastDay).padStart(2, '0')}` };
}

/** The last `CURVE_MONTHS` calendar months, oldest first, each with its bucket key and a short
 *  display label — computed from `now` so a test can pass a fixed date instead of the real clock. */
function recentMonths(now: Date): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = [];
  for (let i = CURVE_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    });
  }
  return months;
}

/**
 * DASHBOARD: pending invoices (a short list) and the invoices curve (a time series) —
 * the exact two examples the task cites.
 *
 * The curve COUNTS invoices per month; it deliberately does NOT sum their amounts. Invoices can be
 * issued in different currencies (invoice.descriptor.ts's own `currency` field is per-document, not
 * fixed), so adding amounts across them would silently mix currencies into one meaningless number —
 * exactly the kind of quiet wrongness this codebase refuses elsewhere (see country-policy's own
 * "never a permissive fallback" discipline). "How many invoices were issued this month" is
 * well-defined regardless of currency; "how much revenue" is not, without a conversion rate this
 * branch has no business inventing.
 */
export const buildInvoiceDashboardWidgets: ContributionHandler = async ({ companyId }) => {
  // Every invoice, paged until exhausted: each figure below (the pending list and its per-currency
  // totals, the overdue totals, the curve, "issued this month") is an aggregate over ALL of this
  // company's invoices, and a capped read made every one of them silently understate itself as soon
  // as the company had more invoices than the cap.
  const invoices = await listAllDocuments(companyId, { typeId: 'invoice' });

  // A "draft" is not yet issued at all, so it is never "pending" in the sense a reader of this
  // widget means — that part is unchanged. What changed once payments (and now credits —
  // credit matching) landed (settlement/): a "sent" invoice that has since been SETTLED (paid in full,
  // credited in full, or a mix that exceeds it) is no longer awaiting anything either, so it is
  // excluded too — a fully-credited invoice sitting in "pending invoices" would be exactly the stale,
  // still-chasing-a-customer-for-nothing fact the settlement exclusion exists to fix. The predicate
  // itself now lives in `settlement/unsettled-invoices.ts#filterUnsettledInvoices` (`computeDocumentTotals`/
  // `computeSettlement` are reused verbatim there, never reimplemented), shared with `GET /documents`'s
  // own `settlement=unsettled` list filter: this tile's `link` (below) points at exactly that filter,
  // so the two can never disagree on what "pending" means.
  //
  // A "cancelled" invoice (invoice.descriptor.ts) is EXCLUDED here too, for
  // free: `status === 'sent'` was always a STRICT equality, never a "not draft" negation, so the new
  // status simply never matches it — nothing to add. This is the settlement/contributions decision
  // to establish and pin: a void invoice must never count toward "pending" (nothing is
  // owed on a document that no longer legally exists) — invoice-contributions.spec.ts's own
  // "excludes a 'cancelled' invoice" test proves it. The STATISTICS table below (`buildInvoice
  // StatisticsWidgets`) deliberately keeps counting it — that table is a full audit list of every
  // invoice ever issued, "cancelled" included, exactly like "draft"/"send_failed" already are.
  const pendingInvoices = await filterUnsettledInvoices(companyId, INVOICE_DESCRIPTOR, invoices);

  const pendingItems: ShortListItem[] = pendingInvoices
    .map((invoice) => {
      const data = (invoice.data ?? {}) as Record<string, unknown>;
      const currency = typeof data.currency === 'string' ? data.currency : '';
      const dueDate = typeof data.dueDate === 'string' ? data.dueDate : undefined;
      const total = invoiceTotal(data);
      return {
        id: invoice.id,
        // The invoice's own number when it has one (a "sent" invoice normally does — numbering
        // happens on send), the plain amount otherwise: the row's title is the FACT that identifies
        // the record, never a number fabricated from its id. The amount travels structured in
        // `amount` (below) so the row can right-align it whichever of the two `primary` carries.
        primary: invoice.displayNumber ?? `${total.toFixed(2)} ${currency}`.trim(),
        secondary: dueDate,
        status: invoice.status,
        dueDate,
        amount: currency ? { value: Number(total.toFixed(2)), currency } : undefined,
        sortKey: dueDate ?? '',
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ sortKey: _sortKey, ...item }) => item);

  const pendingWidget: ShortListWidget = {
    id: 'invoice:pending',
    kind: 'shortList',
    label: 'Pending invoices',
    documentTypeId: 'invoice',
    items: pendingItems,
  };

  // "Overdue" — the pending invoices whose due date is already behind us, totalled per currency
  // with the same never-across-currencies rule as every other sum in this file. Compared as
  // YYYY-MM-DD strings against a UTC "today", the same clock `monthKey` uses (see its comment): an
  // invoice due today is not yet overdue, one due yesterday is. Emitted for every currency that has
  // pending invoices at all — a 0 next to a "pending" total says "nothing late", which a missing
  // tile would not — and as one currency-less zero when nothing is pending (no currency to label
  // a zero with, same reasoning as expense-contributions.ts's own empty-month metric).
  const todayIso = new Date().toISOString().slice(0, 10);
  // The same `settlement=overdue` filter, on every one of this metric's own variants below: per
  // `MetricWidgetLink`'s own header, a metric carries a link only when a list exists whose rows are
  // exactly the documents the figure aggregates.
  const overdueLink: MetricWidgetLink = { typeId: 'invoice', status: ['sent'], settlement: 'overdue' };
  const overdueTotalsByCurrency = new Map<string, number>();
  for (const invoice of pendingInvoices) {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    const currency = typeof data.currency === 'string' && data.currency ? data.currency : 'UNKNOWN';
    const overdue = isOverdueInvoice(invoice, todayIso);
    overdueTotalsByCurrency.set(
      currency,
      (overdueTotalsByCurrency.get(currency) ?? 0) + (overdue ? invoiceTotal(data) : 0),
    );
  }
  const overdueTotalWidgets: MetricWidget[] =
    overdueTotalsByCurrency.size === 0
      ? [
          {
            id: 'invoice:overdue-total',
            kind: 'metric',
            label: 'Overdue invoices total',
            value: 0,
            link: overdueLink,
          },
        ]
      : [...overdueTotalsByCurrency.entries()]
          .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
          .map(([currency, total]) => ({
            id: `invoice:overdue-total:${currency}`,
            kind: 'metric',
            label: `Overdue invoices total (${currency})`,
            unit: currency,
            value: Number(total.toFixed(2)),
            link: overdueLink,
          }));

  // "the pending invoices total" (the multi-currency wording) — grouped by
  // currency, same discipline as expense-contributions.ts's own monthly totals and this file's own
  // curve above: NEVER summed across currencies. `id` is prefixed `invoice:pending-total:` so
  // buildInvoiceDashboardWidgetsWithConsolidation (below) can find exactly these widgets, and only
  // these, to feed multi-currency consolidation.
  const pendingLink: MetricWidgetLink = { typeId: 'invoice', status: ['sent'], settlement: 'unsettled' };
  const pendingTotalsByCurrency = new Map<string, number>();
  for (const invoice of pendingInvoices) {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    const currency = typeof data.currency === 'string' && data.currency ? data.currency : 'UNKNOWN';
    pendingTotalsByCurrency.set(currency, (pendingTotalsByCurrency.get(currency) ?? 0) + invoiceTotal(data));
  }
  const pendingTotalWidgets: MetricWidget[] = [...pendingTotalsByCurrency.entries()]
    .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
    .map(([currency, total]) => ({
      id: `invoice:pending-total:${currency}`,
      kind: 'metric',
      label: `Pending invoices total (${currency})`,
      unit: currency,
      value: Number(total.toFixed(2)),
      link: pendingLink,
    }));

  const months = recentMonths(new Date());
  const countsByMonth = new Map<string, number>();
  for (const invoice of invoices) {
    const key = monthKey((invoice.data as Record<string, unknown> | null)?.issueDate);
    if (!key) continue;
    countsByMonth.set(key, (countsByMonth.get(key) ?? 0) + 1);
  }

  const curveWidget: TimeSeriesWidget = {
    id: 'invoice:issued-per-month',
    kind: 'timeSeries',
    label: 'Invoices issued',
    points: months.map(({ key, label }) => ({ label, value: countsByMonth.get(key) ?? 0 })),
  };

  // "Issued this month" — what was actually invoiced this calendar month, per currency, next to
  // last month's figure in the same currency (`previousValue`) so the tile can show a direction.
  // Only invoices that REACHED "sent" count: a draft is not issued, a "send_failed" one never left,
  // and a "cancelled" one is void (the same exclusion the pending list applies above). The curve
  // just above deliberately keeps counting every invoice by date, whatever its status — it answers
  // "how busy was each month", this answers "what did we invoice"; two questions, two widgets.
  const thisMonthKey = months[months.length - 1].key;
  const lastMonthKey = months[months.length - 2].key;
  const issuedByCurrency = new Map<string, { thisMonth: number; lastMonth: number }>();
  for (const invoice of invoices) {
    if (invoice.status !== 'sent') continue;
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    const key = monthKey(data.issueDate);
    if (key !== thisMonthKey && key !== lastMonthKey) continue;
    const currency = typeof data.currency === 'string' && data.currency ? data.currency : 'UNKNOWN';
    const bucket = issuedByCurrency.get(currency) ?? { thisMonth: 0, lastMonth: 0 };
    if (key === thisMonthKey) bucket.thisMonth += invoiceTotal(data);
    else bucket.lastMonth += invoiceTotal(data);
    issuedByCurrency.set(currency, bucket);
  }
  // Same month boundaries the figure itself buckets by (`monthKey`/`monthRange`), so the tile's own
  // link never drifts from the number it decorates.
  const issuedLink: MetricWidgetLink = {
    typeId: 'invoice',
    status: ['sent'],
    ...monthRange(thisMonthKey),
  };
  const issuedThisMonthWidgets: MetricWidget[] =
    issuedByCurrency.size === 0
      ? [
          {
            id: 'invoice:issued-this-month',
            kind: 'metric',
            label: 'Invoiced this month',
            value: 0,
            link: issuedLink,
          },
        ]
      : [...issuedByCurrency.entries()]
          .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
          .map(([currency, { thisMonth, lastMonth }]) => ({
            id: `invoice:issued-this-month:${currency}`,
            kind: 'metric',
            label: `Invoiced this month (${currency})`,
            unit: currency,
            value: Number(thisMonth.toFixed(2)),
            previousValue: Number(lastMonth.toFixed(2)),
            link: issuedLink,
          }));

  // Metrics first, then the list, then the curve — the reading order of a dashboard (headline
  // figures before detail). The frontend groups by `kind` anyway; this order is for API readers.
  return [
    ...issuedThisMonthWidgets,
    ...pendingTotalWidgets,
    ...overdueTotalWidgets,
    pendingWidget,
    curveWidget,
  ];
};

/**
 * Wraps `buildInvoiceDashboardWidgets` with multi-currency consolidation — same
 * split, for the same reason, as expense-contributions.ts's own
 * `buildExpenseDashboardWidgetsWithConsolidation` (see that function's own header): the base handler
 * above stays exactly what invoice-contributions.spec.ts already tests directly — it never touches
 * the currency-rates store — so nothing about its own tests needs to change for this feature to
 * exist. `registerInvoiceContributions` below registers THIS wrapper for the dashboard location.
 *
 * Only the `invoice:pending-total:*` metrics (this file's own, just above) feed consolidation — the
 * shortList and timeSeries widgets have no per-currency total to convert in the first place.
 */
export const buildInvoiceDashboardWidgetsWithConsolidation: ContributionHandler = async (ctx) => {
  const widgets = await buildInvoiceDashboardWidgets(ctx);

  const perCurrencyWidgets = widgets.filter(
    (widget): widget is MetricWidget =>
      widget.kind === 'metric' && widget.id.startsWith('invoice:pending-total:'),
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

  if (!consolidated) {
    return widgets; // No referenceCurrency set — the default, unchanged behavior.
  }

  const consolidatedMetric: MetricWidget = {
    id: 'invoice:pending-total:consolidated',
    kind: 'metric',
    label: 'Pending invoices total (consolidated, converted)',
    unit: `${consolidated.currency} (converted)`,
    approx: true,
    value: Number(fromMinor(consolidated.totalMinor, consolidated.currency).toFixed(2)),
    warnings: consolidated.notes,
    // The consolidated figure is a currency-converted SUM of the exact same set the per-currency
    // `invoice:pending-total:*` tiles above already link to: same list, same filter.
    link: { typeId: 'invoice', status: ['sent'], settlement: 'unsettled' },
  };

  return [...widgets, consolidatedMetric];
};

/**
 * STATISTICS: "everything, in exhaustive detail" — one row per invoice, every field arithmetic can honestly
 * derive from what is already stored (no client name resolution, no cross-module join: this stays a
 * pure aggregation over the invoice's OWN data, the same boundary invoiceTotal draws).
 */
export const buildInvoiceStatisticsWidgets: ContributionHandler = async ({ companyId }) => {
  // TWO reads, deliberately: the table is a capped DISPLAY list, the count metric beside it is a
  // total. Reading the count off `invoices.length` would make "Total invoices" report the size of
  // the page — a number that stops growing the moment the company passes the cap, while the screen
  // goes on calling it the total.
  const [invoices, invoiceCount] = await Promise.all([
    listRecentDocuments(companyId, { typeId: 'invoice', take: STATISTICS_TABLE_ROW_LIMIT }),
    countDocuments(companyId, 'invoice'),
  ]);

  const rows = invoices.map((invoice) => {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    return {
      issueDate: typeof data.issueDate === 'string' ? data.issueDate : '',
      dueDate: typeof data.dueDate === 'string' ? data.dueDate : '',
      status: invoice.status,
      currency: typeof data.currency === 'string' ? data.currency : '',
      total: Number(invoiceTotal(data).toFixed(2)),
    };
  });

  const tableWidget: TableWidget = {
    id: 'invoice:all',
    kind: 'table',
    label: 'All invoices',
    // Named on the widget itself, never left for a reader to infer from a row count — a list that
    // silently stops at its cap reads exactly like a complete one.
    warnings:
      invoiceCount > rows.length
        ? [
            `Showing the ${rows.length} most recently updated invoices of ${invoiceCount}. ` +
              `Use the accounting export for a complete period.`,
          ]
        : undefined,
    columns: [
      { key: 'issueDate', label: 'Issue date' },
      { key: 'dueDate', label: 'Due date' },
      { key: 'status', label: 'Status' },
      { key: 'currency', label: 'Currency' },
      { key: 'total', label: 'Total' },
    ],
    rows,
  };

  const totalMetric: MetricWidget = {
    id: 'invoice:count',
    kind: 'metric',
    label: 'Total invoices',
    value: invoiceCount,
  };

  return [totalMetric, tableWidget];
};

export function registerInvoiceContributions(registry: ContributionRegistry): void {
  registry.register('invoice', 'dashboard', buildInvoiceDashboardWidgetsWithConsolidation);
  registry.register('invoice', 'statistics', buildInvoiceStatisticsWidgets);
}

// Re-exported for tests that want to prove the arithmetic directly, the same way
// actions/email-template.ts exports its own pure pieces for email-template.spec.ts.
export type { Widget };
export { invoiceTotal, monthKey, monthRange, recentMonths };
