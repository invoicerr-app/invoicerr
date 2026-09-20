import { NotFoundException } from '@nestjs/common';

import { countDocuments, findOwnedDocument, listRecentDocuments } from '../persistence';
import { ContributionHandler, ContributionRegistry } from './contribution-registry';
import { TableWidget, Widget } from './widgets';

/**
 * The FOURTH real contribution — STATISTICS only, by design. See `registerCreditNoteContributions`
 * below for exactly what that means for the descriptor.
 */

/** How many rows the STATISTICS table below lists — a display cap on a screen listing individual
 *  credit notes, named in the widget's own `warnings` when the company has more. This file emits no
 *  aggregate at all (no total, no count), so the cap ends here: nothing is computed from the page.
 *  Credit-note ALLOCATION — the arithmetic that actually reduces what an invoice owes — reads every
 *  note instead (`settlement/credits.ts#listCreditNotes`). */
const STATISTICS_TABLE_ROW_LIMIT = 500;

/**
 * The invoice a credit note corrects, as a human-facing string — its own `displayNumber` when the
 * invoice still exists and has one, its bare id when the invoice exists but was never numbered
 * (still a draft — a credit note pointing at a draft invoice is a data oddity nothing here needs to
 * forbid), and the RAW STORED id, untouched, when the invoice cannot be found at all (deleted, or a
 * stale reference). Never throws: one credit note's broken link must not take the whole statistics
 * table down with it — the same "degrade honestly instead of breaking" rule
 * references/document-reference.provider.ts's own `resolve` already applies to the identical
 * NotFoundException case.
 */
async function resolveInvoiceLabel(companyId: string, invoiceId: string): Promise<string> {
  try {
    const invoice = await findOwnedDocument(companyId, 'invoice', invoiceId);
    return invoice.displayNumber ?? invoice.id;
  } catch (error) {
    if (error instanceof NotFoundException) return invoiceId;
    throw error;
  }
}

/**
 * STATISTICS: one row per credit note — issue date, the invoice it corrects (resolved to a display
 * number where possible, see `resolveInvoiceLabel`), and currency. No "status" column: this type has
 * exactly one status ("draft" — credit-note.descriptor.ts never declares a second one), so a column
 * that would read "draft" on every single row tells a reader nothing a detailed table should waste
 * space on.
 */
export const buildCreditNoteStatisticsWidgets: ContributionHandler = async ({ companyId }) => {
  const [creditNotes, creditNoteCount] = await Promise.all([
    listRecentDocuments(companyId, { typeId: 'credit-note', take: STATISTICS_TABLE_ROW_LIMIT }),
    countDocuments(companyId, 'credit-note'),
  ]);

  const rows = await Promise.all(
    creditNotes.map(async (creditNote) => {
      const data = (creditNote.data ?? {}) as Record<string, unknown>;
      const invoiceId = typeof data.invoice === 'string' ? data.invoice : '';
      return {
        issueDate: typeof data.issueDate === 'string' ? data.issueDate : '',
        invoice: invoiceId ? await resolveInvoiceLabel(companyId, invoiceId) : '',
        currency: typeof data.currency === 'string' ? data.currency : '',
      };
    }),
  );

  const tableWidget: TableWidget = {
    id: 'credit-note:all',
    kind: 'table',
    label: 'All credit notes',
    // See invoice-contributions.ts's identical caveat: a list that silently stops at its cap reads
    // exactly like a complete one, so the widget says which it is.
    warnings:
      creditNoteCount > rows.length
        ? [`Showing the ${rows.length} most recently updated credit notes of ${creditNoteCount}.`]
        : undefined,
    columns: [
      { key: 'issueDate', label: 'Issue date' },
      { key: 'invoice', label: 'Invoice' },
      { key: 'currency', label: 'Currency' },
    ],
    rows,
  };

  return [tableWidget];
};

/**
 * Registers ONLY the "statistics" contribution — no "dashboard" at all, and
 * credit-note.descriptor.ts's own `contributions` array must stay in lockstep (declaring
 * 'statistics' only): a descriptor that named 'dashboard' with nothing registered here would show
 * the ever-present "unimplemented" marker (contributions/collect-widgets.ts) forever, which is
 * exactly the visible failure mode that marker exists to catch — and here the missing code is not an
 * oversight, it is the decision.
 *
 * A credit note is rare relative to invoices in ordinary use (it corrects a mistake; most invoices
 * are never corrected). A dashboard widget that renders empty nearly every time someone glances at
 * the dashboard is not "a small amount of information", it is noise competing for the same space as
 * widgets that usually have something to say — so this type gets no dashboard presence at all,
 * rather than a permanently-empty shortlist or a metric perpetually reading "0". Statistics, whose
 * entire premise is "everything, in exhaustive detail" regardless of volume, is where this type belongs.
 */
export function registerCreditNoteContributions(registry: ContributionRegistry): void {
  registry.register('credit-note', 'statistics', buildCreditNoteStatisticsWidgets);
}

// Re-exported for tests that want to prove the arithmetic directly — same convention
// invoice-contributions.ts's own bottom export follows.
export type { Widget };
export { resolveInvoiceLabel };
