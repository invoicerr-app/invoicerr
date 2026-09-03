import prisma from '@/prisma/prisma.service';

import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { rowIdOf } from '../row-selection/row-selection';
import { computeDocumentTotals } from '../totals/compute-totals';
import { SettlementCreditInput } from './compute-settlement';

/**
 * WHICH credit notes reduce WHAT a document owes, and by HOW MUCH — the resolution step
 * compute-settlement.ts's own header points to (item 8 of the root TODO, "le lettrage").
 *
 * Unlike settlement/payments.ts (a fully generic mechanism: `DocumentPayment` hangs off ANY document
 * type via a bare `documentId` FK, no type name anywhere in that file), a "credit" is NOT generic
 * today: the only document type that can ever reduce another document's claim is "credit-note", and
 * the only thing it can ever correct is an "invoice" — credit-note.descriptor.ts's own `invoice`
 * field is a SINGLE-target `reference`, not a set of possible correctable types. This file is
 * therefore, deliberately, exactly as invoice/credit-note-specific as actions/invoice-actions.ts and
 * contributions/credit-note-contributions.ts already are (see their own headers for the identical
 * "this file already names its type, so hardcoding it here costs nothing" reasoning) —
 * `resolveCreditsForDocument` below is the one function that decides "invoice" is, today, the only
 * correctable type; extending that to a second one later only touches this file.
 */

/** Same explicit, honest cap as every other settlement/contribution read in this module — see
 *  persistence.ts's `listDocuments` and credit-note-contributions.ts's own `CONTRIBUTION_READ_LIMIT`. */
const CREDIT_NOTE_READ_LIMIT = 500;

/** One credit note counted (or named in a warning) against a document — mirrors the shape
 *  `DocumentPaymentResult` (settlement/payments.ts) gives a payment, so the frontend can render both
 *  lists the same way without inventing a second convention. */
export interface DocumentCreditResult {
  id: string;
  /** The credit note's own `displayNumber` — always null today, since credit-note.descriptor.ts
   *  declares no `numbering` at all yet (see that file's own comment on why this task does not add
   *  one) — kept as a field regardless, exactly like `DocumentPaymentResult` already anticipates
   *  facts a payment doesn't have yet, so numbering a credit note later needs no shape change here. */
  displayNumber: string | null;
  amountMinor: number;
  currency: string;
}

export interface CreditsForDocument {
  credits: DocumentCreditResult[];
  /**
   * Plain English, same convention as `DocumentTotals.warnings`.
   *
   * TODO_PRODUIT.md T3 ("un avoir suit la même règle que sa facture") — before this task, a credit
   * note whose OWN `currency` field differed from the invoice's was EXCLUDED here entirely (never
   * counted, never converted) on the theory that it needed the SAME dated-rate conversion a foreign
   * payment does. It does not: `computeCreditedAmountMinor` below computes the credited GROSS amount
   * FROM the corrected INVOICE's own priced lines (`invoiceData`, never `noteData`) — the number is
   * therefore ALREADY, unavoidably, in the invoice's own currency, regardless of what currency the
   * credit note document itself declares for its own `currency` field. Applying an exchange rate to
   * it would not be "the same rule as its invoice", it would be a BUG: rescaling a number that was
   * never denominated in the note's own currency to begin with (the note's `currency` field is
   * cosmetic here — nothing on this type ever prices anything independently, unlike an invoice's own
   * `lines`). "The same rule as its invoice" is satisfied more literally than a conversion ever could:
   * the invoice's own currency governs, unconditionally — a mismatched note's own currency label is
   * still named here (never silently hidden — a genuinely confusing data entry, worth a reader's
   * attention), but no longer excludes the credit from the arithmetic. A draft credit note still
   * produces no warning at all: an unfinished document is an ordinary, expected state, not a data
   * problem worth flagging the way a currency-label mismatch is.
   */
  warnings: string[];
}

/**
 * The credited amount for ONE credit note — the GROSS/TTC of ONLY the invoice lines it actually
 * corrects (`correctedLines`), computed with the INVOICE's OWN descriptor. Deliberately NOT
 * `computeDocumentTotals(creditNoteDescriptor, creditNoteData)`: the credit note's own descriptor has
 * no 'array' field to compute from at all — `correctedLines` is a 'rowSelection' (a POINTER into the
 * invoice's `lines`, see row-selection/row-selection.ts), never a fresh table of amounts — so that
 * call would always yield zero totals, for every credit note, regardless of what it corrects.
 *
 * GROSS, not NET: the invoice owes its GROSS/TTC total (compute-settlement.ts's own
 * `totalGrossMinor`), so a credit note correcting part of it must withdraw the same kind of amount
 * — a credit that only removed the NET part of a line would leave its VAT still, wrongly, owed.
 */
function computeCreditedAmountMinor(
  invoiceDescriptor: DocumentTypeDescriptor,
  invoiceData: Record<string, unknown>,
  correctedLines: readonly string[],
): number {
  const allLines = Array.isArray(invoiceData.lines) ? (invoiceData.lines as unknown[]) : [];
  const selectedIds = new Set(correctedLines);
  const selectedLines = allLines.filter((line) => {
    const rowId = rowIdOf(line);
    return rowId !== undefined && selectedIds.has(rowId);
  });
  return computeDocumentTotals(invoiceDescriptor, { ...invoiceData, lines: selectedLines }).grossMinor;
}

/**
 * Every "credit-note" instance for the company, EVERY status — the status filter (only "sent"
 * counts) lives in `creditsForInvoiceFromNotes` below, not here, so that rule is a plain, pure,
 * directly-testable predicate rather than baked into a Prisma `where` clause nothing can unit-test
 * without a database. No indexed column to filter `data.invoice` by either (a credit note's target
 * lives inside its JSON `data`, same as every other document field) — the same "query by
 * companyId+typeId, filter the JSON in memory" convention this module's own
 * credit-note-contributions.ts (`resolveInvoiceLabel`) already uses.
 */
async function listCreditNotes(companyId: string): Promise<DocumentInstanceResult[]> {
  return prisma.documentInstance.findMany({
    where: { companyId, typeId: 'credit-note' },
    orderBy: { createdAt: 'asc' },
    take: CREDIT_NOTE_READ_LIMIT,
  });
}

/**
 * Resolves `creditNotes` down to the ones that actually correct `invoiceId` and count — pure,
 * DB-free, so every rule below is directly testable with plain fixtures:
 *  - a credit note pointing at a DIFFERENT invoice (or none at all) is simply not this invoice's —
 *    skipped, no warning (it belongs to someone else's settlement).
 *  - a DRAFT is a document the user has not finished — see credit-note.descriptor.ts's own lifecycle
 *    comment, carried over verbatim from the removed `invoices/settlement.ts`'s identical rule: it
 *    settles nothing, silently (an unfinished draft is normal, not a data problem).
 *  - a credit note whose OWN `currency` field differs from the invoice's is still COUNTED, at the
 *    exact same `computeCreditedAmountMinor` result every OTHER credit note gets (this file's own
 *    header on `CreditsForDocument.warnings` explains why: that number is always, unavoidably, the
 *    invoice's own currency already) — the mismatch is still NAMED in `warnings`, informationally,
 *    never silently hidden, but it no longer excludes the credit.
 *  - otherwise (matching currency), identical, unchanged behavior.
 */
export function creditsForInvoiceFromNotes(
  creditNotes: readonly DocumentInstanceResult[],
  invoiceId: string,
  invoiceDescriptor: DocumentTypeDescriptor,
  invoiceData: Record<string, unknown>,
): CreditsForDocument {
  const invoiceCurrency = typeof invoiceData.currency === 'string' ? invoiceData.currency : undefined;

  const credits: DocumentCreditResult[] = [];
  const warnings: string[] = [];

  for (const note of creditNotes) {
    const noteData = (note.data ?? {}) as Record<string, unknown>;
    if (noteData.invoice !== invoiceId) continue;
    if (note.status !== 'sent') continue;

    const label = note.displayNumber ?? note.id;
    const noteCurrency = typeof noteData.currency === 'string' ? noteData.currency : undefined;
    if (!noteCurrency || noteCurrency !== invoiceCurrency) {
      warnings.push(
        `Credit note "${label}" declares its own currency as ${noteCurrency ?? 'unrecorded'}, ` +
          `different from invoice's own ${invoiceCurrency ?? 'unrecorded currency'} — the credited ` +
          `amount is always computed from, and expressed in, the invoice's own currency; counted as ` +
          `${invoiceCurrency ?? 'unrecorded currency'}, never converted (there is nothing to convert).`,
      );
    }

    const correctedLines = Array.isArray(noteData.correctedLines)
      ? (noteData.correctedLines as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : [];
    const amountMinor = computeCreditedAmountMinor(invoiceDescriptor, invoiceData, correctedLines);

    credits.push({
      id: note.id,
      displayNumber: note.displayNumber ?? null,
      amountMinor,
      // ALWAYS the invoice's own currency — see this file's own header: the amount is computed FROM
      // the invoice's own priced lines, never the note's, so labeling it with `noteCurrency` when the
      // two differ would misrepresent what the number actually means (frontend's
      // document-settlement.tsx formats this value using this field). Falls back to `noteCurrency`,
      // then `''`, only for the data-anomaly case of an invoice with no recorded currency at all —
      // never reachable for a properly-saved invoice (`currency` is a required field).
      currency: invoiceCurrency ?? noteCurrency ?? '',
    });
  }

  return { credits, warnings };
}

/**
 * The one entry point `documents.service.ts`'s `getSettlement` and `invoice-actions.ts`'s
 * "record-payment" both call — see this file's header for why "invoice" is, today, hardcoded as the
 * only correctable type: every OTHER document type simply has no credits, ever, the same way
 * `sumPaidMinorByDocument`'s own map (settlement/payments.ts) treats "not present" as "nothing
 * recorded" rather than every caller having to special-case each type by hand.
 */
export async function resolveCreditsForDocument(
  companyId: string,
  typeId: string,
  documentId: string,
  descriptor: DocumentTypeDescriptor,
  data: Record<string, unknown>,
): Promise<CreditsForDocument> {
  if (typeId !== 'invoice') return { credits: [], warnings: [] };
  const creditNotes = await listCreditNotes(companyId);
  return creditsForInvoiceFromNotes(creditNotes, documentId, descriptor, data);
}

/** `DocumentCreditResult[]` -> what `computeSettlement` actually needs — the exact same shape a
 *  `DocumentPayment[]` already gets narrowed to inline at every one of its own call sites, pulled
 *  out here since `credits` has two independent callers (documents.service.ts, invoice-actions.ts)
 *  that would otherwise each write this `.map` by hand. */
export function toSettlementCreditInputs(credits: readonly DocumentCreditResult[]): SettlementCreditInput[] {
  return credits.map((credit) => ({ id: credit.id, amountMinor: credit.amountMinor }));
}

/**
 * Every "credit-note" instance for the company — exported so a caller that needs credits for MANY
 * documents at once (contributions/invoice-contributions.ts's "pending invoices" dashboard widget)
 * can fetch ONCE and resolve each invoice's own credits against the same in-memory list, the same
 * "one query, many callers" shape `sumPaidMinorByDocument` already gives payments. `resolveCreditsForDocument`
 * above stays the one-document convenience built on top of this, for callers (documents.service.ts,
 * invoice-actions.ts) that only ever need a single document's credits.
 */
export { listCreditNotes };
