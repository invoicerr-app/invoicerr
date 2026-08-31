import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { listDocuments } from '../persistence';
import { computeDocumentTotals } from '../totals/compute-totals';
import { fromMinor } from '@/utils/financial';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { MetricWidget, ShortListWidget, TableWidget, Widget } from './widgets';

/**
 * The THIRD real contribution — see invoice-contributions.ts's own header for the model this one
 * follows. Still arithmetic only: counting quotes, and reusing (never reinventing) the one place
 * that already computes a document's fiscal total.
 */

/** Same explicit, honest cap as every other contribution file's own — persistence.ts's
 *  `listDocuments`, never an unbounded scan. */
const CONTRIBUTION_READ_LIMIT = 500;

/** How many draft quotes the dashboard shortlist shows — "the handful a dashboard glance needs"
 *  (widgets.ts's own words for `ShortListWidget`), not every draft a company has ever saved. */
const DRAFT_SHORT_LIST_LIMIT = 5;

/** Built once, not per row: a descriptor is a plain, stateless data structure — see
 *  descriptors/quote.descriptor.ts. */
const QUOTE_DESCRIPTOR = buildQuoteDescriptor();

/**
 * A quote's own gross (tax-included) total, for the statistics table's "Total" column — reuses
 * totals/compute-totals.ts's `computeDocumentTotals` rather than re-deriving a second, VAT-blind sum
 * the way invoice-contributions.ts's own `invoiceTotal` does. That shortcut works for the invoice's
 * table because it was written before this question mattered enough to answer properly; it is not
 * something to repeat here. A quote's lines carry a real `vatRate` (quote.descriptor.ts), so a
 * PER-DOCUMENT tax-included figure is fiscal arithmetic that already has a correct, tested
 * implementation — reinventing it in this file would be exactly the kind of home-grown machinery
 * this codebase avoids when a library (here, an in-repo one) already does the job.
 *
 * Never used to aggregate ACROSS documents — see buildQuoteDashboardWidgets' own comment for why
 * counting, not summing, stays the rule the moment more than one document/currency is involved.
 */
function quoteGrossTotal(data: Record<string, unknown>): { amount: number; currency: string } {
  const totals = computeDocumentTotals(QUOTE_DESCRIPTOR, data);
  const currency = totals.currency ?? '';
  // fromMinor needs SOME currency to pick a decimal count; an unresolved currency (totals.currency
  // is null) still needs an amount rendered, so it falls back to the same 2-decimal default
  // compute-totals.ts itself already warns about and falls back to internally.
  return { amount: fromMinor(totals.grossMinor, currency || 'EUR'), currency };
}

/**
 * DASHBOARD: the quotes still sitting in "draft" — the shortlist the task asked for.
 *
 * Relies on `listDocuments` already ordering by `updatedAt` DESC (persistence.ts) for "most recently
 * touched first", exactly what "les plus récents" means for a list of drafts — no extra sort here,
 * unlike invoice-contributions.ts's own pending list (which re-sorts by DUE date, because urgency,
 * not recency, is what that one means).
 */
export const buildQuoteDashboardWidgets: ContributionHandler = async ({ companyId }) => {
  const quotes = await listDocuments(companyId, 'quote', CONTRIBUTION_READ_LIMIT);

  const draftItems = quotes
    .filter((quote) => quote.status === 'draft')
    .slice(0, DRAFT_SHORT_LIST_LIMIT)
    .map((quote) => {
      const data = (quote.data ?? {}) as Record<string, unknown>;
      const issueDate = typeof data.issueDate === 'string' ? data.issueDate : undefined;
      return {
        id: quote.id,
        // A brand-new draft has never been numbered — numbering only happens the first time a quote
        // reaches "sent" (quote.descriptor.ts's `numbering: { onEnterStatus: 'sent' }`). But a quote
        // that WAS sent and then re-saved as a draft (`save-draft` writes "draft" `from: 'always'` —
        // generic-actions.ts) keeps the number it already earned: `DocumentInstance.displayNumber`
        // is "never cleared or reassigned" once set (schema.prisma's own comment). So this reads the
        // real column and shows the FACT either way — a genuine number when one exists, an honest
        // "no number yet" when it does not — never a number fabricated from the id or the position
        // in the list. Same literal wording render-html.ts already uses for the identical fact.
        primary: quote.displayNumber ?? 'Draft — no number yet',
        secondary: issueDate,
      };
    });

  const widget: ShortListWidget = {
    id: 'quote:draft',
    kind: 'shortList',
    label: 'Draft quotes',
    items: draftItems,
  };

  return [widget];
};

/**
 * STATISTICS: "Quotes sent" (a count, never a sum — quotes can carry different currencies, exactly
 * invoice-contributions.ts's own reason for never summing across them) and a detailed table.
 *
 * "Sent" here means the quote's CURRENT status is "sent" — deliberately the simpler reading, not
 * "has this quote EVER reached sent" (which `number !== null`/`displayNumber !== null` would capture
 * even for one later edited back to "draft"). Nothing asked for that richer, more forgiving
 * definition, and inventing it here would be a policy call nobody made — the exact restraint
 * quote.descriptor.ts's own header already applies to what actions/statuses this type gets.
 */
export const buildQuoteStatisticsWidgets: ContributionHandler = async ({ companyId }) => {
  const quotes = await listDocuments(companyId, 'quote', CONTRIBUTION_READ_LIMIT);

  const sentCount = quotes.filter((quote) => quote.status === 'sent').length;

  const rows = quotes.map((quote) => {
    const data = (quote.data ?? {}) as Record<string, unknown>;
    const { amount, currency } = quoteGrossTotal(data);
    return {
      issueDate: typeof data.issueDate === 'string' ? data.issueDate : '',
      dueDate: typeof data.dueDate === 'string' ? data.dueDate : '',
      status: quote.status,
      currency,
      total: Number(amount.toFixed(2)),
    };
  });

  const tableWidget: TableWidget = {
    id: 'quote:all',
    kind: 'table',
    label: 'All quotes',
    columns: [
      { key: 'issueDate', label: 'Issue date' },
      { key: 'dueDate', label: 'Due date' },
      { key: 'status', label: 'Status' },
      { key: 'currency', label: 'Currency' },
      { key: 'total', label: 'Total (incl. VAT)' },
    ],
    rows,
  };

  const sentMetric: MetricWidget = {
    id: 'quote:sent-count',
    kind: 'metric',
    label: 'Quotes sent',
    value: sentCount,
  };

  return [sentMetric, tableWidget];
};

export function registerQuoteContributions(registry: ContributionRegistry): void {
  registry.register('quote', 'dashboard', buildQuoteDashboardWidgets);
  registry.register('quote', 'statistics', buildQuoteStatisticsWidgets);
}

// Re-exported for tests that want to prove the arithmetic directly — same convention
// invoice-contributions.ts's own bottom export follows.
export type { Widget };
export { quoteGrossTotal };
