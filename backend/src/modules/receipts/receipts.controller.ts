import { CreateReceiptDto, EditReceiptDto } from '@/modules/receipts/dto/receipts.dto';
import { ReceiptsService } from '@/modules/receipts/receipts.service';
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

import { Response } from 'express';

@ApiTags('receipts')
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) { }

  @Get()
  @ApiOperation({ summary: 'List receipts', description: 'Returns a paginated list of receipts.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated receipt list. Defaults to 1.' })
  @ApiResponse({ status: 200, description: 'Receipts retrieved' })
  async getReceipts(@Query('page') page: string) {
    return this.receiptsService.getReceipts(page);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search receipts', description: 'Searches receipts by query string (client name, receipt number, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name and receipt number.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchClients(@Query('query') query: string) {
    return await this.receiptsService.searchReceipts(query);
  }

  @Post('create-from-invoice')
  @ApiOperation({ summary: 'Create receipt from invoice', description: 'Generates a receipt for a paid invoice.' })
  @ApiResponse({ status: 201, description: 'Receipt created from invoice' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the invoice to create a receipt for' } } } })
  async createReceiptFromInvoice(@Body('id') invoiceId: string) {
    if (!invoiceId) {
      throw new Error('Invoice ID is required');
    }
    return await this.receiptsService.createReceiptFromInvoice(invoiceId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Get receipt PDF', description: 'Downloads the PDF version of a specific receipt.' })
  @ApiParam({ name: 'id', type: String, description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  async getReceiptPdf(@Param('id') id: string, @Res() res: Response) {
    if (id === 'undefined') return res.status(400).send('Invalid receipt ID');
    const pdfBuffer = await this.receiptsService.getReceiptPdf(id);
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
  @ApiOperation({ summary: 'Send receipt by email', description: 'Sends a receipt as a PDF attachment via email to the client.' })
  @ApiResponse({ status: 201, description: 'Receipt sent' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the receipt to send' } } } })
  sendReceiptByEmail(@Body('id') id: string) {
    if (!id) {
      throw new Error('Receipt ID is required');
    }
    return this.receiptsService.sendReceiptByEmail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a receipt', description: 'Creates a new receipt with items, client, and payment information.' })
  @ApiResponse({ status: 201, description: 'Receipt created' })
  postReceiptsInfo(@Body() body: CreateReceiptDto) {
    return this.receiptsService.createReceipt(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a receipt', description: 'Updates an existing receipt by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'Receipt updated' })
  editReceiptsInfo(@Param('id') id: string, @Body() body: EditReceiptDto) {
    return this.receiptsService.editReceipt({ ...body, id });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a receipt', description: 'Permanently removes a receipt by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'Receipt deleted' })
  deleteReceipt(@Param('id') id: string) {
    return this.receiptsService.deleteReceipt(id);
  }
}
