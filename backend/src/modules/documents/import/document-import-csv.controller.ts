import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { RequiresDocumentTypeScope } from '@/utils/scope-check';

import { DocumentImportCsvService } from './document-import-csv.service';
import { DocumentImportCsvRow } from './document-import-csv.types';
import { ImportOriginalFileRef, isImportableTypeId } from './document-import.types';

/** `rows`/`files` mirror `document-import-csv.types.ts#DocumentImportCsvRequest` minus `typeId`
 *  (the route param already carries it) - plain interface, no class-validator, same convention as
 *  `ClientImportRowsDto` (`clients/import/client-import.controller.ts`'s own comment on why). */
export class DocumentImportCsvRowsDto {
  rows: DocumentImportCsvRow[];
  files: Record<string, ImportOriginalFileRef>;
}

@ApiTags('documents')
@Controller('documents/types/:typeId/import/csv')
export class DocumentImportCsvController {
  constructor(private readonly csvService: DocumentImportCsvService) {}

  @Post('preview')
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: 'Preview a CSV bulk import of documents from a previous tool',
    description:
      'Re-validates every row server-side (the same checks a single import runs) and reports, per ' +
      'row, whether it will be imported or is rejected with the reason. Writes nothing.',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiResponse({ status: 200, description: 'Per-row verdicts' })
  preview(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Body() body: DocumentImportCsvRowsDto,
  ) {
    if (!isImportableTypeId(typeId)) {
      throw new BadRequestException(
        `"${typeId}" cannot be imported - issue #340's v1 covers "invoice" and "credit-note" only.`,
      );
    }
    return this.csvService.preview(companyId, {
      typeId,
      rows: body.rows ?? [],
      files: body.files ?? {},
    });
  }

  @Post('confirm')
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: 'Confirm a CSV bulk import of documents from a previous tool',
    description:
      'Re-validates every row from scratch (never trusts a previously fetched preview) and imports ' +
      'every valid row - unlike the client CSV import, one row failing does not roll back the others ' +
      '(see document-import-csv.service.ts).',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiResponse({ status: 201, description: 'Import result' })
  confirm(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Body() body: DocumentImportCsvRowsDto,
  ) {
    if (!isImportableTypeId(typeId)) {
      throw new BadRequestException(
        `"${typeId}" cannot be imported - issue #340's v1 covers "invoice" and "credit-note" only.`,
      );
    }
    return this.csvService.confirm(companyId, {
      typeId,
      rows: body.rows ?? [],
      files: body.files ?? {},
    });
  }
}
