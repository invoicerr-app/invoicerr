/**
 * CompliancePipelineService — read-only summaries backing the frontend
 * "Compliance" pipeline page.
 *
 * Layering: controller → this service → PrismaService (never Prisma in controllers).
 *
 * Two paginated projections, summary fields only (no ctx/plan/payload blobs):
 *   - listDocuments(): ComplianceDocument rows (status, channel, authority refs, last event)
 *   - listReports():   ComplianceReport rows (kind, period, status, proof-of-filing refs)
 */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ComplianceStatus, Prisma } from '../../../prisma/generated/prisma/client';

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface ListDocumentsOptions {
  /** Caller's active company — every query is scoped to it (tenant isolation). */
  companyId: string;
  page?: number;
  pageSize?: number;
  /** ComplianceStatus filter (e.g. PENDING_CLEARANCE, CLEARED, REJECTED). */
  status?: string;
  /** Primary channel type filter (plan.channels[0].type — e.g. PDP, SDI, PEPPOL, EMAIL). */
  channel?: string;
}

export interface ListReportsOptions {
  /** Caller's active company — every query is scoped to it (tenant isolation). */
  companyId: string;
  page?: number;
  pageSize?: number;
  /** Report status filter (PENDING | SUBMITTED | FILED). */
  status?: string;
  /** ReportingKind filter (E_REPORTING | SAFT | OSS | …). */
  kind?: string;
}

/** Shape of the CompliancePlan JSON we project the channel from. */
interface PlanChannelsShape {
  channels?: { type?: string; providerId?: string }[];
}

function clampPage(page: number | undefined): number {
  return Math.max(1, page ?? 1);
}

function clampPageSize(pageSize: number | undefined): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? PAGE_SIZE));
}

@Injectable()
export class CompliancePipelineService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocuments(opts: ListDocumentsOptions) {
    const page = clampPage(opts.page);
    const pageSize = clampPageSize(opts.pageSize);

    // ComplianceDocument has no direct companyId column — scope via the invoice relation.
    // Documents with no linked invoice (invoiceId == null) are excluded from a per-company
    // view, matching the audit-export scoping (see PrismaComplianceDocumentStore.listByCompany).
    const where: Prisma.ComplianceDocumentWhereInput = { invoice: { companyId: opts.companyId } };
    if (opts.status) {
      if (!Object.values(ComplianceStatus).includes(opts.status as ComplianceStatus)) {
        throw new HttpException(`Unknown compliance status '${opts.status}'`, HttpStatus.BAD_REQUEST);
      }
      where.status = opts.status as ComplianceStatus;
    }
    if (opts.channel) {
      // Primary transmission channel lives in the resolved plan JSON: plan.channels[0].type.
      where.plan = { path: ['channels', '0', 'type'], equals: opts.channel };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.complianceDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          invoiceId: true,
          kind: true,
          direction: true,
          status: true,
          number: true,
          plan: true,
          createdAt: true,
          updatedAt: true,
          invoice: { select: { rawNumber: true, number: true } },
          authorityIds: { select: { scheme: true, value: true } },
          events: { select: { type: true, at: true }, orderBy: { at: 'desc' }, take: 1 },
        },
      }),
      this.prisma.complianceDocument.count({ where }),
    ]);

    const documents = rows.map((row) => {
      const plan = row.plan as PlanChannelsShape | null;
      const channelSpec = plan?.channels?.[0];
      const lastEvent = row.events[0] ?? null;
      return {
        id: row.id,
        invoiceId: row.invoiceId,
        invoiceNumber:
          row.invoice?.rawNumber ?? (row.invoice?.number != null ? String(row.invoice.number) : null),
        kind: row.kind,
        direction: row.direction,
        status: row.status,
        number: row.number,
        channelType: channelSpec?.type ?? null,
        channelProviderId: channelSpec?.providerId ?? null,
        authorityIds: row.authorityIds,
        lastEventType: lastEvent?.type ?? null,
        lastEventAt: lastEvent?.at ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return {
      documents,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async listReports(opts: ListReportsOptions) {
    const page = clampPage(opts.page);
    const pageSize = clampPageSize(opts.pageSize);

    // ComplianceReport DOES have a direct companyId column — scope directly. Reports with a
    // null companyId (period-aggregate records) are excluded from any per-company view.
    const where: Prisma.ComplianceReportWhereInput = { companyId: opts.companyId };
    if (opts.status) where.status = opts.status;
    if (opts.kind) where.kind = opts.kind;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.complianceReport.findMany({
        where,
        orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Summary fields only — `payload` can hold whole XML reports.
        select: {
          id: true,
          kind: true,
          periodKey: true,
          companyId: true,
          invoiceRef: true,
          status: true,
          submittedRef: true,
          submittedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.complianceReport.count({ where }),
    ]);

    return {
      reports: rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
