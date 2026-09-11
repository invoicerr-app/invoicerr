import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { buildAccountingExport } from './accounting-export.service';

/**
 * The accounting export — the CSV slice only (accounting-export.service.ts's own header names what
 * is explicitly out of scope). One route, company-scoped like every other document read in this
 * module (`@ActiveCompany()`) — no extra `@Roles()` gate: any authenticated member of the
 * active company can pull the ledger, the same access level `GET /documents/:id/settlement`
 * (documents.controller.ts) already grants. Restricting this to an accountant/admin-only role later is
 * a trivial `@Roles()` addition, not a design change.
 */
@ApiTags('accounting-export')
@Controller('accounting-export')
export class AccountingExportController {
  @Get()
  @ApiOperation({
    summary: 'Export the company ledger (invoices, credit notes, payments) as CSV over a date range',
    description:
      'The GENERIC accounting CSV export — one row per real invoice/' +
      'credit-note/payment whose own date falls in [from, to], amounts/dates reused verbatim from ' +
      'totals/compute-totals.ts and settlement/compute-settlement.ts, never recomputed. ' +
      'Country-specific ledger FORMATS (FR FEC, DE DATEV) are out of scope for this endpoint.',
  })
  @ApiQuery({ name: 'from', required: true, type: String, description: 'YYYY-MM-DD, inclusive' })
  @ApiQuery({ name: 'to', required: true, type: String, description: 'YYYY-MM-DD, inclusive' })
  @ApiResponse({ status: 200, description: 'CSV generated', schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 400, description: '"from"/"to" missing, malformed, or "from" is after "to"' })
  async exportCsv(
    @ActiveCompany() companyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await buildAccountingExport(companyId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="accounting-export-${from}_${to}.csv"`);
    res.send(csv);
  }
}
