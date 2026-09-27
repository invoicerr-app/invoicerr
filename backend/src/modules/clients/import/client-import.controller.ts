import { Body, Controller, Get, Header, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { RequiresScope } from '@/utils/scope-check';

import { ClientImportService } from './client-import.service';
import { buildClientImportTemplateCsv } from './client-import-template';
import { ClientImportRow } from './client-import.types';

/** `type ClientImportRow[]` is the SAME shape the browser already validated with the shared zod
 *  schema - see `frontend/src/lib/client-schema.ts`. No class-validator here, matching the rest of
 *  this module: `clients.controller.ts`'s own `EditClientsDto` is a plain interface too (no global
 *  `ValidationPipe` runs anywhere in this API - see `editClientsInfo`'s own comment on why every
 *  write path allow-lists its fields by hand instead); the service is the actual authority on
 *  whether a row is well-formed, via `assertClientCreatable`. */
export class ClientImportRowsDto {
  rows: ClientImportRow[];
}

@ApiTags('clients')
@Controller('clients/import')
export class ClientImportController {
  constructor(private readonly clientImportService: ClientImportService) {}

  @Get('template')
  @RequiresScope('clients:read')
  @ApiOperation({
    summary: 'Download the client CSV import template',
    description:
      'A CSV with exactly the columns the import accepts (the same fields the client creation form ' +
      'exposes), plus one filled-in example row.',
  })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="clients-import-template.csv"')
  @ApiResponse({ status: 200, description: 'Template CSV' })
  getTemplate(@Res() res: Response) {
    res.send(buildClientImportTemplateCsv());
  }

  @Post('preview')
  @RequiresScope('clients:write')
  @ApiOperation({
    summary: 'Preview a client CSV import',
    description:
      'Re-validates every row server-side (the same checks `POST /clients` runs) and reports, per ' +
      'row, whether it will be created, is rejected (with the reason), or is a duplicate of an ' +
      'existing client or an earlier row in the file. Writes nothing.',
  })
  @ApiResponse({ status: 200, description: 'Per-row verdicts' })
  preview(@ActiveCompany() companyId: string, @Body() body: ClientImportRowsDto) {
    return this.clientImportService.preview(companyId, body.rows ?? []);
  }

  @Post()
  @RequiresScope('clients:write')
  @ApiOperation({
    summary: 'Confirm a client CSV import',
    description:
      'Re-validates every row from scratch (never trusts a previously fetched preview) and creates ' +
      'every valid, non-duplicate row in one transaction - a failure on any row leaves none created.',
  })
  @ApiResponse({ status: 201, description: 'Import result' })
  confirm(@ActiveCompany() companyId: string, @Body() body: ClientImportRowsDto) {
    return this.clientImportService.confirm(companyId, body.rows ?? []);
  }
}
