/**
 * BT-3 — the document type code, from the kind of document.
 *
 * UNTDID 1001, restricted to what EN 16931 admits. This mapping is UNIVERSAL: no country decides
 * that a credit note is a credit note. It belongs here rather than in a profile for the same reason
 * `documentKindsFor` reads the routes — the country says WHICH documents exist, the standard says
 * how each one is coded.
 *
 * ── The UBL trap, which is not a detail ──────────────────────────────────────────────────────────
 * The two syntaxes disagree on where a credit note lives, and the repo's own Schematron says so:
 *
 *   UBL  `cbc:InvoiceTypeCode`     admits 380 382 383 384 385 386 387 388 389 … and NOT 381
 *        `cbc:CreditNoteTypeCode`  admits 81 83 261 262 296 308 381 396 420 458 502 503 532
 *   CII  a single `TypeCode` list  admits 380 AND 381 (and 383, 384, 386, 389)
 *
 * So in UBL a credit note is a DIFFERENT ROOT ELEMENT (`ubl:CreditNote`), not an invoice wearing
 * another code — while in CII it is the same document with 381.
 *
 * MEASURED, not assumed: `@fin.cx/einvoice` already switches the root on the code. Feeding it 381
 * yields `<CreditNote>` in UBL and `<CrossIndustryInvoice>` with TypeCode 381 in CII, and every other
 * code stays on `<Invoice>`. So this mapping is safe in both syntaxes and needs no caller-side guard
 * — `document-type-code.spec.ts` asserts the roots as well as the codes, because that behaviour is
 * the library's and could change under us.
 */

/** UNTDID 1001 codes this product emits. */
export const DOCUMENT_TYPE_CODE = {
  INVOICE: '380',
  CREDIT_NOTE: '381', // CII only — see the note above
  DEBIT_NOTE: '383',
  CORRECTIVE_INVOICE: '384', // "corrected invoice"
  DEPOSIT: '386', // "prepayment invoice"
  PREPAYMENT: '386',
  FINAL: '380', // the balancing invoice is still an invoice
  SELF_BILLED: '389', // "self-billed invoice"
} as const;

const DEFAULT_CODE = DOCUMENT_TYPE_CODE.INVOICE;

/**
 * BT-3 for a document kind. Unknown or absent kinds fall back to `380` — the behaviour every caller
 * had before this existed, so adding the field changed nothing for paths that do not set it.
 */
export function documentTypeCode(kind?: string | null): string {
  if (!kind) return DEFAULT_CODE;
  return (DOCUMENT_TYPE_CODE as Record<string, string>)[kind] ?? DEFAULT_CODE;
}
