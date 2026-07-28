/**
 * Compliance pipeline endpoints — thin controller → CompliancePipelineService → PrismaService.
 *
 * Routes:
 *   GET /compliance/documents   paginated ComplianceDocument summaries (?status=&channel=)
 *   GET /compliance/reports     paginated ComplianceReport summaries (?status=&kind=)
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompliancePipelineService } from './compliance-pipeline.service';

function parsePage(value?: string): number | undefined {
  const parsed = parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

@Controller('compliance')
export class CompliancePipelineController {
  constructor(private readonly pipeline: CompliancePipelineService) {}

  @Get('documents')
  listDocuments(
    @ActiveCompany() companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
  ) {
    return this.pipeline.listDocuments({
      companyId,
      page: parsePage(page),
      pageSize: parsePage(pageSize),
      status: status || undefined,
      channel: channel || undefined,
    });
  }

  @Get('reports')
  listReports(
    @ActiveCompany() companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    return this.pipeline.listReports({
      companyId,
      page: parsePage(page),
      pageSize: parsePage(pageSize),
      status: status || undefined,
      kind: kind || undefined,
    });
  }
}
