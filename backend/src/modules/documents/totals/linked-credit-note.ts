/**
 * Issue #507 - THE one rule for what a LINKED credit note is worth and what it lists.
 *
 * A linked credit note owns no amounts of its own: `correctedLines` is a `rowSelection`, a pointer at
 * rows of the corrected invoice's own `lines` (`credit-note.descriptor.ts`, "Two shapes, one type"),
 * and its own `lines` stays empty by construction (`credit-note-actions.ts#
 * assertCreditNoteAmountSourceIsUnambiguous`). What it credits is those selected rows, priced with the
 * INVOICE's own descriptor (which is what makes the invoice's per-line `discountPercent` count - the
 * credit note's own `lines` subfields declare no discount), in the invoice's own currency.
 *
 * That rule used to live twice: once in `settlement/credits.ts` (the amount taken off the invoice)
 * and once in `formats/credit-note-source.ts` (issue #472, the e-invoicing file). Everything else that
 * shows a credit note's amount - the PDF, the covering email's `{totalGross}`, the totals card, the
 * list row - ran `computeDocumentTotals(creditNoteDescriptor, creditNoteData)` over the note's own
 * empty `lines` and printed 0.00, with the corrected rows as raw row ids. Every one of those callers
 * now reads THIS file, so the figure a PDF prints, the figure an XML declares and the figure
 * settlement subtracts are one computation, never three that happen to agree.
 *
 * A FREE credit note (no `invoice`) is not touched: `resolveLinkedCreditNote` answers null for it and
 * every caller keeps pricing it from its own `lines`, exactly as before.
 */
import { NotFoundException } from '@nestjs/common';

import { DocumentInstanceResult } from '../actions/action-registry';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { findOwnedDocument, findOwnedDocumentsByIds } from '../persistence';
import { rowIdOf } from '../row-selection/row-selection';
import { ComputeTotalsOptions, computeDocumentTotals, DocumentTotals } from './compute-totals';

/** The descriptor a linked credit note is priced (and its corrected rows rendered) with: the
 *  INVOICE's. See this file's own header. */
export const LINKED_CREDIT_NOTE_PRICING_DESCRIPTOR: DocumentTypeDescriptor = buildInvoiceDescriptor();

/** The invoice a credit note corrects, or undefined for a FREE credit note. */
export function correctedInvoiceIdOf(noteData: Record<string, unknown>): string | undefined {
  return typeof noteData.invoice === 'string' && noteData.invoice.trim() ? noteData.invoice : undefined;
}

/** The corrected invoice's rows the note selects, in the INVOICE's own order, as stored (row id
 *  included). A selected id the invoice no longer holds is simply absent. */
export function selectCorrectedInvoiceLines(
  noteData: Record<string, unknown>,
  invoiceData: Record<string, unknown>,
): Record<string, unknown>[] {
  const selected = new Set(
    Array.isArray(noteData.correctedLines)
      ? (noteData.correctedLines as unknown[]).filter((id): id is string => typeof id === 'string')
      : [],
  );
  const invoiceLines = Array.isArray(invoiceData.lines) ? (invoiceData.lines as unknown[]) : [];
  return invoiceLines.filter((line): line is Record<string, unknown> => {
    const rowId = rowIdOf(line);
    return rowId !== undefined && selected.has(rowId);
  });
}

/** The credit note's own free text for BT-22: its `notes`, then its `reason` (the "why" a reader of
 *  a credit note needs most), each only when set. */
function creditNoteNotes(data: Record<string, unknown>): string | undefined {
  const parts = [data.notes, data.reason]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Invoice-shaped data for a linked credit note: the corrected invoice's selected lines and client,
 * the credit note's OWN issue date and notes. In memory only, never persisted. Pure, so settlement
 * (which already holds the invoice) and every other caller price from the exact same object.
 */
export function linkedCreditNotePricingData(
  noteData: Record<string, unknown>,
  invoiceData: Record<string, unknown>,
): Record<string, unknown> {
  const notes = creditNoteNotes(noteData);
  return {
    client: invoiceData.client,
    issueDate: noteData.issueDate,
    // The invoice's currency, never the note's own label: the credited amount is denominated in it
    // by construction (settlement/credits.ts's own header on `CreditsForDocument.warnings`).
    currency: invoiceData.currency,
    // BT-10 follows the corrected invoice: a German public buyer's Leitweg-ID routes the correction
    // exactly as it routed the invoice.
    ...(invoiceData.buyerReference !== undefined ? { buyerReference: invoiceData.buyerReference } : {}),
    ...(notes ? { notes } : {}),
    lines: selectCorrectedInvoiceLines(noteData, invoiceData),
  };
}

/** A linked credit note, resolved against the invoice it corrects. */
export interface LinkedCreditNote {
  invoice: Pick<DocumentInstanceResult, 'id' | 'displayNumber' | 'data'>;
  /** The corrected invoice's own `issueDate`, as stored. */
  invoiceIssueDate: unknown;
  /** Always `LINKED_CREDIT_NOTE_PRICING_DESCRIPTOR`, carried so a caller never picks another one. */
  pricingDescriptor: DocumentTypeDescriptor;
  /** `linkedCreditNotePricingData`'s result. */
  pricingData: Record<string, unknown>;
}

function linkedCreditNoteFrom(
  noteData: Record<string, unknown>,
  invoice: Pick<DocumentInstanceResult, 'id' | 'displayNumber' | 'data'>,
): LinkedCreditNote {
  const invoiceData = (invoice.data ?? {}) as Record<string, unknown>;
  return {
    invoice,
    invoiceIssueDate: invoiceData.issueDate,
    pricingDescriptor: LINKED_CREDIT_NOTE_PRICING_DESCRIPTOR,
    pricingData: linkedCreditNotePricingData(noteData, invoiceData),
  };
}

/**
 * Null for a FREE credit note. For a linked one, loads the corrected invoice (company-scoped; a
 * missing one is `findOwnedDocument`'s own 404) and returns what every caller prices and renders from.
 */
export async function resolveLinkedCreditNote(
  companyId: string,
  noteData: Record<string, unknown>,
): Promise<LinkedCreditNote | null> {
  const invoiceId = correctedInvoiceIdOf(noteData);
  if (!invoiceId) return null;
  const invoice = await findOwnedDocument(companyId, 'invoice', invoiceId);
  return linkedCreditNoteFrom(noteData, invoice);
}

/**
 * `resolveLinkedCreditNote` for a caller that SHOWS a document rather than builds a legal file from
 * it (the PDF, the totals endpoint, the detail page): null for any type but "credit-note", for a free
 * one, and for one whose corrected invoice no longer exists. That last case then renders the way it
 * always did instead of refusing the page, the same "a rendering gap never blocks the document" rule
 * `render-instance-pdf.ts` already holds for a dangling reference label.
 */
export async function findLinkedCreditNote(
  companyId: string,
  typeId: string,
  data: Record<string, unknown>,
): Promise<LinkedCreditNote | null> {
  if (typeId !== 'credit-note') return null;
  try {
    return await resolveLinkedCreditNote(companyId, data);
  } catch (error) {
    if (error instanceof NotFoundException) return null;
    throw error;
  }
}

/** The totals a linked credit note stands for: its selected invoice rows, priced with the invoice's
 *  own descriptor. `grossMinor` is, to the cent, what `settlement/credits.ts` takes off the invoice. */
export function linkedCreditNoteTotals(
  linked: LinkedCreditNote,
  options?: ComputeTotalsOptions,
): DocumentTotals {
  return computeDocumentTotals(linked.pricingDescriptor, linked.pricingData, options);
}

/**
 * `linkedCreditNoteTotals` for a whole page of documents at once (the list endpoint), with ONE query
 * for every corrected invoice the page names. Keyed by credit note id; a document that is not a
 * linked credit note, or whose invoice no longer exists, has no entry (the caller then falls back to
 * whatever it shows for any other document, rather than a list page failing on one dangling row).
 */
export async function linkedCreditNoteTotalsByNoteId(
  companyId: string,
  documents: readonly Pick<DocumentInstanceResult, 'id' | 'typeId' | 'data'>[],
): Promise<Map<string, DocumentTotals>> {
  const linkedNotes = documents
    .filter((document) => document.typeId === 'credit-note')
    .map((document) => ({ document, noteData: (document.data ?? {}) as Record<string, unknown> }))
    .map((entry) => ({ ...entry, invoiceId: correctedInvoiceIdOf(entry.noteData) }))
    .filter((entry): entry is typeof entry & { invoiceId: string } => entry.invoiceId !== undefined);

  const result = new Map<string, DocumentTotals>();
  if (linkedNotes.length === 0) return result;

  const invoices = await findOwnedDocumentsByIds(
    companyId,
    linkedNotes.map((entry) => entry.invoiceId),
  );
  const invoiceById = new Map(
    invoices.filter((invoice) => invoice.typeId === 'invoice').map((invoice) => [invoice.id, invoice]),
  );
  for (const { document, noteData, invoiceId } of linkedNotes) {
    const invoice = invoiceById.get(invoiceId);
    if (!invoice) continue;
    result.set(document.id, linkedCreditNoteTotals(linkedCreditNoteFrom(noteData, invoice)));
  }
  return result;
}
