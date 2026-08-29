/**
 * What is still owed on an invoice, once payments AND credit notes are counted.
 *
 * Odoo shows this as "Crédits en circulation" on the invoice, with a button to apply them. Ours had
 * no notion at all: an invoice and the credit note correcting it lived side by side and neither knew
 * the other existed, so a fully-credited invoice stayed UNPAID for ever and chased the customer.
 *
 * A credit note is NOT a payment, and this keeps them apart rather than faking one as the other. The
 * distinction is not pedantry — a payment is cash that arrived, a credit is an amount withdrawn from
 * the claim. They settle the same balance and answer different questions, and a product that files a
 * credit as a payment will one day report revenue it never received.
 *
 * Everything is in MINOR units. Floats do not add up to zero.
 */

/** A document that reduces what is owed. */
export interface SettlementCredit {
  id: string;
  /** Positive minor amount withdrawn from the claim, whatever sign the document carries. */
  amountMinor: number;
}

export interface SettlementInput {
  totalMinor: number;
  paymentsMinor: readonly number[];
  /** ISSUED corrections pointing at this invoice. Drafts are excluded by the caller: a draft
   *  correction is a document the user has not finished, and it settles nothing. */
  credits: readonly SettlementCredit[];
}

export interface Settlement {
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  /** What remains, never below zero — an over-credited invoice owes nothing, it does not owe less
   *  than nothing. Whether the excess is refundable is a question this function must not answer. */
  outstandingMinor: number;
  settled: boolean;
}

/**
 * The balance, and nothing else.
 *
 * Deliberately pure and free of Prisma: the arithmetic is what goes wrong in this area, and it is
 * testable without a database.
 */
export function settlementOf(input: SettlementInput): Settlement {
  const paidMinor = input.paymentsMinor.reduce((sum, p) => sum + p, 0);
  const creditedMinor = input.credits.reduce((sum, c) => sum + Math.abs(c.amountMinor), 0);
  const outstandingMinor = Math.max(0, input.totalMinor - paidMinor - creditedMinor);

  return {
    totalMinor: input.totalMinor,
    paidMinor,
    creditedMinor,
    outstandingMinor,
    // `<= 0` rather than `=== 0`: an over-credited or over-paid invoice is settled too, and a
    // strict equality would leave it chasing a customer for a negative amount.
    settled: input.totalMinor - paidMinor - creditedMinor <= 0,
  };
}
