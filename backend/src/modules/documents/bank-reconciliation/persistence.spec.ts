import { vi, type Mock } from 'vitest';

import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { BankStatementFormat, BankStatementLineStatus } from '../../../../prisma/generated/prisma/client';
import {
  attachReconciledPayment,
  claimLineForReconciliation,
  createBankStatement,
  findOwnedLine,
  findOwnedStatement,
  listBankStatements,
  listStatementLines,
  releaseLineClaim,
} from './persistence';

/** Same manual-mock discipline as `archive/persistence.spec.ts` — a narrow, hand-rolled stand-in for
 *  exactly the Prisma delegate methods this file's own functions call, no more. */
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    bankStatement: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    bankStatementLine: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

const createStatement = prisma.bankStatement.create as Mock;
const findFirstStatement = prisma.bankStatement.findFirst as Mock;
const findManyStatements = prisma.bankStatement.findMany as Mock;
const findFirstLine = prisma.bankStatementLine.findFirst as Mock;
const findManyLines = prisma.bankStatementLine.findMany as Mock;
const groupByLines = prisma.bankStatementLine.groupBy as Mock;
const updateManyLines = prisma.bankStatementLine.updateMany as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createBankStatement', () => {
  it('creates the statement with a nested line write, and returns the resolved line count', async () => {
    createStatement.mockResolvedValue({
      id: 'stmt-1',
      fileName: 'releve.csv',
      format: BankStatementFormat.CSV,
      currency: 'EUR',
      importedAt: new Date('2026-09-14T00:00:00.000Z'),
      _count: { lines: 2 },
    });

    const result = await createBankStatement('company-1', 'releve.csv', BankStatementFormat.CSV, 'EUR', [
      { date: new Date('2026-08-15'), amountMinor: 12000, label: 'A', reference: null, raw: { a: '1' } },
      { date: new Date('2026-08-16'), amountMinor: -500, label: 'B', reference: 'R1', raw: { a: '2' } },
    ]);

    expect(result).toEqual({
      id: 'stmt-1',
      fileName: 'releve.csv',
      format: BankStatementFormat.CSV,
      currency: 'EUR',
      importedAt: new Date('2026-09-14T00:00:00.000Z'),
      lineCount: 2,
    });

    const call = createStatement.mock.calls[0][0];
    expect(call.data.companyId).toBe('company-1');
    expect(call.data.lines.create).toHaveLength(2);
    expect(call.data.lines.create[0]).toMatchObject({
      companyId: 'company-1',
      lineIndex: 0,
      amountMinor: 12000,
    });
    expect(call.data.lines.create[1]).toMatchObject({ lineIndex: 1, amountMinor: -500, reference: 'R1' });
  });
});

describe('listBankStatements', () => {
  it('returns an empty list without querying line counts at all', async () => {
    findManyStatements.mockResolvedValue([]);
    expect(await listBankStatements('company-1')).toEqual([]);
    expect(groupByLines).not.toHaveBeenCalled();
  });

  it('attaches UNMATCHED/RECONCILED counts per statement from one grouped query', async () => {
    findManyStatements.mockResolvedValue([
      {
        id: 'stmt-1',
        fileName: 'a.csv',
        format: BankStatementFormat.CSV,
        currency: 'EUR',
        importedAt: new Date('2026-09-14'),
        _count: { lines: 3 },
      },
      {
        id: 'stmt-2',
        fileName: 'b.ofx',
        format: BankStatementFormat.OFX,
        currency: 'USD',
        importedAt: new Date('2026-09-10'),
        _count: { lines: 1 },
      },
    ]);
    groupByLines.mockResolvedValue([
      { statementId: 'stmt-1', status: BankStatementLineStatus.UNMATCHED, _count: { _all: 2 } },
      { statementId: 'stmt-1', status: BankStatementLineStatus.RECONCILED, _count: { _all: 1 } },
      // stmt-2 has no reconciled rows at all — absent from the grouped result entirely.
      { statementId: 'stmt-2', status: BankStatementLineStatus.UNMATCHED, _count: { _all: 1 } },
    ]);

    const result = await listBankStatements('company-1');
    expect(result[0]).toMatchObject({ id: 'stmt-1', unmatchedCount: 2, reconciledCount: 1 });
    expect(result[1]).toMatchObject({ id: 'stmt-2', unmatchedCount: 1, reconciledCount: 0 });
  });
});

describe('findOwnedStatement / findOwnedLine — tenant isolation', () => {
  it('404s a statement not scoped to this company, rather than leaking it', async () => {
    findFirstStatement.mockResolvedValue(null);
    await expect(findOwnedStatement('company-1', 'stmt-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirstStatement).toHaveBeenCalledWith({ where: { id: 'stmt-x', companyId: 'company-1' } });
  });

  it('404s a line not scoped to this company', async () => {
    findFirstLine.mockResolvedValue(null);
    await expect(findOwnedLine('company-1', 'line-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('listStatementLines', () => {
  it('orders by lineIndex — file order, never re-sorted', async () => {
    findManyLines.mockResolvedValue([]);
    await listStatementLines('company-1', 'stmt-1');
    expect(findManyLines).toHaveBeenCalledWith({
      where: { companyId: 'company-1', statementId: 'stmt-1' },
      orderBy: { lineIndex: 'asc' },
    });
  });
});

describe('claimLineForReconciliation — the double-reconciliation guard', () => {
  it('claims an UNMATCHED line: conditional UPDATE, returns true on a single affected row', async () => {
    updateManyLines.mockResolvedValue({ count: 1 });
    const claimed = await claimLineForReconciliation('company-1', 'line-1', 'inv-1');
    expect(claimed).toBe(true);
    expect(updateManyLines).toHaveBeenCalledWith({
      where: { id: 'line-1', companyId: 'company-1', status: BankStatementLineStatus.UNMATCHED },
      data: expect.objectContaining({
        status: BankStatementLineStatus.RECONCILED,
        reconciledDocumentId: 'inv-1',
      }),
    });
  });

  it('a SECOND claim on the same line affects zero rows — returns false, never throws', async () => {
    updateManyLines.mockResolvedValue({ count: 0 });
    expect(await claimLineForReconciliation('company-1', 'line-1', 'inv-1')).toBe(false);
  });
});

describe('attachReconciledPayment / releaseLineClaim', () => {
  it('attachReconciledPayment writes only reconciledPaymentId, scoped by company', async () => {
    updateManyLines.mockResolvedValue({ count: 1 });
    await attachReconciledPayment('company-1', 'line-1', 'pay-1');
    expect(updateManyLines).toHaveBeenCalledWith({
      where: { id: 'line-1', companyId: 'company-1' },
      data: { reconciledPaymentId: 'pay-1' },
    });
  });

  it('releaseLineClaim only ever reverts a claim with no payment attached yet', async () => {
    updateManyLines.mockResolvedValue({ count: 1 });
    await releaseLineClaim('company-1', 'line-1');
    expect(updateManyLines).toHaveBeenCalledWith({
      where: {
        id: 'line-1',
        companyId: 'company-1',
        status: BankStatementLineStatus.RECONCILED,
        reconciledPaymentId: null,
      },
      data: { status: BankStatementLineStatus.UNMATCHED, reconciledDocumentId: null, reconciledAt: null },
    });
  });
});
