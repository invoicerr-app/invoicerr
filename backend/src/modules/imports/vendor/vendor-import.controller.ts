import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { RequiresDocumentTypeScope, RequiresScope } from '@/utils/scope-check';

import { VendorExportGrid } from './vendor-export.types';
import { VendorImportService } from './vendor-import.service';

/**
 * The browser has already parsed the file (the same split as both existing CSV imports). These
 * routes only answer "which tool is this, and what do its columns mean"; the preview and the write
 * stay on `POST /clients/import/preview` and `POST /documents/types/:typeId/import/csv/preview`.
 */
export class VendorExportGridDto implements VendorExportGrid {
  headers: string[];
  rows: string[][];
}

export class VendorDocumentGridDto extends VendorExportGridDto {
  /** Present for the per-type scope check; the vendor profile itself decides what the rows mean. */
  typeId: string;
}

@ApiTags('imports')
@Controller('imports/vendor')
export class VendorImportController {
  constructor(private readonly vendorImportService: VendorImportService) {}

  @Post('clients/preview')
  @RequiresScope('clients:write')
  @ApiOperation({
    summary: 'Detect and map an Abby, Henrri or Tiime client export',
    description:
      'Recognises the export by its header row and maps every row onto the existing client import ' +
      'shape. Writes nothing; a file with no known header row returns detected: false so the ' +
      'dialog can fall back to its template import.',
  })
  @ApiResponse({ status: 200, description: 'Detected profile and mapped rows' })
  previewClients(@ActiveCompany() companyId: string, @Body() body: VendorExportGridDto) {
    return this.vendorImportService.preview(companyId, 'clients', {
      headers: body.headers ?? [],
      rows: body.rows ?? [],
    });
  }

  @Post('documents/preview')
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: 'Detect and map an Abby, Henrri or Tiime invoice export',
    description:
      'Recognises the export by its header row, maps one row per document onto the existing ' +
      'past-document CSV shape and resolves each client name to a client id (exact match only). ' +
      'Writes nothing.',
  })
  @ApiResponse({ status: 200, description: 'Detected profile and mapped rows' })
  previewDocuments(@ActiveCompany() companyId: string, @Body() body: VendorDocumentGridDto) {
    // Every profile this route reads is an issued invoice. A free credit note needs a `reason` the
    // vendor exports do not carry, so it is refused here rather than after "Recognised".
    if (body.typeId !== 'invoice') {
      throw new BadRequestException(
        'Only invoices can be read from a vendor export. Import credit notes with the generic CSV template.',
      );
    }
    return this.vendorImportService.preview(companyId, 'invoices', {
      headers: body.headers ?? [],
      rows: body.rows ?? [],
    });
  }
}
