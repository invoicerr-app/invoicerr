import { findOwnedDocument, upsertDocument } from '../persistence';
import { DocumentInstanceResult, ActionResult } from './action-registry';

/**
 * The skeleton BOTH quote->invoice actions share (convert-to-invoice.ts's "convert-to-invoice",
 * request-deposit.ts's "request-deposit"): load the acted-upon quote, guard it actually exists, hand
 * its data to a caller-supplied builder that knows the ONE thing that differs between the two (what
 * the new invoice's `data` should actually contain), persist the result as a brand-new DRAFT invoice,
 * and return the standard ActionResult envelope. Extracted here the day a SECOND action needed this
 * exact shape — before that, convert-to-invoice.ts inlined all five steps itself, which was the right
 * call for a lone caller (see this module's own git history) but would have meant a genuine copy of
 * the guard/find/upsert/envelope wiring for request-deposit.ts to repeat, not just similar-looking
 * code coincidentally reading the same way twice.
 *
 * Deliberately does NOT decide `dueDate`, `notes`, `lines`, or anything else about the invoice's
 * CONTENT — that stays each caller's own, genuinely different business (verbatim copy for
 * "convert-to-invoice"; a single computed deposit line for "request-deposit"). This file only ever
 * knows "a quote becomes a new draft invoice, linked back via `origin`", never what the invoice
 * should say.
 */
export async function createDraftInvoiceFromQuote(
  companyId: string,
  documentId: string | undefined,
  actionLabel: string,
  buildInvoiceData: (
    quote: DocumentInstanceResult,
    quoteData: Record<string, unknown>,
  ) => Record<string, unknown>,
  buildMessage: (quote: DocumentInstanceResult, invoice: DocumentInstanceResult) => string,
): Promise<ActionResult> {
  if (!documentId) {
    // Unreachable in practice — the descriptor's own `availableWhen` already refuses this before the
    // handler runs (a never-saved record has no status to match) — but a handler never trusts that
    // alone, the same discipline duplicate-extension.ts documents.
    throw new Error(`Cannot ${actionLabel} a quote that has not been saved yet.`);
  }

  const quote = await findOwnedDocument(companyId, 'quote', documentId);
  const quoteData = (quote.data ?? {}) as Record<string, unknown>;

  const invoiceData = buildInvoiceData(quote, quoteData);
  const invoice = await upsertDocument(companyId, 'invoice', undefined, 'draft', invoiceData);

  return {
    document: invoice,
    changed: true,
    message: buildMessage(quote, invoice),
  };
}
