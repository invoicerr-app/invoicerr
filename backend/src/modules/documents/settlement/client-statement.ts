import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { listDocuments } from '../persistence';
import { computeDocumentTotals } from '../totals/compute-totals';
import { computeSettlement } from './compute-settlement';
import { creditsForInvoiceFromNotes, listCreditNotes, toSettlementCreditInputs } from './credits';
import { sumPaidMinorByDocument } from './payments';

/**
 * TODO_FEATURES.md rank 6 ("relevé de compte client") — a PER-CLIENT aggregation of facts that
 * already exist: which of the client's invoices are open/settled, which credit notes correct them,
 * the total still owed, and an AGED BALANCE (how overdue each still-open franc/euro/dollar is).
 *
 * Exactly like invoice-contributions.ts's own header states for the dashboard: everything here is
 * ARITHMETIC (reusing `computeDocumentTotals`/`computeSettlement`/`creditsForInvoiceFromNotes`
 * verbatim, never reimplementing what they already give) — never a fiscal rule, never a new "who owes
 * what" engine. This file only decides WHICH documents belong to one client's statement and HOW OLD
 * an unpaid balance is, nothing about VAT, currency conversion, or numbering.
 *
 * `resolveClientStatement` is called by `ClientsService.getStatement` (clients.service.ts) — a
 * companyId-scoped read, same as everything else that module exposes; this file itself never touches
 * `Client` at all (it only ever needs the id to filter invoices by their own `client` field), so a
 * caller mistakenly passing another company's clientId simply gets an EMPTY statement (no invoice of
 * THIS company ever has that id as its `client`), never another tenant's data — see this file's own
 * `client-statement.spec.ts` for the isolation proof.
 */

/** Same explicit, honest read cap as every other contribution/settlement read in this module (e.g.
 *  invoice-contributions.ts's own `CONTRIBUTION_READ_LIMIT`, credits.ts's `CREDIT_NOTE_READ_LIMIT`)
 *  — a statement is an honest "most recently touched N invoices" view, not an unbounded table scan. */
const CLIENT_STATEMENT_READ_LIMIT = 500;

/** The invoice's own base descriptor — see invoice-contributions.ts's identical constant for why a
 *  direct import is fine here: this file only ever computes totals for "invoice" instances. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export type AgingBucketKey = 'current' | '0-30' | '31-60' | '60+';

/**
 * One "billable" document on the statement — an invoice, or a credit note correcting one of the
 * client's invoices. Deliberately the SAME shape for both (never a union of two incompatible row
 * types) so the frontend renders one list, one `<tr>` component, for both — the fields below are
 * exactly what differs between the two kinds, and why.
 */
export interface ClientStatementDocumentRow {
  id: string;
  typeId: 'invoice' | 'credit-note';
  displayNumber: string | null;
  status: string;
  issueDate: string | null;
  /** Null for a credit note — credit-note.descriptor.ts declares no due-date field of its own (only
   *  `issueDate`); an invoice's own `dueDate` (required on that descriptor) is the only date this
   *  statement ever ages a balance against — see `resolveAgingBucket` below. */
  dueDate: string | null;
  currency: string;
  /** The document's own gross amount — an invoice's `totals.grossMinor` (compute-totals.ts), or a
   *  credit note's own CREDITED amount (settlement/credits.ts's `computeCreditedAmountMinor`, reached
   *  here through `creditsForInvoiceFromNotes`) — ALWAYS positive. A credit note is a reduction of
   *  its invoice's claim, not a negative claim of its own — see compute-settlement.ts's own header on
   *  why a credit is never given a sign flip anywhere in this module. */
  amountMinor: number;
  /** What has been paid against THIS document directly (compute-settlement.ts's own `paidMinor`) —
   *  ALWAYS 0 for a credit note: nothing in this codebase ever records a `DocumentPayment` against
   *  one (see settlement/payments.ts — a payment always targets the INVOICE); a credit note only
   *  reduces what the invoice it corrects still owes, which already shows up on THAT invoice's own
   *  `outstandingMinor` below, via `creditsForInvoiceFromNotes`. */
  paidMinor: number;
  /** What this document itself still leaves owed — an invoice's `compute-settlement.ts` own
   *  `outstandingMinor` (payments AND credits already netted in, never recomputed here); ALWAYS 0 for
   *  a credit note (see `paidMinor`'s own comment: a SENT credit note is fully applied to its invoice
   *  the instant it exists — it carries no unsettled balance of its own to age). */
  outstandingMinor: number;
  /** `compute-settlement.ts`'s own `settled` for an invoice; always `true` for a credit note (see
   *  `outstandingMinor`'s own comment — nothing about a sent credit note is ever "still owed"). */
  settled: boolean;
}

/** One currency's own aged balance — see `resolveAgingBucket` for the exact boundaries. NEVER
 *  summed across currencies (same discipline as invoice-contributions.ts's own pending-total
 *  widgets, and country-policy's "never a permissive fallback"): a client billed in two currencies
 *  gets two of these, one bucket set each, rather than one meaningless mixed number. */
export interface ClientStatementCurrencyTotals {
  currency: string;
  /** The sum of every counted invoice's own `outstandingMinor` in this currency — exactly the sum of
   *  the four aging buckets below (every outstanding minor unit lands in exactly one bucket). */
  totalOutstandingMinor: number;
  /** Not yet due (`dueDate` is after the as-of date) — includes a fully SETTLED invoice too, which
   *  trivially contributes 0 regardless of which bucket its own due date would otherwise land it in. */
  currentMinor: number;
  /** Due on the as-of date, or up to 30 days overdue (inclusive). */
  days0to30Minor: number;
  /** 31 to 60 days overdue (inclusive). */
  days31to60Minor: number;
  /** More than 60 days overdue. */
  days60PlusMinor: number;
}

export interface ClientStatement {
  clientId: string;
  documents: ClientStatementDocumentRow[];
  /** One entry per currency among the client's own counted ("sent") invoices, sorted by currency
   *  code — even a currency with nothing currently outstanding still gets a zero-valued entry, so the
   *  frontend never has to guess which currencies exist from the document list itself. Empty when the
   *  client has no "sent" invoice at all. */
  totals: ClientStatementCurrencyTotals[];
}

function zeroTotals(currency: string): ClientStatementCurrencyTotals {
  return {
    currency,
    totalOutstandingMinor: 0,
    currentMinor: 0,
    days0to30Minor: 0,
    days31to60Minor: 0,
    days60PlusMinor: 0,
  };
}

/**
 * WHICH of the four buckets an amount due on `dueDate` falls into, `asOf` a given date — pure and
 * date-arithmetic only, no Prisma, so every boundary is directly provable with plain fixtures (see
 * this file's own spec). UTC day boundaries throughout, same discipline invoice-contributions.ts's own
 * `monthKey` documents (the stored date-only strings ARE UTC midnights; mixing local getters with a
 * UTC-keyed "as of" date makes a document due "today" fall in the wrong bucket near a day boundary).
 *
 * Exact boundaries (days overdue = `asOf` minus `dueDate`, in whole UTC days):
 *  - missing/unparseable `dueDate` -> 'current' (cannot judge overdue without one; an honest default,
 *    never a guess — this should not happen for an invoice, whose own `dueDate` field is required,
 *    but a data anomaly degrades rather than crashes, same rule this whole module holds throughout)
 *  - daysOverdue <  0  -> 'current'   (the due date is still in the future — "pas encore dû")
 *  - daysOverdue <= 30 -> '0-30'      (due today, or up to 30 days late)
 *  - daysOverdue <= 60 -> '31-60'     (31 to 60 days late)
 *  - otherwise         -> '60+'       (more than 60 days late)
 */
export function resolveAgingBucket(dueDate: string | null | undefined, asOf: Date): AgingBucketKey {
  if (!dueDate) return 'current';
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 'current';

  const dueUtcMs = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const asOfUtcMs = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const daysOverdue = Math.floor((asOfUtcMs - dueUtcMs) / 86_400_000);

  if (daysOverdue < 0) return 'current';
  if (daysOverdue <= 30) return '0-30';
  if (daysOverdue <= 60) return '31-60';
  return '60+';
}

/** Adds `outstandingMinor` to `totals`'s own running sum AND the one bucket `resolveAgingBucket`
 *  resolves it to — mutates in place (a private accumulator, never shared past this file). */
function addToAging(
  totals: ClientStatementCurrencyTotals,
  dueDate: string | null,
  outstandingMinor: number,
  asOf: Date,
): void {
  totals.totalOutstandingMinor += outstandingMinor;
  const bucket = resolveAgingBucket(dueDate, asOf);
  if (bucket === 'current') totals.currentMinor += outstandingMinor;
  else if (bucket === '0-30') totals.days0to30Minor += outstandingMinor;
  else if (bucket === '31-60') totals.days31to60Minor += outstandingMinor;
  else totals.days60PlusMinor += outstandingMinor;
}

/**
 * One client's full statement — every "sent" invoice whose own `client` field names `clientId`, plus
 * every "sent" credit note correcting one of them, each with the balance `compute-settlement.ts`
 * already knows how to compute, and the resulting aged totals.
 *
 * "sent" only, for BOTH document kinds — the exact same rule invoice-contributions.ts's own "pending"
 * widget already applies to invoices (`status === 'sent'`, a strict equality: never "draft", never
 * "sending"/"send_failed" — not yet actually issued — and never "cancelled" — TODO_CORRECTION.md C3,
 * "nothing is owed on a document that no longer legally exists"), and the one `credits.ts`'s own
 * `creditsForInvoiceFromNotes` already applies to credit notes. A statement that listed a draft would
 * show an obligation that was never actually issued; this task invents no exception to that rule.
 *
 * `asOf` defaults to "now" but is an explicit parameter (same shape as invoice-contributions.ts's own
 * `recentMonths(now)`) so a test can pin the clock instead of racing the real one.
 */
export async function resolveClientStatement(
  companyId: string,
  clientId: string,
  asOf: Date = new Date(),
): Promise<ClientStatement> {
  const allInvoices = await listDocuments(companyId, 'invoice', CLIENT_STATEMENT_READ_LIMIT);
  const invoices = allInvoices.filter((invoice) => {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    return invoice.status === 'sent' && data.client === clientId;
  });

  const paidByDocument = await sumPaidMinorByDocument(
    companyId,
    invoices.map((invoice) => invoice.id),
  );
  // Company-wide, ONE query — the same "one query, many callers" shape sumPaidMinorByDocument itself
  // already gives payments, and invoice-contributions.ts's own dashboard widget already gives credit
  // notes: cheaper than one `listCreditNotes` per invoice on this client's statement.
  const creditNotes = await listCreditNotes(companyId);

  const documents: ClientStatementDocumentRow[] = [];
  const totalsByCurrency = new Map<string, ClientStatementCurrencyTotals>();

  for (const invoice of invoices) {
    const data = (invoice.data ?? {}) as Record<string, unknown>;
    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, data);
    const paidMinor = paidByDocument.get(invoice.id) ?? 0;
    const { credits } = creditsForInvoiceFromNotes(creditNotes, invoice.id, INVOICE_DESCRIPTOR, data);
    const settlement = computeSettlement(
      totals.grossMinor,
      [{ amountMinor: paidMinor }],
      toSettlementCreditInputs(credits),
    );

    const currency = typeof data.currency === 'string' ? data.currency : '';
    const dueDate = typeof data.dueDate === 'string' ? data.dueDate : null;
    const issueDate = typeof data.issueDate === 'string' ? data.issueDate : null;

    documents.push({
      id: invoice.id,
      typeId: 'invoice',
      displayNumber: invoice.displayNumber ?? null,
      status: invoice.status,
      issueDate,
      dueDate,
      currency,
      amountMinor: totals.grossMinor,
      paidMinor: settlement.paidMinor,
      outstandingMinor: settlement.outstandingMinor,
      settled: settlement.settled,
    });

    for (const credit of credits) {
      const note = creditNotes.find((candidate) => candidate.id === credit.id);
      const noteData = (note?.data ?? {}) as Record<string, unknown>;
      documents.push({
        id: credit.id,
        typeId: 'credit-note',
        displayNumber: credit.displayNumber,
        status: note?.status ?? 'sent',
        issueDate: typeof noteData.issueDate === 'string' ? noteData.issueDate : null,
        dueDate: null,
        currency: credit.currency,
        amountMinor: credit.amountMinor,
        paidMinor: 0,
        outstandingMinor: 0,
        settled: true,
      });
    }

    if (!totalsByCurrency.has(currency)) totalsByCurrency.set(currency, zeroTotals(currency));
    addToAging(totalsByCurrency.get(currency)!, dueDate, settlement.outstandingMinor, asOf);
  }

  const totalsList = [...totalsByCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));

  return { clientId, documents, totals: totalsList };
}
