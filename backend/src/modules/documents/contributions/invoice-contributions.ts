import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { listDocuments } from '../persistence';
import { computeSettlement } from '../settlement/compute-settlement';
import { sumPaidMinorByDocument } from '../settlement/payments';
import { computeDocumentTotals } from '../totals/compute-totals';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { MetricWidget, ShortListWidget, TableWidget, TimeSeriesWidget, Widget } from './widgets';

/**
 * The FIRST real contribution, written to be the model every other one follows — see this module's
 * own comments for the reasoning, not just the shape. It covers exactly what was asked for the
 * invoice: a dashboard curve and a pending-invoices list, plus a statistics table so both locations
 * have one worked example. Everything here is ARITHMETIC (counting, summing a document's own line
 * amounts, or — since payments landed — its own recorded payments) — never a fiscal rule: no VAT
 * INVENTED here (though `computeDocumentTotals` and `computeSettlement` are reused verbatim from
 * their own modules for the "pending" filter below, not reimplemented), no rounding convention
 * invented, no numbering. See invoice.descriptor.ts's own header for the same boundary drawn for the
 * invoice's FIELDS.
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

/** How many document instances a contribution reads before aggregating — see persistence.ts's
 *  `listDocuments` for why this is an explicit, honest cap rather than an unbounded scan. */
const CONTRIBUTION_READ_LIMIT = 500;

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
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

/** The last `CURVE_MONTHS` calendar months, oldest first, each with its bucket key and a short
 *  display label — computed from `now` so a test can pass a fixed date instead of the real clock. */
function recentMonths(now: Date): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = [];
  for (let i = CURVE_MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    });
  }
  return months;
}

/**
 * DASHBOARD: "les factures en attente" (a short list) and "la courbe des factures" (a time series) —
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
  const invoices = await listDocuments(companyId, 'invoice', CONTRIBUTION_READ_LIMIT);

  // A "draft" is not yet issued at all, so it is never "pending" in the sense a reader of this
  // widget means — that part is unchanged. What changed once payments landed (settlement/): a "sent"
  // invoice that has since been SETTLED (paid in full, or overpaid) is no longer awaiting anything
  // either, so it is excluded too — a paid invoice sitting in "pending invoices" would be exactly the
  // kind of stale fact this dashboard exists to avoid. `computeDocumentTotals`/`computeSettlement`
  // are reused verbatim (never reimplemented) for this — see this file's own header.
  const sentInvoices = invoices.filter((invoice) => invoice.status === 'sent');
  const paidMinorByDocument = await sumPaidMinorByDocument(
    companyId,
    sentInvoices.map((invoice) => invoice.id),
  );

  const pendingItems = sentInvoices
    .filter((invoice) => {
      const data = (invoice.data ?? {}) as Record<string, unknown>;
      const grossMinor = computeDocumentTotals(INVOICE_DESCRIPTOR, data).grossMinor;
      const paidMinor = paidMinorByDocument.get(invoice.id) ?? 0;
      return !computeSettlement(grossMinor, [{ amountMinor: paidMinor }]).settled;
    })
    .map((invoice) => {
      const data = (invoice.data ?? {}) as Record<string, unknown>;
      const currency = typeof data.currency === 'string' ? data.currency : '';
      const dueDate = typeof data.dueDate === 'string' ? data.dueDate : undefined;
      return {
        id: invoice.id,
        primary: `${invoiceTotal(data).toFixed(2)} ${currency}`.trim(),
        secondary: dueDate,
        sortKey: dueDate ?? '',
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ id, primary, secondary }) => ({ id, primary, secondary }));

  const pendingWidget: ShortListWidget = {
    id: 'invoice:pending',
    kind: 'shortList',
    label: 'Pending invoices',
    items: pendingItems,
  };

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

  return [pendingWidget, curveWidget];
};

/**
 * STATISTICS: "tout ultra détaillé" — one row per invoice, every field arithmetic can honestly
 * derive from what is already stored (no client name resolution, no cross-module join: this stays a
 * pure aggregation over the invoice's OWN data, the same boundary invoiceTotal draws).
 */
export const buildInvoiceStatisticsWidgets: ContributionHandler = async ({ companyId }) => {
  const invoices = await listDocuments(companyId, 'invoice', CONTRIBUTION_READ_LIMIT);

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
    value: invoices.length,
  };

  return [totalMetric, tableWidget];
};

export function registerInvoiceContributions(registry: ContributionRegistry): void {
  registry.register('invoice', 'dashboard', buildInvoiceDashboardWidgets);
  registry.register('invoice', 'statistics', buildInvoiceStatisticsWidgets);
}

// Re-exported for tests that want to prove the arithmetic directly, the same way
// actions/email-template.ts exports its own pure pieces for email-template.spec.ts.
export type { Widget };
export { invoiceTotal, monthKey, recentMonths };
