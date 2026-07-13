import { HttpException } from '@nestjs/common';
import { CompliancePipelineService } from './compliance-pipeline.service';
import { PrismaService } from '@/prisma/prisma.service';

describe('CompliancePipelineService', () => {
  let prisma: {
    complianceDocument: { findMany: jest.Mock; count: jest.Mock };
    complianceReport: { findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: CompliancePipelineService;

  const docRow = {
    id: 'doc-1',
    invoiceId: 'inv-1',
    kind: 'INVOICE',
    direction: 'OUTBOUND',
    status: 'PENDING_CLEARANCE',
    number: 'FA-2026-001',
    plan: { channels: [{ type: 'PDP', providerId: 'superpdp' }] },
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-02T10:00:00Z'),
    invoice: { rawNumber: 'FA-2026-001', number: 1 },
    authorityIds: [{ scheme: 'PDP_ID', value: 'abc-123' }],
    events: [{ type: 'SUBMITTED', at: new Date('2026-06-02T09:00:00Z') }],
  };

  beforeEach(() => {
    prisma = {
      complianceDocument: { findMany: jest.fn(), count: jest.fn() },
      complianceReport: { findMany: jest.fn(), count: jest.fn() },
      // The service passes the two Prisma promises straight through.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new CompliancePipelineService(prisma as unknown as PrismaService);
  });

  describe('listDocuments', () => {
    it('maps rows to summaries (channel from plan, last event, authority refs)', async () => {
      prisma.complianceDocument.findMany.mockResolvedValue([docRow]);
      prisma.complianceDocument.count.mockResolvedValue(1);

      const result = await service.listDocuments({ companyId: 'comp-1' });

      expect(result.total).toBe(1);
      expect(result.pageCount).toBe(1);
      expect(result.documents).toHaveLength(1);
      const doc = result.documents[0];
      expect(doc).toMatchObject({
        id: 'doc-1',
        invoiceId: 'inv-1',
        invoiceNumber: 'FA-2026-001',
        status: 'PENDING_CLEARANCE',
        channelType: 'PDP',
        channelProviderId: 'superpdp',
        lastEventType: 'SUBMITTED',
      });
      expect(doc.authorityIds).toEqual([{ scheme: 'PDP_ID', value: 'abc-123' }]);
      // No plan/ctx blobs in the summary
      expect(doc).not.toHaveProperty('plan');
    });

    it('handles rows without plan, invoice or events', async () => {
      prisma.complianceDocument.findMany.mockResolvedValue([
        { ...docRow, plan: null, invoice: null, events: [], authorityIds: [] },
      ]);
      prisma.complianceDocument.count.mockResolvedValue(1);

      const { documents } = await service.listDocuments({ companyId: 'comp-1' });
      expect(documents[0]).toMatchObject({
        invoiceNumber: null,
        channelType: null,
        channelProviderId: null,
        lastEventType: null,
        lastEventAt: null,
      });
    });

    it('filters by status and by primary channel (plan JSON path)', async () => {
      prisma.complianceDocument.findMany.mockResolvedValue([]);
      prisma.complianceDocument.count.mockResolvedValue(0);

      await service.listDocuments({ companyId: 'comp-1', status: 'CLEARED', channel: 'PDP' });

      const where = prisma.complianceDocument.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('CLEARED');
      expect(where.plan).toEqual({ path: ['channels', '0', 'type'], equals: 'PDP' });
      expect(prisma.complianceDocument.count).toHaveBeenCalledWith({ where });
    });

    it('always scopes by the caller company (tenant isolation — invoice relation)', async () => {
      prisma.complianceDocument.findMany.mockResolvedValue([]);
      prisma.complianceDocument.count.mockResolvedValue(0);

      await service.listDocuments({ companyId: 'comp-1' });

      const where = prisma.complianceDocument.findMany.mock.calls[0][0].where;
      expect(where.invoice).toEqual({ companyId: 'comp-1' });
    });

    it('rejects an unknown status with 400', async () => {
      await expect(service.listDocuments({ companyId: 'comp-1', status: 'NOT_A_STATUS' })).rejects.toThrow(
        HttpException,
      );
      expect(prisma.complianceDocument.findMany).not.toHaveBeenCalled();
    });

    it('clamps pagination and computes pageCount', async () => {
      prisma.complianceDocument.findMany.mockResolvedValue([]);
      prisma.complianceDocument.count.mockResolvedValue(45);

      const result = await service.listDocuments({ companyId: 'comp-1', page: 3, pageSize: 500 });

      const args = prisma.complianceDocument.findMany.mock.calls[0][0];
      expect(args.take).toBe(100); // MAX_PAGE_SIZE clamp
      expect(args.skip).toBe(200);
      expect(result.pageCount).toBe(1);
      expect(result.page).toBe(3);
    });
  });

  describe('listReports', () => {
    it('lists report summaries without the payload column', async () => {
      const reportRow = {
        id: 'rep-1',
        kind: 'E_REPORTING',
        periodKey: '2026-06',
        companyId: 'comp-1',
        invoiceRef: null,
        status: 'PENDING',
        submittedRef: null,
        submittedAt: null,
        createdAt: new Date('2026-06-30T00:00:00Z'),
        updatedAt: new Date('2026-06-30T00:00:00Z'),
      };
      prisma.complianceReport.findMany.mockResolvedValue([reportRow]);
      prisma.complianceReport.count.mockResolvedValue(1);

      const result = await service.listReports({ companyId: 'comp-1' });

      expect(result.reports).toEqual([reportRow]);
      expect(result.total).toBe(1);
      const select = prisma.complianceReport.findMany.mock.calls[0][0].select;
      expect(select.payload).toBeUndefined();
      expect(select.kind).toBe(true);
      const where = prisma.complianceReport.findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe('comp-1');
    });

    it('filters by status and kind, always scoped by the caller company', async () => {
      prisma.complianceReport.findMany.mockResolvedValue([]);
      prisma.complianceReport.count.mockResolvedValue(0);

      await service.listReports({ companyId: 'comp-1', status: 'SUBMITTED', kind: 'SAFT' });

      const where = prisma.complianceReport.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ companyId: 'comp-1', status: 'SUBMITTED', kind: 'SAFT' });
    });
  });
});
