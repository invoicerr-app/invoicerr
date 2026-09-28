import { RequiresDocumentTypeScope } from '@/utils/scope-check';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { buildCashedRevenueCsv, buildCashedRevenueReport } from './revenue-report.service';

/**
 * Issue #516's "cashed-revenue view per period" — same access level as the accounting export
 * (`accounting-export.controller.ts`'s own header: any authenticated member of the active company,
 * `@RequiresDocumentTypeScope('read', 'every-type')`, no extra `@Roles()` gate) since this is a
 * READ over the same underlying facts (sent invoices' own payments), never a write.
 */
@ApiTags('revenue-report')
@Controller('revenue')
export class RevenueReportController {
  @Get('cashed')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: 'Cashed revenue per period (month or quarter) — an aid, not the official declaration',
    description:
      'Money actually received against sent invoices, bucketed by month or quarter, converted into ' +
      'the company’s reference currency (when set) at each PAYMENT’s own frozen rate. See ' +
      'issue #516: this never replaces a real accounting declaration.',
  })
  @ApiQuery({ name: 'granularity', required: false, enum: ['monthly', 'quarterly'] })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'YYYY-MM-DD, inclusive' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'YYYY-MM-DD, inclusive' })
  async getCashedRevenue(
    @ActiveCompany() companyId: string,
    @Query('granularity') granularity: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    return buildCashedRevenueReport(companyId, { granularity, from, to });
  }

  @Get('cashed/export')
  @RequiresDocumentTypeScope('read', 'every-type')
  @ApiOperation({
    summary: 'The cashed-revenue view above, as a downloadable CSV',
  })
  @ApiQuery({ name: 'granularity', required: false, enum: ['monthly', 'quarterly'] })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'YYYY-MM-DD, inclusive' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'YYYY-MM-DD, inclusive' })
  @ApiResponse({ status: 200, description: 'CSV generated', schema: { type: 'string', format: 'binary' } })
  async exportCashedRevenueCsv(
    @ActiveCompany() companyId: string,
    @Query('granularity') granularity: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const report = await buildCashedRevenueReport(companyId, { granularity, from, to });
    const csv = buildCashedRevenueCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cashed-revenue-${report.granularity}-${report.periods[0]?.key ?? 'export'}.csv"`,
    );
    res.send(csv);
  }
}
