import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { from, interval, map, startWith, switchMap } from 'rxjs';
import type { CreateReceiptDto, EditReceiptDto } from '@/modules/receipts/dto/receipts.dto';
import { ReceiptsService } from '@/modules/receipts/receipts.service';

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  async getReceiptsInfo(@Param('page') page: string) {
    return await this.receiptsService.getReceipts(page);
  }

  @Sse('sse')
  async getReceiptsInfoSse(@Param('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.receiptsService.getReceipts(page))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get('search')
  async searchClients(@Query('query') query: string) {
    return await this.receiptsService.searchReceipts(query);
  }

  @Post('create-from-invoice')
  async createReceiptFromInvoice(@Body('id') invoiceId: string) {
    if (!invoiceId) {
      throw new Error('Invoice ID is required');
    }
    return await this.receiptsService.createReceiptFromInvoice(invoiceId);
  }

  @Get(':id/pdf')
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
  sendReceiptByEmail(@Body('id') id: string) {
    if (!id) {
      throw new Error('Receipt ID is required');
    }
    return this.receiptsService.sendReceiptByEmail(id);
  }

  @Post()
  postReceiptsInfo(@Body() body: CreateReceiptDto) {
    return this.receiptsService.createReceipt(body);
  }

  @Patch(':id')
  editReceiptsInfo(@Param('id') id: string, @Body() body: EditReceiptDto) {
    return this.receiptsService.editReceipt({ ...body, id });
  }

  @Delete(':id')
  deleteReceipt(@Param('id') id: string) {
    return this.receiptsService.deleteReceipt(id);
  }
}
