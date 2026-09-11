/**
 * The GENERIC accounting CSV export, "L" part explicitly out of scope: this
 * file is only the ledger's syntax (RFC 4180 CSV), never a country-specific column mapping (FR's FEC,
 * DE's DATEV). A future extension registers a per-country FORMATTER reading the exact same
 * `AccountingLedgerRow[]` accounting-export.service.ts already resolves — the same "one read, several
 * renderers" shape `formats/format-registry.ts` already holds for XML syntaxes — rather than this file
 * growing a branch per country.
 *
 * PURE: no I/O, no Prisma, no currency math. Every field arrives here ALREADY a plain string — amounts
 * already rendered in MAJOR units by the caller (`@/utils/financial`'s `fromMinor`/`decimalsFor`),
 * dates already ISO `YYYY-MM-DD` — so this file is directly unit-testable with plain fixtures, the
 * same "pure builder, impure caller" split `totals/compute-totals.ts` and
 * `settlement/compute-settlement.ts` already hold.
 */

export type AccountingLedgerRowType = 'invoice' | 'credit-note' | 'payment';

/**
 * ONE unified schema for all three row kinds — never a union of three incompatible row shapes, the
 * same "one shape, blank fields for what doesn't apply" discipline
 * `settlement/client-statement.ts`'s own `ClientStatementDocumentRow` already holds for invoice vs.
 * credit-note rows. Which fields a given `type` fills:
 *  - "invoice" / "credit-note": `net`/`vat`/`gross` (an invoice's own `computeDocumentTotals`, or a
 *    credit note's own credited GROSS — see accounting-export.service.ts's own header on why a credit
 *    note has no net/vat breakdown of its own) and `status` ("settled"/"outstanding", the invoice's
 *    own `computeSettlement().settled` — always "settled" for a credit note, see that file's header);
 *    `paid`/`method` stay blank — no single CASH EVENT belongs to a document row.
 *  - "payment": `paid`/`method`/`date` (`paidAt`) — the ONE cash event this row records; `net`/`vat`/
 *    `gross`/`status` stay blank — a payment has no VAT breakdown, and (per
 *    `settlement/compute-settlement.ts`'s own header) no settlement state of its own, being "a single
 *    complete act".
 */
export interface AccountingLedgerRow {
  type: AccountingLedgerRowType;
  /** The document's own `displayNumber` (or a payment's own invoice's), falling back to the raw id
   *  when unnumbered — never blank, so every row can always be cross-referenced by hand. */
  reference: string;
  /** ISO `YYYY-MM-DD` — a document's own `issueDate` for "invoice"/"credit-note", the payment's own
   *  `paidAt` for "payment". */
  date: string;
  client: string;
  currency: string;
  net: string;
  vat: string;
  gross: string;
  paid: string;
  method: string;
  status: string;
}

/** Stable column order — never reordered once shipped: a downstream accounting import keyed by column
 *  POSITION (most spreadsheet macros are) would silently break on a header shuffle. */
const COLUMNS: ReadonlyArray<keyof AccountingLedgerRow> = [
  'type',
  'reference',
  'date',
  'client',
  'currency',
  'net',
  'vat',
  'gross',
  'paid',
  'method',
  'status',
];

/** RFC 4180 §2.6/2.7: a field containing the delimiter, a double quote, or a line break is wrapped in
 *  double quotes, with any interior double quote doubled. A field with none of those characters is
 *  left bare — this is what keeps the common case (a plain reference number, an ISO date) readable
 *  without quotes cluttering every line. */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toLine(values: readonly string[]): string {
  return values.map(escapeField).join(',');
}

/**
 * Builds the full CSV text, header row first — a period with no ledger rows at all still produces a
 * valid, header-only CSV (an accountant importing an empty period should see "nothing happened", not
 * a missing or corrupt file). Lines are joined with `\n`, matching this codebase's own client-side CSV
 * convention (`hooks/use-table-export.ts`) rather than RFC 4180's own CRLF — every spreadsheet tool
 * that matters (Excel, Numbers, Google Sheets) parses either, and one convention across the codebase
 * beats strict adherence to a detail the format itself treats as optional.
 */
export function buildAccountingCsv(rows: readonly AccountingLedgerRow[]): string {
  const lines = [toLine(COLUMNS), ...rows.map((row) => toLine(COLUMNS.map((column) => row[column])))];
  return lines.join('\n');
}
