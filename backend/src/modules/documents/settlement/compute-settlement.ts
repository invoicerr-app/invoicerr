import { decimalsFor, fromMinor } from '@/utils/financial';

/**
 * What is still owed on a document, once PAYMENTS are counted — nothing else.
 *
 * A credit note is NOT a payment, and this module deliberately does not pretend otherwise: it is a
 * document that WITHDRAWS from the claim, not cash that arrived, and a settlement that filed one as
 * the other would one day report revenue it never received. Reconciling a document against the
 * credit notes issued against it (lettrage) is separate, future work — item 8 of the root TODO, not
 * this one. `computeSettlement`'s signature is deliberately narrow (a gross total, a list of
 * payments) rather than wide-and-half-implemented, so that future work can extend it — e.g. an
 * optional third argument for issued credits — without this function having silently pretended to
 * support it all along.
 *
 * Everything here is in MINOR units, same discipline as totals/compute-totals.ts, for the same
 * reason: floats do not add up to zero.
 */

/** The one fact `computeSettlement` needs about each payment — its amount. Deliberately narrower
 *  than the full `DocumentPayment` row (method/note/paidAt play no part in the arithmetic). */
export interface SettlementPaymentInput {
  amountMinor: number;
}

export interface DocumentSettlement {
  totalGrossMinor: number;
  paidMinor: number;
  /** What remains, never below zero — an overpaid document owes nothing, it does not owe less than
   *  nothing. See `overpaidMinor` for where the excess itself is surfaced instead of discarded. */
  outstandingMinor: number;
  /** The excess, when payments exceed the total — kept VISIBLE rather than folded into a negative
   *  `outstandingMinor` (which this function refuses to produce at all): a business decides what to
   *  do with a customer's overpayment (refund it, apply it forward), and it cannot decide on a fact
   *  the system quietly threw away. Zero when there is no overpayment. */
  overpaidMinor: number;
  /** `paidMinor >= totalGrossMinor` — an overpaid document is settled too, it does not stay "owed" a
   *  negative amount. */
  settled: boolean;
}

/**
 * Pure arithmetic: no Prisma, no currency conversion (a payment in a currency other than the
 * document's own is refused before it ever reaches here — see actions/invoice-actions.ts's
 * "record-payment" handler), no rounding rule invented on top of what `payments` already carries in
 * minor units.
 */
export function computeSettlement(
  totalGrossMinor: number,
  payments: readonly SettlementPaymentInput[],
): DocumentSettlement {
  const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const remainder = totalGrossMinor - paidMinor;

  return {
    totalGrossMinor,
    paidMinor,
    outstandingMinor: Math.max(0, remainder),
    overpaidMinor: Math.max(0, -remainder),
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
 */
export function describeSettlement(settlement: DocumentSettlement, currency: string): string {
  const decimals = decimalsFor(currency);
  const format = (minor: number) => `${fromMinor(minor, currency).toFixed(decimals)} ${currency}`;

  if (settlement.settled) {
    return settlement.overpaidMinor > 0
      ? `Payment recorded. Invoice fully paid — ${format(settlement.overpaidMinor)} overpaid.`
      : `Payment recorded. Invoice fully paid (${format(settlement.paidMinor)}).`;
  }

  return (
    `Payment recorded. ${format(settlement.paidMinor)} paid so far, ` +
    `${format(settlement.outstandingMinor)} still outstanding.`
  );
}
