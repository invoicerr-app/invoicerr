import { BadRequestException, Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiBodyOptions, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { RequiresDocumentTypeScope, RequiresScope } from '@/utils/scope-check';

import { MAX_VENDOR_UPLOAD_BYTES } from './vendor-export-workbook';
import { VendorImportService } from './vendor-import.service';

/** The shape multer's `memoryStorage()` hands `@UploadedFile()`, as in `branding.controller.ts`. */
interface UploadedMulterFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * `memoryStorage()` keeps the upload in a Buffer: it never touches the disk, and no name from the
 * request or from inside the archive is ever used as a file path. `limits.fileSize` aborts an
 * oversized upload at the wire with a 413 before the handler runs; one file per request, no other
 * multipart field is needed.
 */
const vendorFileUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_VENDOR_UPLOAD_BYTES, files: 1, fields: 0 },
});

const FILE_BODY: ApiBodyOptions = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

@ApiTags('imports')
@Controller('imports/vendor')
export class VendorImportController {
  constructor(private readonly vendorImportService: VendorImportService) {}

  @Post('clients/file-preview')
  @RequiresScope('clients:write')
  @UseInterceptors(vendorFileUpload)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({
    summary: 'Read a client export uploaded as XLSX or ZIP',
    description:
      'Reads the workbook, or every workbook of the archive, and names the tool that produced each ' +
      'one. PDFs in the archive are skipped. Writes nothing.',
  })
  @ApiResponse({ status: 201, description: 'The workbooks read, each with the profile it matches' })
  @ApiResponse({ status: 400, description: 'Missing file, or a file that is not a readable export' })
  @ApiResponse({ status: 413, description: 'The file is over the size limit' })
  previewClientsFile(
    @ActiveCompany() _companyId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ) {
    return this.vendorImportService.previewFile('clients', requireFile(file));
  }

  @Post('documents/:typeId/file-preview')
  @RequiresDocumentTypeScope('write')
  @UseInterceptors(vendorFileUpload)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({
    summary: 'Read an invoice export uploaded as XLSX or ZIP',
    description:
      'Reads the workbook, or every workbook of the archive, and names the tool that produced each ' +
      'one. PDFs in the archive are skipped. Writes nothing. Only invoices are read from a vendor ' +
      'export.',
  })
  @ApiResponse({ status: 201, description: 'The workbooks read, each with the profile it matches' })
  @ApiResponse({ status: 400, description: 'Missing file, not an invoice, or not a readable export' })
  @ApiResponse({ status: 413, description: 'The file is over the size limit' })
  previewDocumentsFile(
    @ActiveCompany() _companyId: string,
    @Param('typeId') typeId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ) {
    // Every profile is an issued invoice; a credit note needs a reason no vendor export carries.
    if (typeId !== 'invoice') {
      throw new BadRequestException(
        'Only invoices can be read from a vendor export. Import credit notes with the generic CSV template.',
      );
    }
    return this.vendorImportService.previewFile('invoices', requireFile(file));
  }
}

function requireFile(file: UploadedMulterFile | undefined): Uint8Array {
  if (!file || file.size === 0) throw new BadRequestException('A file is required.');
  return file.buffer;
}
