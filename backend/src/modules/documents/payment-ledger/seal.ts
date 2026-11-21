import { Prisma } from '../../../../prisma/generated/prisma/client';
import { canonicalPayment, sha256Hex, signLedgerHash } from './ledger-hash';

/**
 * Sealing gives each payment its place in the company's chain. Everything here runs inside a
 * transaction holding the company's ledger lock, so two writers never claim the same sequence or
 * chain onto the same previous hash.
 */

/** Serialises every ledger write of one company until the transaction ends. Re-entrant. */
export async function lockPaymentLedger(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-ledger:${companyId}`}))`;
}

/** The database clock, read under the ledger lock. A record stamped with it can never land in a
 *  period a closure already summed, which an application clock on another host could not promise. */
export async function ledgerClock(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return rows[0].now;
}

/** Seals the company's unsealed payments in the order they were recorded. Idempotent: rows sealed
 *  earlier are left alone, so this also seals rows that predate the ledger. */
export async function sealPendingPayments(tx: Prisma.TransactionClient, companyId: string): Promise<number> {
  await lockPaymentLedger(tx, companyId);
  const last = await tx.documentPayment.findFirst({
    where: { companyId, hash: { not: null } },
    orderBy: { ledgerSequence: 'desc' },
    select: { ledgerSequence: true, hash: true },
  });
  const pending = await tx.documentPayment.findMany({
    where: { companyId, hash: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  let sequence = last?.ledgerSequence ?? 0;
  let previousHash = last?.hash ?? null;
  for (const row of pending) {
    sequence += 1;
    const hash = sha256Hex(
      canonicalPayment({
        ...row,
        ledgerSequence: sequence,
        conversionRate: row.conversionRate?.toString() ?? null,
        previousHash,
      }),
    );
    await tx.documentPayment.update({
      where: { id: row.id },
      data: { ledgerSequence: sequence, previousHash, hash, signature: signLedgerHash(hash) },
    });
    previousHash = hash;
  }
  return pending.length;
}
