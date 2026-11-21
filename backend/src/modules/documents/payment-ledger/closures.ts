import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { hashClosureRow, signLedgerHash } from './ledger-hash';
import { addTotals, CLOSURE_KINDS, ClosureKind, nextPeriodStart, periodStart } from './periods';
import { ledgerClock, lockPaymentLedger, sealPendingPayments } from './seal';

/**
 * Period closures: one record per elapsed UTC day, month and year in which at least one payment was
 * recorded, with its count, its totals per currency and the running total since the ledger began.
 * Closures form their own chain, across kinds, in the order they were written.
 *
 * Periods are counted on `createdAt` (when the payment was recorded), never `paidAt` (a date the
 * user types): only the former can be guaranteed never to fall inside a period already closed,
 * because `recordPayment` stamps it with the database clock under the same lock as this code.
 *
 * Closures are written lazily, whenever the ledger is read through this module, and for every
 * company by the boot sealing pass. A period with no payment has no closure.
 */

type PeriodBucket = {
  start: Date;
  count: number;
  first: number;
  last: number;
  totals: Record<string, number>;
};

export async function closeElapsedPeriods(companyId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockPaymentLedger(tx, companyId);
    await sealPendingPayments(tx, companyId);
    const now = await ledgerClock(tx);
    let written = 0;
    for (const kind of CLOSURE_KINDS) written += await closeKind(tx, companyId, kind, now);
    return written;
  });
}

async function closeKind(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: ClosureKind,
  now: Date,
): Promise<number> {
  const lastOfKind = await tx.paymentLedgerClosure.findFirst({
    where: { companyId, kind },
    orderBy: { periodStart: 'desc' },
    select: { periodEnd: true, perpetualTotals: true },
  });
  const openPeriod = periodStart(kind, now);
  const rows = await tx.documentPayment.findMany({
    where: {
      companyId,
      hash: { not: null },
      createdAt: { ...(lastOfKind ? { gte: lastOfKind.periodEnd } : {}), lt: openPeriod },
    },
    orderBy: { ledgerSequence: 'asc' },
    select: { createdAt: true, ledgerSequence: true, currency: true, amountMinor: true },
  });
  if (rows.length === 0) return 0;

  const buckets: PeriodBucket[] = [];
  for (const row of rows) {
    const start = periodStart(kind, row.createdAt);
    const sequence = row.ledgerSequence as number;
    let bucket = buckets.find((candidate) => candidate.start.getTime() === start.getTime());
    if (!bucket) {
      bucket = { start, count: 0, first: sequence, last: sequence, totals: {} };
      buckets.push(bucket);
    }
    bucket.count += 1;
    bucket.first = Math.min(bucket.first, sequence);
    bucket.last = Math.max(bucket.last, sequence);
    bucket.totals = addTotals(bucket.totals, { [row.currency]: row.amountMinor });
  }
  buckets.sort((a, b) => a.start.getTime() - b.start.getTime());

  let perpetual = (lastOfKind?.perpetualTotals ?? {}) as Record<string, number>;
  for (const bucket of buckets) {
    perpetual = addTotals(perpetual, bucket.totals);
    const previous = await tx.paymentLedgerClosure.findFirst({
      where: { companyId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true, hash: true },
    });
    const fields = {
      companyId,
      sequence: (previous?.sequence ?? 0) + 1,
      kind,
      periodStart: bucket.start,
      periodEnd: nextPeriodStart(kind, bucket.start),
      paymentCount: bucket.count,
      firstPaymentSequence: bucket.first,
      lastPaymentSequence: bucket.last,
      totals: bucket.totals,
      perpetualTotals: perpetual,
      previousHash: previous?.hash ?? null,
    };
    const hash = hashClosureRow(fields);
    await tx.paymentLedgerClosure.create({
      data: { ...fields, hash, signature: signLedgerHash(hash), createdAt: now },
    });
  }
  return buckets.length;
}
