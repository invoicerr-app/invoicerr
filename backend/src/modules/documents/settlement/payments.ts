import prisma from '@/prisma/prisma.service';

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
  amountMinor: number;
  currency: string;
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
  method?: string;
  paidAt: Date;
  note?: string;
}

export async function recordPayment(input: RecordPaymentInput): Promise<DocumentPaymentResult> {
  return prisma.documentPayment.create({
    data: {
      companyId: input.companyId,
      documentId: input.documentId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      method: input.method ?? null,
      paidAt: input.paidAt,
      note: input.note ?? null,
    },
  });
}

/** Every payment recorded against one document, oldest first — the order a "Payments" list reads
 *  naturally (first payment at the top, most recent at the bottom). */
export async function listPayments(companyId: string, documentId: string): Promise<DocumentPaymentResult[]> {
  return prisma.documentPayment.findMany({
    where: { companyId, documentId },
    orderBy: { paidAt: 'asc' },
  });
}

/**
 * The total paid, in minor units, for each of `documentIds` — ONE grouped query rather than one
 * lookup per document, for the dashboard's "pending invoices" contribution
 * (contributions/invoice-contributions.ts), which reads this for up to
 * `CONTRIBUTION_READ_LIMIT` invoices at a time. A document with no payments at all is simply ABSENT
 * from the returned map (never a zero entry) — the caller treats "not in the map" as "nothing paid
 * yet", the same "absence means zero" convention `computeSettlement` itself holds for an empty
 * `payments` array.
 */
export async function sumPaidMinorByDocument(
  companyId: string,
  documentIds: string[],
): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map();

  const grouped = await prisma.documentPayment.groupBy({
    by: ['documentId'],
    where: { companyId, documentId: { in: documentIds } },
    _sum: { amountMinor: true },
  });

  const sums = new Map<string, number>();
  for (const row of grouped) {
    sums.set(row.documentId, row._sum.amountMinor ?? 0);
  }
  return sums;
}
