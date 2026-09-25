import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { countDocuments, listRecentDocuments } from '../persistence';
import { computeDocumentTotals } from '../totals/compute-totals';
import { fromMinor } from '@/utils/financial';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { MetricWidget, MetricWidgetLink, ShortListWidget, TableWidget, Widget } from './widgets';

/**
 * The THIRD real contribution — see invoice-contributions.ts's own header for the model this one
 * follows. Still arithmetic only: counting quotes, and reusing (never reinventing) the one place
 * that already computes a document's fiscal total.
 */

/** How many rows the STATISTICS table below lists — a display cap on a screen listing individual
 *  quotes, named in the widget's own `warnings` when the company has more. The counts beside it are
 *  counted in SQL over every quote, never off this page. */
const STATISTICS_TABLE_ROW_LIMIT = 500;

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
 * Relies on `listRecentDocuments` already ordering by `updatedAt` DESC (persistence.ts) for "most
 * recently touched first", exactly what "the most recent" means for a list of drafts — no extra sort here,
 * unlike invoice-contributions.ts's own pending list (which re-sorts by DUE date, because urgency,
 * not recency, is what that one means).
 */
export const buildQuoteDashboardWidgets: ContributionHandler = async ({ companyId }) => {
  // The shortlist reads DRAFTS ONLY, filtered in SQL, so the five it shows are genuinely this
  // company's five most recent drafts. Filtering `status === 'draft'` in memory over a capped page of
  // every quote meant a company whose recent activity was all sent quotes got an EMPTY "Draft quotes"
  // widget while having plenty. The open-quote count beside it is counted in SQL for the same reason:
  // a count taken over a page counts the page.
  const [draftQuotes, openCount] = await Promise.all([
    listRecentDocuments(companyId, { typeId: 'quote', status: ['draft'], take: DRAFT_SHORT_LIST_LIMIT }),
    countDocuments(companyId, 'quote', ['draft', 'sent']),
  ]);

  const draftItems = draftQuotes.map((quote) => {
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
      status: quote.status,
    };
  });

  const widget: ShortListWidget = {
    id: 'quote:draft',
    kind: 'shortList',
    label: 'Draft quotes',
    documentTypeId: 'quote',
    items: draftItems,
  };

  // "Open quotes" — the ones still awaiting an outcome: a draft (not yet sent) or a sent one the
  // client has neither signed nor let lapse. A count, never a sum (see the statistics handler
  // below for why); "sending"/"send_failed" are transient send states, not an open offer, and
  // "signed" is closed — so this is a positive list of two statuses, not a "not closed" negation
  // that would silently absorb any status added later.
  const openMetric: MetricWidget = {
    id: 'quote:open-count',
    kind: 'metric',
    label: 'Open quotes',
    value: openCount,
    // Same statuses `countDocuments` above just counted: a draft or a sent quote awaiting an
    // outcome, per this function's own header.
    link: { typeId: 'quote', status: ['draft', 'sent'] } satisfies MetricWidgetLink,
  };

  return [openMetric, widget];
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
  // The table is a capped display list; "Quotes sent" is a count over every quote this company has,
  // counted in SQL. Derived from the page, that metric would stop growing at the cap and go on
  // calling itself a total.
  const [quotes, quoteCount, sentCount] = await Promise.all([
    listRecentDocuments(companyId, { typeId: 'quote', take: STATISTICS_TABLE_ROW_LIMIT }),
    countDocuments(companyId, 'quote'),
    countDocuments(companyId, 'quote', ['sent']),
  ]);

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
    // See invoice-contributions.ts's identical caveat: a list that silently stops at its cap reads
    // exactly like a complete one, so the widget says which it is.
    warnings:
      quoteCount > rows.length
        ? [`Showing the ${rows.length} most recently updated quotes of ${quoteCount}.`]
        : undefined,
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
