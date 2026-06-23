import { PaymentsService } from '@/modules/payments/payments.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreatePaymentDto, EditPaymentDto } from '@/modules/payments/dto/payments.dto';

import { Response } from 'express';

@ApiTags('receipts')
@Controller('receipts')
export class ReceiptsDeprecatedController {
  constructor(private readonly paymentsService: PaymentsService) { }

  @Get()
  @ApiOperation({ summary: '[Deprecated] List receipts', description: '[Deprecated] Use GET /payments instead. Returns a paginated list of receipts.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated receipt list. Defaults to 1.' })
  @ApiResponse({ status: 200, description: 'Receipts retrieved' })
  /** @deprecated Use GET /payments instead */
  async getReceipts(@Query('page') page: string) {
    const result = await this.paymentsService.getPayments(page);
    return { pageCount: result.pageCount, receipts: result.payments };
  }

  @Get('search')
  @ApiOperation({ summary: '[Deprecated] Search receipts', description: '[Deprecated] Use GET /payments/search instead. Searches receipts by query string (client name, receipt number, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name and receipt number.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  /** @deprecated Use GET /payments/search instead */
  async searchClients(@Query('query') query: string) {
    return await this.paymentsService.searchPayments(query);
  }

  @Post('create-from-invoice')
  @ApiOperation({ summary: '[Deprecated] Create receipt from invoice', description: '[Deprecated] Use POST /payments/create-from-invoice instead. Generates a receipt for a paid invoice.' })
  @ApiResponse({ status: 201, description: 'Receipt created from invoice' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the invoice to create a receipt for' } } } })
  /** @deprecated Use POST /payments/create-from-invoice instead */
  async createReceiptFromInvoice(@Body('id') invoiceId: string) {
    if (!invoiceId) {
      throw new Error('Invoice ID is required');
    }
    return await this.paymentsService.createPaymentFromInvoice(invoiceId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: '[Deprecated] Get receipt PDF', description: '[Deprecated] Use GET /payments/:id/pdf instead. Downloads the PDF version of a specific receipt.' })
  @ApiParam({ name: 'id', type: String, description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  /** @deprecated Use GET /payments/:id/pdf instead */
  async getReceiptPdf(@Param('id') id: string, @Res() res: Response) {
    if (id === 'undefined') return res.status(400).send('Invalid receipt ID');
    const pdfBuffer = await this.paymentsService.getPaymentPdf(id);
    if (!pdfBuffer) {
      res.status(404).send('Receipt not found or PDF generation failed');
      return;
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }

  @Post('send')
  @ApiOperation({ summary: '[Deprecated] Send receipt by email', description: '[Deprecated] Use POST /payments/send instead. Sends a receipt as a PDF attachment via email to the client.' })
  @ApiResponse({ status: 201, description: 'Receipt sent' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the receipt to send' } } } })
  /** @deprecated Use POST /payments/send instead */
  sendReceiptByEmail(@Body('id') id: string) {
    if (!id) {
      throw new Error('Receipt ID is required');
    }
    return this.paymentsService.sendPaymentByEmail(id);
  }

  @Post()
  @ApiOperation({ summary: '[Deprecated] Create a receipt', description: '[Deprecated] Use POST /payments instead. Creates a new receipt with items, client, and payment information.' })
  @ApiResponse({ status: 201, description: 'Receipt created' })
  /** @deprecated Use POST /payments instead */
  postReceiptsInfo(@Body() body: CreatePaymentDto) {
    return this.paymentsService.createPayment(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[Deprecated] Update a receipt', description: '[Deprecated] Use PATCH /payments/:id instead. Updates an existing receipt by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'Receipt updated' })
  /** @deprecated Use PATCH /payments/:id instead */
  editReceiptsInfo(@Param('id') id: string, @Body() body: EditPaymentDto) {
    return this.paymentsService.editPayment({ ...body, id });
  }

  @Delete(':id')
  @ApiOperation({ summary: '[Deprecated] Delete a receipt', description: '[Deprecated] Use DELETE /payments/:id instead. Permanently removes a receipt by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'Receipt deleted' })
  /** @deprecated Use DELETE /payments/:id instead */
  deleteReceipt(@Param('id') id: string) {
    return this.paymentsService.deletePayment(id);
  }
}
