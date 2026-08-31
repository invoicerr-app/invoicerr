import { decimalsFor, fromMinor } from '@/utils/financial';

/**
 * What is still owed on a document, once PAYMENTS and CREDITS are counted — nothing else (item 8 of
 * the root TODO, "le lettrage" — a credit note reconciled against the document it corrects).
 *
 * A credit note is NOT a payment, and this module deliberately does not pretend otherwise: it is a
 * document that WITHDRAWS from the claim, not cash that arrived, and a settlement that filed one as
 * the other would one day report revenue it never received. This is why `payments` and `credits`
 * stay TWO separate parameters, and `paidMinor`/`creditedMinor` two separate fields all the way out
 * to the frontend (document-settlement.tsx renders them as two separate blocks) — never merged into
 * one "amount settled" number, even though both reduce the exact same `outstandingMinor`. This is
 * carried over verbatim from the pre-refonte `invoices/settlement.ts` (`settlementOf`, git tag
 * `avant-refonte-documents`), whose own header made the identical point: "a payment is cash that
 * arrived, a credit is an amount withdrawn from the claim. A product that files a credit as a
 * payment will one day report revenue it never received."
 *
 * `credits` was, until this task, a documented gap in this function's own signature ("deliberately
 * narrow ... so that future work can extend it ... without this function having silently pretended
 * to support it all along") — resolving WHICH credit notes count, and what their amount even means
 * for a type whose own descriptor has no line items of its own, is now `settlement/credits.ts`'s
 * job; this file stays pure arithmetic and knows nothing about "credit-note" as a document type.
 *
 * Everything here is in MINOR units, same discipline as totals/compute-totals.ts, for the same
 * reason: floats do not add up to zero.
 */

/** The one fact `computeSettlement` needs about each payment — its amount. Deliberately narrower
 *  than the full `DocumentPayment` row (method/note/paidAt play no part in the arithmetic). */
export interface SettlementPaymentInput {
  amountMinor: number;
}

/** The one fact `computeSettlement` needs about each CREDIT — see this file's header on why a
 *  credit note is never treated as a payment. `id` plays no part in the arithmetic either (like
 *  `SettlementPaymentInput`'s own shape), but is carried through so a caller building the full
 *  `DocumentSettlementView` (documents.service.ts) can zip an amount back to which credit note it
 *  came from without a second lookup — the same reason the pre-refonte `SettlementCredit` carried
 *  one. Always POSITIVE minor units — the sign a stored document happens to carry (credit notes were
 *  stored with negative totals for years, per that same removed module's own comment) is settled
 *  once, by whoever resolves `amountMinor` (settlement/credits.ts), never re-litigated here. */
export interface SettlementCreditInput {
  id: string;
  amountMinor: number;
}

export interface DocumentSettlement {
  totalGrossMinor: number;
  paidMinor: number;
  /** The sum of every CREDIT counted (see `SettlementCreditInput`) — kept apart from `paidMinor`,
   *  never added into it (this file's own header). Zero when nothing has been credited, or the
   *  document type has no notion of credits at all (settlement/credits.ts's own `resolveCreditsForDocument`
   *  returns none for anything but an invoice today). */
  creditedMinor: number;
  /** What remains, never below zero — a document fully paid AND/OR fully credited owes nothing, it
   *  does not owe less than nothing. See `excessMinor` for where the excess itself is surfaced
   *  instead of discarded. */
  outstandingMinor: number;
  /**
   * The excess, when payments AND credits TOGETHER exceed the total — kept VISIBLE rather than
   * folded into a negative `outstandingMinor` (which this function refuses to produce at all): a
   * business decides what to do with an excess (refund it, apply it forward), and it cannot decide
   * on a fact the system quietly threw away.
   *
   * ONE field, not a `overpaidMinor`/`overcreditedMinor` pair: an excess is exactly as real and
   * exactly as actionable regardless of whether it came from an extra payment, an over-generous
   * credit, or a mix of both — and the three OTHER fields on this same type (`paidMinor`,
   * `creditedMinor`, `outstandingMinor`) already let a reader reconstruct exactly how the balance
   * got here. Splitting the excess too would be precision with no decision it actually helps make.
   *
   * Renamed from the earlier `overpaidMinor` (this field's only previous name, before `credits`
   * existed): keeping that name would have MISNAMED the exact case this task exists to get right — a
   * fully over-CREDITED document with zero payments is not "overpaid".
   */
  excessMinor: number;
  /** `paidMinor + creditedMinor >= totalGrossMinor` — a document settled entirely by payment,
   *  entirely by credit, or any mix of the two, is settled all the same; it does not stay "owed" a
   *  negative amount. */
  settled: boolean;
}

/**
 * Pure arithmetic: no Prisma, no currency conversion (a payment in a currency other than the
 * document's own is refused before it ever reaches here — see actions/invoice-actions.ts's
 * "record-payment" handler; a credit note in a foreign currency is IGNORED before it ever reaches
 * here — see settlement/credits.ts), no rounding rule invented on top of what `payments`/`credits`
 * already carry in minor units.
 */
export function computeSettlement(
  totalGrossMinor: number,
  payments: readonly SettlementPaymentInput[],
  credits: readonly SettlementCreditInput[] = [],
): DocumentSettlement {
  const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const creditedMinor = credits.reduce((sum, credit) => sum + credit.amountMinor, 0);
  const remainder = totalGrossMinor - paidMinor - creditedMinor;

  return {
    totalGrossMinor,
    paidMinor,
    creditedMinor,
    outstandingMinor: Math.max(0, remainder),
    excessMinor: Math.max(0, -remainder),
    settled: remainder <= 0,
  };
}

/**
 * A human-facing sentence stating the settlement's own numbers — what "record-payment" hands back as
 * its `ActionResult.message` (see actions/invoice-actions.ts): the task asks for a result that SAYS
 * the new balance, and `ActionResult` has no structured field for one beyond `message` (widening it
 * for this alone would touch every action/result consumer for a single caller's benefit). Plain
 * English, same convention as everything else this module hands the frontend verbatim
 * (DocumentTypeDescriptor.label, an action's own `message`) — not an i18n key.
 *
 * Still talks about "paid"/"fully paid" even now that `credits` can contribute to `settled` — this
 * is only ever called right after a PAYMENT was just recorded (invoice-actions.ts's "record-payment"
 * handler), so some amount genuinely was just paid; it is the derived BADGE (frontend's
 * `settlementBadgeInfo`), shown continuously regardless of which action last ran, that must never
 * say "Paid" for a document nothing was ever paid on — see document-settlement.tsx's own header.
 */
export function describeSettlement(settlement: DocumentSettlement, currency: string): string {
  const decimals = decimalsFor(currency);
  const format = (minor: number) => `${fromMinor(minor, currency).toFixed(decimals)} ${currency}`;

  if (settlement.settled) {
    return settlement.excessMinor > 0
      ? `Payment recorded. Invoice fully paid — ${format(settlement.excessMinor)} overpaid.`
      : `Payment recorded. Invoice fully paid (${format(settlement.paidMinor)}).`;
  }

  return (
    `Payment recorded. ${format(settlement.paidMinor)} paid so far, ` +
    `${format(settlement.outstandingMinor)} still outstanding.`
  );
}
