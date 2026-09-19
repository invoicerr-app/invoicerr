import { BadRequestException } from '@nestjs/common';

import { decimalsFor, fromMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../actions/action-registry';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { findOwnedDocumentsByIds, listDocuments } from '../persistence';
import { DocumentSettlement, computeSettlement } from '../settlement/compute-settlement';
import {
  DocumentCreditResult,
  creditsForInvoiceFromNotes,
  listCreditNotes,
  toSettlementCreditInputs,
} from '../settlement/credits';
import { listPaymentsInRange, sumPaidMinorByDocument } from '../settlement/payments';
import { DocumentTotals, computeDocumentTotals } from '../totals/compute-totals';
import { AccountingLedgerRow, buildAccountingCsv } from './build-accounting-csv';
import { resolveClientLabels } from './client-labels';

/**
 * The GENERIC accounting CSV export (the CSV slice ONLY: a country-specific
 * ledger FORMAT — FR's FEC, DE's DATEV, the "L" part — needs a chart-of-accounts mapping
 * not built here; a future extension registers a formatter over the exact same rows this
 * file already resolves, never a rewrite of the resolution below).
 *
 * Same "gather + compute, never recompute a balance" discipline `settlement/client-statement.ts`
 * already established (this file's own header is the model this one copies): every amount comes from
 * `computeDocumentTotals`/`computeSettlement`, reused verbatim — this file only decides WHICH
 * documents/payments belong to the requested period and how to shape them into one
 * `AccountingLedgerRow` per real, issued fact. A self-contained function, not a class: nothing here
 * needs an injected provider (no DI at all — `accounting-export.module.ts` wires the controller alone),
 * the same "plain function module over the `prisma` singleton" shape `client-statement.ts` itself is.
 *
 * A `type`/`status` note on WHY the settlement's own `settled` boolean ends up on the "status" column
 * rather than a numeric "paid"/"outstanding" pair: this ledger's own "paid" NUMERIC column is reserved
 * for an actual cash event — a `DocumentPayment` row, one ledger line per payment, referencing the
 * invoice it settles by `reference` (see the "payment" row-building loop below). An accountant
 * reconciling this export computes an invoice's outstanding balance the same way a real ledger always
 * has: gross minus every payment row matching the same reference — never a second, pre-summed "amount
 * paid so far" column that could drift from the rows that actually justify it. `computeSettlement` is
 * still called for every invoice (never skipped) precisely so its own `settled` boolean — payments AND
 * credits already netted in, per that file's own header — is what the "status" column reports, rather
 * than this file re-deriving "is this paid off" by hand.
 */

/** Same explicit, honest read cap as every other settlement read in this module (e.g.
 *  `client-statement.ts`'s own `CLIENT_STATEMENT_READ_LIMIT`) — an export is an honest "most recently
 *  touched N invoices" view, not an unbounded table scan. A credit note or payment can still reference
 *  an invoice beyond this cap; see `findOwnedDocumentsByIds` below for why payment rows resolve their
 *  own invoice through an UNCAPPED, exact-id lookup instead of this list. */
const ACCOUNTING_EXPORT_READ_LIMIT = 500;

/** The invoice's own base descriptor — see `client-statement.ts`'s identical constant for why a direct
 *  import is fine here: this file only ever computes totals for "invoice" instances. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/** `YYYY-MM-DD`, nothing looser — this endpoint's own `from`/`to` query params name a CALENDAR DAY,
 *  never an instant; the controller's `Content-Disposition` filename reuses the same raw string. */
const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parses+validates one `from`/`to` query param — a 400 naming which one and why, never a silent
 *  fallback (this module's own "never guess" discipline, same posture `resolveAgingBucket` holds for
 *  a document's own malformed date, just surfaced as a client error here instead of a silent
 *  degrade — the CALLER chose this date, so a mistake is worth telling them about). */
function parseDateParam(name: string, value: string | undefined): string {
  if (!value || !DATE_PARAM_PATTERN.test(value)) {
    throw new BadRequestException(`"${name}" must be a date in YYYY-MM-DD format.`);
  }
  if (Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
    throw new BadRequestException(`"${name}" is not a valid calendar date.`);
  }
  return value;
}

/** `"YYYY-MM-DD"` -> the UTC midnight of that day, in milliseconds — UTC DAY boundaries throughout,
 *  the identical discipline `client-statement.ts`'s own `resolveAgingBucket` already holds, so a
 *  document issued exactly "on" a boundary date behaves the same way here as it does there. */
function dayMs(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whether a document's own `issueDate` (a JSON field — never an indexed column, see `persistence.ts`'s
 *  own header on why this is filtered in memory rather than in SQL) falls within `[fromMs, toMs]`,
 *  inclusive, compared at UTC day boundaries. Missing/unparseable -> excluded: a document with no
 *  readable issue date cannot honestly be placed in ANY period — an honest default, never a guess. */
function issueDateInRange(issueDate: unknown, fromMs: number, toMs: number): boolean {
  if (typeof issueDate !== 'string') return false;
  const parsed = new Date(issueDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const ms = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  return ms >= fromMs && ms <= toMs;
}

/** The first 10 characters of an ISO date(-time) string, or `''` for anything else — every date this
 *  export ever renders (an `issueDate` JSON field, or a `paidAt` Date column's own `toISOString()`)
 *  is normalized through this one function, so the CSV's own `date` column is always plain
 *  `YYYY-MM-DD`, never a full timestamp. */
function isoDatePart(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return '';
}

/** Renders a minor-unit amount in MAJOR units, fixed to the currency's own decimal count — the ONE
 *  place this file ever touches `@/utils/financial`, so every amount column goes through the exact
 *  same rounding/decimals rule `describeSettlement` (`compute-settlement.ts`) already uses. */
function formatMinor(minor: number, currency: string): string {
  return fromMinor(minor, currency).toFixed(decimalsFor(currency));
}

/**
 * One "sent" invoice, resolved ONCE — its own totals, settlement (payments AND credits already netted
 * in), the credit notes that correct it, and its own client id. Resolved for EVERY sent invoice this
 * company has (up to the read cap), regardless of whether the INVOICE ITSELF falls in the requested
 * period: a credit note issued DURING the period can correct an invoice issued BEFORE it, and credit
 * notes are filtered by their OWN `issueDate` below, never their invoice's.
 */
interface ResolvedInvoice {
  invoice: DocumentInstanceResult;
  data: Record<string, unknown>;
  totals: DocumentTotals;
  settlement: DocumentSettlement;
  credits: DocumentCreditResult[];
  clientId: string | null;
}

/**
 * The full ledger for `[fromParam, toParam]` (both inclusive, `YYYY-MM-DD`), as a ready-to-download
 * CSV string. See this file's own header for the row-shaping rules; see `build-accounting-csv.ts` for
 * the (pure) CSV syntax itself.
 */
export async function buildAccountingExport(
  companyId: string,
  fromParam: string,
  toParam: string,
): Promise<string> {
  const from = parseDateParam('from', fromParam);
  const to = parseDateParam('to', toParam);
  const fromMs = dayMs(from);
  const toMs = dayMs(to);
  if (fromMs > toMs) {
    throw new BadRequestException('"from" must not be after "to".');
  }

  // === Resolve EVERY "sent" invoice's totals/settlement/credits/client — see this file's own header,
  //     `ResolvedInvoice`, on why this runs regardless of the invoice's own date. "sent" only, never
  //     "draft" (not yet actually issued) or "cancelled" (nothing is owed on
  //     a document that no longer legally exists) — the exact filter `client-statement.ts` already
  //     applies for the identical reason. ===
  const allInvoices = await listDocuments(companyId, 'invoice', ACCOUNTING_EXPORT_READ_LIMIT);
  const sentInvoices = allInvoices.filter((invoice) => invoice.status === 'sent');
  const creditNotes = await listCreditNotes(companyId);
  const paidByDocument = await sumPaidMinorByDocument(
    companyId,
    sentInvoices.map((invoice) => invoice.id),
  );

  const resolvedInvoices = new Map<string, ResolvedInvoice>();
  for (const invoice of sentInvoices) {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, data);
    const paidMinor = paidByDocument.get(invoice.id) ?? 0;
    const { credits } = creditsForInvoiceFromNotes(creditNotes, invoice.id, INVOICE_DESCRIPTOR, data);
    const settlement = computeSettlement(
      totals.grossMinor,
      [{ amountMinor: paidMinor }],
      toSettlementCreditInputs(credits),
    );
    resolvedInvoices.set(invoice.id, {
      invoice,
      data,
      totals,
      settlement,
      credits,
      clientId: typeof data.client === 'string' ? data.client : null,
    });
  }

  const rows: AccountingLedgerRow[] = [];

  // === Invoice rows: the INVOICE's own issueDate must fall in the period. ===
  for (const resolved of resolvedInvoices.values()) {
    if (!issueDateInRange(resolved.data.issueDate, fromMs, toMs)) continue;
    const currency = typeof resolved.data.currency === 'string' ? resolved.data.currency : '';
    rows.push({
      type: 'invoice',
      reference: resolved.invoice.displayNumber ?? resolved.invoice.id,
      date: isoDatePart(resolved.data.issueDate),
      client: resolved.clientId ?? '', // resolved to a real label below, once every id is known
      currency,
      net: formatMinor(resolved.totals.netMinor, currency),
      vat: formatMinor(resolved.totals.vatMinor, currency),
      gross: formatMinor(resolved.totals.grossMinor, currency),
      paid: '',
      method: '',
      status: resolved.settlement.settled ? 'settled' : 'outstanding',
    });
  }

  // === Credit-note rows: the CREDIT NOTE's own issueDate must fall in the period — independent of
  //     its invoice's own date (this file's own header, `ResolvedInvoice`). Status filtering is
  //     delegated entirely to `creditsForInvoiceFromNotes` above: a note that isn't "sent", or whose
  //     `data.invoice` doesn't match `resolved`'s own id, simply never appears in `resolved.credits`,
  //     so the `.find()` below silently skips it — the exact "skipped, no warning" rule
  //     `settlement/credits.ts`'s own header already holds for a credit pointing nowhere. ===
  for (const note of creditNotes) {
    const noteData = (note.data ?? {}) as Record<string, unknown>;
    if (!issueDateInRange(noteData.issueDate, fromMs, toMs)) continue;
    const invoiceId = typeof noteData.invoice === 'string' ? noteData.invoice : undefined;
    const resolved = invoiceId ? resolvedInvoices.get(invoiceId) : undefined;
    if (!resolved) continue;
    const credit = resolved.credits.find((candidate) => candidate.id === note.id);
    if (!credit) continue;

    rows.push({
      type: 'credit-note',
      reference: note.displayNumber ?? note.id,
      date: isoDatePart(noteData.issueDate),
      client: resolved.clientId ?? '',
      currency: credit.currency,
      // A credit note has no independent net/vat breakdown of its own — its credited amount is the
      // GROSS/TTC of the invoice lines it corrects (settlement/credits.ts's own
      // `computeCreditedAmountMinor` header explains why NET/VAT never appears here separately).
      net: '',
      vat: '',
      gross: formatMinor(credit.amountMinor, credit.currency),
      paid: '',
      method: '',
      // Always "settled" — a SENT credit note carries no independent balance of its own; see
      // `client-statement.ts`'s own `ClientStatementDocumentRow.settled` header for the identical rule.
      status: 'settled',
    });
  }

  // === Payment rows: `paidAt` is a real column — filtered in SQL (`listPaymentsInRange`), never in
  //     memory. Resolved through an UNCAPPED, exact-id lookup (`findOwnedDocumentsByIds`), never the
  //     `sentInvoices` list above: a payment's own `documentId` can reference an invoice beyond
  //     `ACCOUNTING_EXPORT_READ_LIMIT`, or (in principle — see `DocumentPayment.documentId`'s own
  //     schema comment) a document that isn't "sent" at all. ===
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  const payments = await listPaymentsInRange(companyId, fromDate, toDate);

  const paymentDocuments = await findOwnedDocumentsByIds(
    companyId,
    payments.map((payment) => payment.documentId),
  );
  const paymentDocumentsById = new Map(paymentDocuments.map((document) => [document.id, document]));

  for (const payment of payments) {
    const document = paymentDocumentsById.get(payment.documentId);
    const documentData = (document?.data ?? {}) as Record<string, unknown>;
    const documentClientId = typeof documentData.client === 'string' ? documentData.client : null;
    // `documentAmountMinor`, and the DOCUMENT's own currency — NEVER the raw `amountMinor`/
    // `payment.currency` (see `settlement/payments.ts`'s own `toSettlementPaymentInputs` header): this
    // is the EXACT figure `computeSettlement` already counted as "paid" for that document, so a
    // payment row and the invoice row it settles can always be reconciled by their shared `reference`.
    const documentCurrency =
      typeof documentData.currency === 'string' ? documentData.currency : payment.currency;
    rows.push({
      type: 'payment',
      reference: document?.displayNumber ?? document?.id ?? payment.documentId,
      date: isoDatePart(payment.paidAt),
      client: documentClientId ?? '',
      currency: documentCurrency,
      net: '',
      vat: '',
      gross: '',
      paid: formatMinor(payment.documentAmountMinor, documentCurrency),
      method: payment.method ?? '',
      // Blank, not "paid" — a payment is (per `compute-settlement.ts`'s own header) "a single complete
      // act", never a state that can itself be "settled" or "outstanding".
      status: '',
    });
  }

  // === Resolve every client id collected above to a real label, in ONE batched query — rows were
  //     built with the raw id in `client` as a placeholder specifically so this happens exactly once,
  //     after every row (invoice, credit-note, AND payment) has contributed its own id. ===
  const clientIds = rows.map((row) => row.client).filter((id): id is string => id !== '');
  const clientLabels = await resolveClientLabels(companyId, clientIds);
  for (const row of rows) {
    if (row.client) row.client = clientLabels.get(row.client) ?? row.client;
  }

  // Chronological order — an accountant reading this ledger scans it as a timeline, not grouped by
  // kind; ties (same date) keep the order they were pushed in above (invoices, then credit notes,
  // then payments) since `Array#sort` in this runtime is stable.
  rows.sort((a, b) => a.date.localeCompare(b.date));

  return buildAccountingCsv(rows);
}
