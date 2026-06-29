/**
 * Prisma-backed ReportingStore implementation.
 * Each row is keyed by (kind, periodKey, companyId, invoiceRef) — unique in the DB.
 */
import { PrismaService } from '@/prisma/prisma.service';
import { ReportRecord, ReportingStore } from './reporting-store';

function rowToRecord(row: any): ReportRecord {
  return {
    id: row.id,
    kind: row.kind,
    periodKey: row.periodKey,
    companyId: row.companyId,
    invoiceRef: row.invoiceRef,
    status: row.status as ReportRecord['status'],
    payload: row.payload,
    submittedRef: row.submittedRef,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaReportingStore implements ReportingStore {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    kind: string,
    periodKey: string,
    companyId: string | null,
    invoiceRef: string | null,
  ): Promise<ReportRecord | null> {
    const row = await this.prisma.complianceReport.findUnique({
      where: {
        kind_periodKey_companyId_invoiceRef: {
          kind,
          periodKey,
          companyId: companyId ?? '',
          invoiceRef: invoiceRef ?? '',
        },
      },
    });
    return row ? rowToRecord(row) : null;
  }

  async create(record: Omit<ReportRecord, 'id' | 'createdAt'>): Promise<ReportRecord> {
    const row = await this.prisma.complianceReport.create({
      data: {
        kind: record.kind,
        periodKey: record.periodKey,
        companyId: record.companyId,
        invoiceRef: record.invoiceRef,
        status: record.status,
        payload: record.payload as any,
        submittedRef: record.submittedRef,
        submittedAt: record.submittedAt,
      },
    });
    return rowToRecord(row);
  }

  async markSubmitted(id: string, ref: string, submittedAt: Date = new Date()): Promise<void> {
    await this.prisma.complianceReport.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedRef: ref, submittedAt },
    });
  }
}
