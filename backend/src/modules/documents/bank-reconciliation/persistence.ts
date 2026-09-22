import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import {
  BankStatementFormat,
  BankStatementLineStatus,
  Prisma,
} from '../../../../prisma/generated/prisma/client';
import { ParsedStatementLine } from './parse-csv';

/**
 * Tenant-safe Prisma persistence for `BankStatement`/`BankStatementLine` — every query scoped by
 * `companyId`, the same discipline `settlement/payments.ts`/`persistence.ts` already hold throughout
 * this module. Plain functions, not a class: nothing here needs an injected provider (see
 * `bank-reconciliation.module.ts`'s own header on the one thing in this feature that DOES).
 */

export interface BankStatementResult {
  id: string;
  fileName: string;
  format: BankStatementFormat;
  currency: string;
  importedAt: Date;
  lineCount: number;
}

export interface BankStatementSummary extends BankStatementResult {
  unmatchedCount: number;
  reconciledCount: number;
}

export interface BankStatementLineResult {
  id: string;
  statementId: string;
  lineIndex: number;
  date: Date;
  amountMinor: number;
  label: string;
  reference: string | null;
  status: BankStatementLineStatus;
  reconciledDocumentId: string | null;
  reconciledPaymentId: string | null;
  reconciledAt: Date | null;
}

function toLineResult(row: {
  id: string;
  statementId: string;
  lineIndex: number;
  date: Date;
  amountMinor: number;
  label: string;
  reference: string | null;
  status: BankStatementLineStatus;
  reconciledDocumentId: string | null;
  reconciledPaymentId: string | null;
  reconciledAt: Date | null;
}): BankStatementLineResult {
  return {
    id: row.id,
    statementId: row.statementId,
    lineIndex: row.lineIndex,
    date: row.date,
    amountMinor: row.amountMinor,
    label: row.label,
    reference: row.reference,
    status: row.status,
    reconciledDocumentId: row.reconciledDocumentId,
    reconciledPaymentId: row.reconciledPaymentId,
    reconciledAt: row.reconciledAt,
  };
}

/** Creates the statement AND every one of its lines in a single nested write — Prisma's own nested
 *  `create` is already atomic (one write, one round trip), so there is no separate transaction to
 *  reach for here, unlike a multi-step write elsewhere in this module (`prisma.$transaction`). */
export async function createBankStatement(
  companyId: string,
  fileName: string,
  format: BankStatementFormat,
  currency: string,
  parsedLines: readonly ParsedStatementLine[],
): Promise<BankStatementResult> {
  const created = await prisma.bankStatement.create({
    data: {
      companyId,
      fileName,
      format,
      currency,
      lines: {
        create: parsedLines.map((line, index) => ({
          companyId,
          lineIndex: index,
          date: line.date,
          amountMinor: line.amountMinor,
          label: line.label,
          reference: line.reference,
          raw: line.raw as Prisma.InputJsonValue,
        })),
      },
    },
    include: { _count: { select: { lines: true } } },
  });

  return {
    id: created.id,
    fileName: created.fileName,
    format: created.format,
    currency: created.currency,
    importedAt: created.importedAt,
    lineCount: created._count.lines,
  };
}

/** Every statement for this company, most recently imported first, each with its own UNMATCHED /
 *  RECONCILED line counts — a `groupBy` on `BankStatementLine`, ONE query for however many statements
 *  exist, the same "one query, many rows" shape `settlement/payments.ts`'s own `sumPaidMinorByDocument`
 *  already holds. */
export async function listBankStatements(companyId: string): Promise<BankStatementSummary[]> {
  const statements = await prisma.bankStatement.findMany({
    where: { companyId },
    orderBy: { importedAt: 'desc' },
    include: { _count: { select: { lines: true } } },
  });
  if (statements.length === 0) return [];

  const grouped = await prisma.bankStatementLine.groupBy({
    by: ['statementId', 'status'],
    where: { companyId },
    _count: { _all: true },
  });

  const countsByStatement = new Map<string, { unmatched: number; reconciled: number }>();
  for (const row of grouped) {
    const entry = countsByStatement.get(row.statementId) ?? { unmatched: 0, reconciled: 0 };
    if (row.status === BankStatementLineStatus.UNMATCHED) entry.unmatched = row._count._all;
    else entry.reconciled = row._count._all;
    countsByStatement.set(row.statementId, entry);
  }

  return statements.map((statement) => {
    const counts = countsByStatement.get(statement.id) ?? { unmatched: 0, reconciled: 0 };
    return {
      id: statement.id,
      fileName: statement.fileName,
      format: statement.format,
      currency: statement.currency,
      importedAt: statement.importedAt,
      lineCount: statement._count.lines,
      unmatchedCount: counts.unmatched,
      reconciledCount: counts.reconciled,
    };
  });
}

/** 404s (rather than returning null) when `statementId` doesn't exist or belongs to another company —
 *  the two cases are indistinguishable from the outside, the same convention `persistence.ts`'s own
 *  `findOwnedDocument` holds. */
export async function findOwnedStatement(
  companyId: string,
  statementId: string,
): Promise<{
  id: string;
  fileName: string;
  format: BankStatementFormat;
  currency: string;
  importedAt: Date;
}> {
  const statement = await prisma.bankStatement.findFirst({ where: { id: statementId, companyId } });
  if (!statement) {
    throw new NotFoundException(`Bank statement "${statementId}" not found.`);
  }
  return statement;
}

/** Every line of one statement, in FILE ORDER (`lineIndex`) — never re-sorted, see
 *  `BankStatementLine.lineIndex`'s own schema comment on why. */
export async function listStatementLines(
  companyId: string,
  statementId: string,
): Promise<BankStatementLineResult[]> {
  const lines = await prisma.bankStatementLine.findMany({
    where: { companyId, statementId },
    orderBy: { lineIndex: 'asc' },
  });
  return lines.map(toLineResult);
}

export async function findOwnedLine(companyId: string, lineId: string): Promise<BankStatementLineResult> {
  const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId, companyId } });
  if (!line) {
    throw new NotFoundException(`Bank statement line "${lineId}" not found.`);
  }
  return toLineResult(line);
}

/**
 * The atomic "double reconciliation" guard: an `UPDATE ... WHERE id = ? AND status = 'UNMATCHED'`,
 * exactly the conditional-write shape `time-tracking/time-entries.service.ts`'s own `billToInvoice`
 * already uses for the identical problem ("two concurrent requests racing over the SAME row can never
 * both win — Postgres serializes the two UPDATEs; the loser's own WHERE clause matches zero rows once
 * the winner commits"). Returns whether THIS call was the winner (`count === 1`) —
 * `bank-reconciliation.service.ts#reconcileLine` calls this BEFORE ever creating the payment, so a
 * lost race never creates a duplicate one; see that file's own header for the
 * claim-then-create-then-attach sequence this makes safe.
 */
export async function claimLineForReconciliation(
  companyId: string,
  lineId: string,
  documentId: string,
): Promise<boolean> {
  const result = await prisma.bankStatementLine.updateMany({
    where: { id: lineId, companyId, status: BankStatementLineStatus.UNMATCHED },
    data: {
      status: BankStatementLineStatus.RECONCILED,
      reconciledDocumentId: documentId,
      reconciledAt: new Date(),
    },
  });
  return result.count === 1;
}

/** The SECOND half of a successful reconciliation — records WHICH `DocumentPayment` the claim above
 *  actually produced, once `documents.service.ts#runAction` has returned successfully. Split from the
 *  claim itself because the payment does not exist yet at claim time — see
 *  `bank-reconciliation.service.ts#reconcileLine`'s own header for the full claim-then-create-then-
 *  attach sequence this is one step of. */
export async function attachReconciledPayment(
  companyId: string,
  lineId: string,
  paymentId: string,
): Promise<void> {
  await prisma.bankStatementLine.updateMany({
    where: { id: lineId, companyId },
    data: { reconciledPaymentId: paymentId },
  });
}

/**
 * The COMPENSATING rollback for a claim whose payment creation then failed (a country-policy refusal,
 * an unresolvable exchange rate, …) — releases the line back to UNMATCHED so it is not left stuck
 * "reconciled" with no payment to show for it. Guarded by `reconciledPaymentId: null` so this can never
 * undo an ALREADY-COMPLETED reconciliation (one whose `attachReconciledPayment` call already landed) —
 * only ever the specific claim that is being unwound in the same request that made it.
 */
export async function releaseLineClaim(companyId: string, lineId: string): Promise<void> {
  await prisma.bankStatementLine.updateMany({
    where: {
      id: lineId,
      companyId,
      status: BankStatementLineStatus.RECONCILED,
      reconciledPaymentId: null,
    },
    data: { status: BankStatementLineStatus.UNMATCHED, reconciledDocumentId: null, reconciledAt: null },
  });
}
