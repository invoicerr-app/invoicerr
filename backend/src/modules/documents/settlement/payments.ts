import prisma from '@/prisma/prisma.service';

import { SettlementPaymentInput } from './compute-settlement';

/**
 * Shared, tenant-safe persistence for `DocumentPayment` rows — the exact same discipline
 * persistence.ts already holds for `DocumentInstance`: every query scoped by `companyId`, so a
 * scripted client can never read or write another company's payments by guessing an id.
 *
 * A payment is never UPDATED or DELETED by anything in this module — recording one is a single,
 * complete act (see compute-settlement.ts's own header on why a payment isn't a document with a
 * lifecycle). Correcting a mis-entered one is out of scope here, the same way this task never asked
 * for it.
 */

export interface DocumentPaymentResult {
  id: string;
  documentId: string;
  /** The amount ACTUALLY received, in the payment's OWN currency (`currency` below) — see
   *  `DocumentPayment`'s own schema.prisma comment. Audit trail, never fed to `computeSettlement`
   *  directly — see `documentAmountMinor`. */
  amountMinor: number;
  currency: string;
  /** The settlement-relevant figure, ALWAYS already in the document's own currency — see
   *  `DocumentPayment`'s own schema.prisma comment and `toSettlementPaymentInputs` below. */
  documentAmountMinor: number;
  /** Null exactly when `documentAmountMinor === amountMinor` (no conversion was applied). */
  conversionRate: number | null;
  conversionRateAsOf: Date | null;
  conversionSource: string | null;
  method: string | null;
  paidAt: Date;
  note: string | null;
  createdAt: Date;
}

export interface RecordPaymentInput {
  companyId: string;
  documentId: string;
  amountMinor: number;
  currency: string;
  documentAmountMinor: number;
  conversionRate?: number | null;
  conversionRateAsOf?: Date | null;
  conversionSource?: string | null;
  method?: string;
  paidAt: Date;
  note?: string;
}

/** Prisma's `Decimal | null` -> plain `number | null` — the one boundary this file crosses that type
 *  at, same convention as currency-rates.store.ts's own `toResult`. */
function toPaymentResult(row: {
  id: string;
  documentId: string;
  amountMinor: number;
  currency: string;
  documentAmountMinor: number;
  conversionRate: { toString(): string } | null;
  conversionRateAsOf: Date | null;
  conversionSource: string | null;
  method: string | null;
  paidAt: Date;
  note: string | null;
  createdAt: Date;
}): DocumentPaymentResult {
  return {
    id: row.id,
    documentId: row.documentId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    documentAmountMinor: row.documentAmountMinor,
    conversionRate: row.conversionRate ? Number(row.conversionRate.toString()) : null,
    conversionRateAsOf: row.conversionRateAsOf,
    conversionSource: row.conversionSource,
    method: row.method,
    paidAt: row.paidAt,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export async function recordPayment(input: RecordPaymentInput): Promise<DocumentPaymentResult> {
  const row = await prisma.documentPayment.create({
    data: {
      companyId: input.companyId,
      documentId: input.documentId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      documentAmountMinor: input.documentAmountMinor,
      conversionRate: input.conversionRate ?? null,
      conversionRateAsOf: input.conversionRateAsOf ?? null,
      conversionSource: input.conversionSource ?? null,
      method: input.method ?? null,
      paidAt: input.paidAt,
      note: input.note ?? null,
    },
  });
  return toPaymentResult(row);
}

/** Every payment recorded against one document, oldest first — the order a "Payments" list reads
 *  naturally (first payment at the top, most recent at the bottom). */
export async function listPayments(companyId: string, documentId: string): Promise<DocumentPaymentResult[]> {
  const rows = await prisma.documentPayment.findMany({
    where: { companyId, documentId },
    orderBy: { paidAt: 'asc' },
  });
  return rows.map(toPaymentResult);
}

/** `DocumentPaymentResult[]` -> what `computeSettlement` actually needs — mirrors
 *  `settlement/credits.ts`'s own `toSettlementCreditInputs`. Reads `documentAmountMinor`, NEVER the
 *  raw `amountMinor` (see `DocumentPaymentResult`'s own header on the two figures being different
 *  once a payment has been converted — TODO_PRODUIT.md T3): the two coincide only when a payment
 *  already matched the document's own currency. */
export function toSettlementPaymentInputs(
  payments: readonly DocumentPaymentResult[],
): SettlementPaymentInput[] {
  return payments.map((payment) => ({ amountMinor: payment.documentAmountMinor }));
}

/**
 * The total paid, in minor units OF THE DOCUMENT'S OWN CURRENCY, for each of `documentIds` — ONE
 * grouped query rather than one lookup per document, for the dashboard's "pending invoices"
 * contribution (contributions/invoice-contributions.ts), which reads this for up to
 * `CONTRIBUTION_READ_LIMIT` invoices at a time. A document with no payments at all is simply ABSENT
 * from the returned map (never a zero entry) — the caller treats "not in the map" as "nothing paid
 * yet", the same "absence means zero" convention `computeSettlement` itself holds for an empty
 * `payments` array.
 *
 * Sums `documentAmountMinor`, NOT `amountMinor` (TODO_PRODUIT.md T3) — see `DocumentPaymentResult`'s
 * own header: a foreign-currency payment's `amountMinor` is in ITS OWN currency, which this grouped
 * sum (one total PER document, implicitly in that document's currency) would otherwise silently mix
 * with same-currency payments — exactly the "one number, several currencies pretending to be one"
 * bug this whole task exists to close.
 */
export async function sumPaidMinorByDocument(
  companyId: string,
  documentIds: string[],
): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map();

  const grouped = await prisma.documentPayment.groupBy({
    by: ['documentId'],
    where: { companyId, documentId: { in: documentIds } },
    _sum: { documentAmountMinor: true },
  });

  const sums = new Map<string, number>();
  for (const row of grouped) {
    sums.set(row.documentId, row._sum.documentAmountMinor ?? 0);
  }
  return sums;
}
