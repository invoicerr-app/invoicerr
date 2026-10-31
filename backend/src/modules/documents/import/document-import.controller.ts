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

/** The pre-fill request: only the already-uploaded file, nothing else. See
 *  `DocumentImportService.prefill`. */
export class ImportPrefillDto {
  originalFile: ImportOriginalFileRef;
}

@ApiTags('documents')
@Controller('documents/types/:typeId/import')
export class DocumentImportController {
  constructor(private readonly importService: DocumentImportService) {}

  @Post('prefill')
  @RequiresDocumentTypeScope('write')
  @ApiOperation({
    summary: 'Pre-fill the import form from a Factur-X, CII or UBL original',
    description:
      'Reads the original file already uploaded to this company and returns the fields the import ' +
      'form can seed (number, dates, client match or proposal, lines, totals). Writes nothing. ' +
      'Refuses with a 400 when the file is not a recognized structured invoice, when its totals do ' +
      'not add up, or when it is a credit note being imported as an invoice (or the reverse).',
  })
  @ApiParam({ name: 'typeId', type: String })
  @ApiResponse({ status: 200, description: 'Pre-fill result' })
  @ApiResponse({ status: 400, description: 'Unrecognized, inconsistent, or wrong-type file' })
  prefill(
    @ActiveCompany() companyId: string,
    @Param('typeId') typeId: string,
    @Body() body: ImportPrefillDto,
  ) {
    if (!isImportableTypeId(typeId)) {
      throw new BadRequestException(
        `"${typeId}" cannot be imported - issue #340's v1 covers "invoice" and "credit-note" only.`,
      );
    }
    if (!body?.originalFile?.fileRef) {
      throw new BadRequestException('An uploaded original file is required to pre-fill an import.');
    }
    return this.importService.prefill(companyId, typeId, body.originalFile);
  }

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
