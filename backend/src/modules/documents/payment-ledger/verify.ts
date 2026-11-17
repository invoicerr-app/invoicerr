import prisma from '@/prisma/prisma.service';

import { canonicalClosure, canonicalPayment, isValidLedgerSignature, sha256Hex } from './ledger-hash';

export type LedgerProblemKind =
  | 'unsealed'
  | 'sequence-gap'
  | 'previous-hash-mismatch'
  | 'hash-mismatch'
  | 'signature-mismatch';

export interface LedgerProblem {
  chain: 'payments' | 'closures';
  kind: LedgerProblemKind;
  recordId: string;
  sequence: number | null;
}

export interface PaymentLedgerVerification {
  valid: boolean;
  verifiedAt: string;
  payments: number;
  closures: number;
  lastPaymentHash: string | null;
  lastClosureHash: string | null;
  problems: LedgerProblem[];
}

type ChainRow = { id: string; sequence: number | null; previousHash: string | null; hash: string | null };

/** Walks one chain in sequence order. `recompute` returns the hash the row's own fields produce. */
function walkChain<Row extends ChainRow>(
  chain: LedgerProblem['chain'],
  rows: Row[],
  recompute: (row: Row) => string,
  signatureOf: (row: Row) => string | null,
): LedgerProblem[] {
  const problems: LedgerProblem[] = [];
  let expectedSequence = 1;
  let previousHash: string | null = null;
  for (const row of rows) {
    const problem = (kind: LedgerProblemKind) =>
      problems.push({ chain, kind, recordId: row.id, sequence: row.sequence });
    if (row.hash === null || row.sequence === null) {
      problem('unsealed');
      continue;
    }
    if (row.sequence !== expectedSequence) problem('sequence-gap');
    if (row.previousHash !== previousHash) problem('previous-hash-mismatch');
    if (recompute(row) !== row.hash) problem('hash-mismatch');
    if (!isValidLedgerSignature(row.hash, signatureOf(row))) problem('signature-mismatch');
    expectedSequence = row.sequence + 1;
    previousHash = row.hash;
  }
  return problems;
}

/** Recomputes every hash and signature of the company's payments and closures. Read-only. */
export async function verifyPaymentLedger(companyId: string): Promise<PaymentLedgerVerification> {
  const [payments, closures] = await Promise.all([
    prisma.documentPayment.findMany({
      where: { companyId },
      orderBy: [{ ledgerSequence: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),
    prisma.paymentLedgerClosure.findMany({ where: { companyId }, orderBy: { sequence: 'asc' } }),
  ]);

  const paymentRows = payments.map((row) => ({ ...row, sequence: row.ledgerSequence }));
  const paymentProblems = walkChain<(typeof paymentRows)[number]>(
    'payments',
    paymentRows,
    (row) =>
      sha256Hex(
        canonicalPayment({
          ...row,
          ledgerSequence: row.ledgerSequence as number,
          conversionRate: row.conversionRate?.toString() ?? null,
        }),
      ),
    (row) => row.signature,
  );
  const closureProblems = walkChain<(typeof closures)[number]>(
    'closures',
    closures,
    (row) =>
      sha256Hex(
        canonicalClosure({
          ...row,
          totals: row.totals as Record<string, number>,
          perpetualTotals: row.perpetualTotals as Record<string, number>,
        }),
      ),
    (row) => row.signature,
  );

  const problems = [...paymentProblems, ...closureProblems];
  const lastSealed = payments.filter((row) => row.hash !== null).at(-1);
  return {
    valid: problems.length === 0,
    verifiedAt: new Date().toISOString(),
    payments: payments.length,
    closures: closures.length,
    lastPaymentHash: lastSealed?.hash ?? null,
    lastClosureHash: closures.at(-1)?.hash ?? null,
    problems,
  };
}
