import { BadRequestException, Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { ReceivedInvoicesService, UploadReceivedInvoicePreview } from './received-invoices.service';

/**
 * Root TODO item 18's own two bespoke routes — everything else about "received-invoice" (listing,
 * the "receive"/"approve"/"reject"/"delete" actions, the descriptor itself) goes through the fully
 * generic `documents.controller.ts`/`DocumentsService`, exactly like every other document type. Only
 * uploading a file and downloading it back are genuinely NEW operations with no generic-document
 * counterpart, which is why they live here — the same reasoning
 * `company/signing-certificates/signing-certificates.controller.ts` already documents for its own
 * small, type-adjacent controller.
 */
@ApiTags('documents')
@Controller('documents/received-invoices')
export class ReceivedInvoicesController {
  constructor(private readonly receivedInvoices: ReceivedInvoicesService) {}

  /**
   * POST /api/documents/received-invoices/upload — stores the file, refuses an exact repeat (named
   * 409), and returns a best-effort extraction PREVIEW — never a persisted document (see the
   * service's own header). The frontend's upload dialog feeds this response straight into a
   * pre-filled "create received-invoice" form; nothing is saved until the user actually confirms via
   * `POST /api/documents/types/received-invoice/actions/receive`.
   */
  @Post('upload')
  @ApiOperation({
    summary: 'Upload an inbound invoice file (PDF, or XML CII/UBL, or Factur-X)',
    description:
      'Stores the file content-addressed and attempts structural field extraction — never refused ' +
      'for an unrecognized file (a plain scanned PDF still stores and returns empty fields), only ' +
      'for an exact repeat of an already-received file (same SHA-256).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', example: 'supplier-invoice-2026-08.pdf' },
        mime: { type: 'string', example: 'application/pdf' },
        base64: { type: 'string', description: 'Base64-encoded raw file bytes.' },
      },
      required: ['fileName', 'mime', 'base64'],
    },
  })
  @ApiResponse({ status: 201, description: 'File stored, extraction preview returned' })
  @ApiResponse({ status: 400, description: 'Missing fileName/mime/base64, or an empty file' })
  @ApiResponse({ status: 409, description: 'This exact file was already received (named, by hash)' })
  async upload(
    @ActiveCompany() companyId: string,
    @Body() body: { fileName?: string; mime?: string; base64?: string },
  ): Promise<UploadReceivedInvoicePreview> {
    if (!body?.fileName || !body?.mime || !body?.base64) {
      throw new BadRequestException('fileName, mime and base64 are required');
    }
    return this.receivedInvoices.upload(companyId, {
      fileName: body.fileName,
      mime: body.mime,
      base64: body.base64,
    });
  }

  /**
   * GET /api/documents/received-invoices/:id/file — the ORIGINAL uploaded bytes, verbatim, for an
   * already-saved received-invoice — the download link the list/detail screen offers next to every
   * record (frontend `custom/received-invoice-download-button.tsx`).
   */
  @Get(':id/file')
  @ApiOperation({ summary: "A received invoice's original uploaded file" })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'File bytes, verbatim',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 404, description: 'Not found for this company, or the file is no longer on disk' })
  async downloadFile(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, fileName, mime } = await this.receivedInvoices.downloadFile(companyId, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(bytes);
  }
}
