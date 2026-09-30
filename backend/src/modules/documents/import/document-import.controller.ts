import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { RequiresDocumentTypeScope } from '@/utils/scope-check';

import { DocumentImportService } from './document-import.service';
import {
  ImportOriginalFileRef,
  ImportTransmissionEvidence,
  isImportableTypeId,
} from './document-import.types';

/** The single-document import request body, the per-document form's own submission
 *  (`documents.custom.importDocument` on the frontend). Plain interface, not a class-validator DTO:
 *  matching this module's own convention (no global `ValidationPipe`, see `ClientImportRowsDto`'s
 *  own comment), `DocumentImportService.importDocument` is the actual authority on every field's
 *  shape. */
export class ImportDocumentDto {
  data: Record<string, unknown>;
  originalNumber: string;
  transmissionEvidence?: ImportTransmissionEvidence;
  originalFile: ImportOriginalFileRef;
}

@ApiTags('documents')
@Controller('documents/types/:typeId/import')
export class DocumentImportController {
  constructor(private readonly importService: DocumentImportService) {}

  @Post()
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: 'Import a document issued by a previous tool',
    description:
      'Creates ONE document directly in the "imported" status - never through the ordinary create ' +
      'action, see document-import.service.ts for why. Original number and date are kept verbatim, ' +
      "no counter is consumed, and the type's own descriptor fields are validated exactly like a " +
      'normal save-draft.',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiResponse({ status: 201, description: 'Imported' })
  @ApiResponse({ status: 400, description: 'Missing original number/file, or invalid document data' })
  import(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Body() body: ImportDocumentDto,
  ) {
    if (!isImportableTypeId(typeId)) {
      throw new BadRequestException(
        `"${typeId}" cannot be imported - issue #340's v1 covers "invoice" and "credit-note" only.`,
      );
    }
    return this.importService.importDocument({
      companyId,
      typeId,
      data: body.data ?? {},
      originalNumber: body.originalNumber,
      transmissionEvidence: body.transmissionEvidence ?? {},
      originalFile: body.originalFile,
    });
  }
}
