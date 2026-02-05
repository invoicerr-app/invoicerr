import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Sse, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { from, interval, map, startWith, switchMap } from 'rxjs';
import type { CreateReceiptDto, EditReceiptDto } from '@/modules/receipts/dto/receipts.dto';
import { ReceiptsService } from '@/modules/receipts/receipts.service';
import { CompanyGuard } from '@/guards/company.guard';
import { CompanyId } from '@/decorators/company.decorator';

@Controller('receipts')
@UseGuards(CompanyGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  async getReceiptsInfo(@CompanyId() companyId: string, @Query('page') page: string) {
    return await this.receiptsService.getReceipts(companyId, page);
  }

  @Sse('sse')
  async getReceiptsInfoSse(@CompanyId() companyId: string, @Query('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.receiptsService.getReceipts(companyId, page))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get('search')
  async searchClients(@CompanyId() companyId: string, @Query('query') query: string) {
    return await this.receiptsService.searchReceipts(companyId, query);
  }

  @Post('create-from-invoice')
  async createReceiptFromInvoice(@CompanyId() companyId: string, @Body('id') invoiceId: string) {
    if (!invoiceId) {
      throw new Error('Invoice ID is required');
    }
    return await this.receiptsService.createReceiptFromInvoice(companyId, invoiceId);
  }

  @Get(':id/pdf')
  async getReceiptPdf(@CompanyId() companyId: string, @Param('id') id: string, @Res() res: Response) {
    if (id === 'undefined') return res.status(400).send('Invalid receipt ID');
    const pdfBuffer = await this.receiptsService.getReceiptPdf(companyId, id);
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
  sendReceiptByEmail(@CompanyId() companyId: string, @Body('id') id: string) {
    if (!id) {
      throw new Error('Receipt ID is required');
    }
    return this.receiptsService.sendReceiptByEmail(companyId, id);
  }

  @Post()
  postReceiptsInfo(@CompanyId() companyId: string, @Body() body: CreateReceiptDto) {
    return this.receiptsService.createReceipt(companyId, body);
  }

  @Patch(':id')
  editReceiptsInfo(@CompanyId() companyId: string, @Param('id') id: string, @Body() body: EditReceiptDto) {
    return this.receiptsService.editReceipt(companyId, { ...body, id });
  }

  @Delete(':id')
  deleteReceipt(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.receiptsService.deleteReceipt(companyId, id);
  }
}
