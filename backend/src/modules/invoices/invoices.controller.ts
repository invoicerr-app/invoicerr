import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { from, map, startWith, switchMap } from 'rxjs';
import { interval } from 'rxjs/internal/observable/interval';
import type { CreateInvoiceDto, EditInvoicesDto } from '@/modules/invoices/dto/invoices.dto';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { PluginsService } from '@/modules/plugins/plugins.service';
import { OutputFormat } from '../compliance/documents';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly pluginService: PluginsService,
  ) {}

  @Get()
  async getInvoicesInfo(@Param('page') page: string) {
    return await this.invoicesService.getInvoices(page);
  }

  @Sse('sse')
  async getInvoicesInfoSse(@Param('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.invoicesService.getInvoices(page))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get('search')
  async searchInvoices(@Param('query') query: string) {
    return await this.invoicesService.searchInvoices(query);
  }

  @Get(':id/pdf')
  async getInvoicePdf(
    @Param('id') id: string,
    @Query('format') format: OutputFormat | undefined,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');

    const pdfBuffer = await this.invoicesService.getInvoicePdf(id, format || 'pdf');

    if (!pdfBuffer) {
      res.status(404).send('Invoice not found or PDF generation failed');
      return;
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${id}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }

  @Get(':id/download/xml')
  async downloadInvoiceXml(
    @Param('id') id: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');

    // Determine XML syntax: ubl or cii
    const xmlFormat = ['cii', 'facturx', 'zugferd'].includes(format) ? 'cii' : 'ubl';

    let xmlString: string;

    // Check if plugin can handle this format
    if (this.pluginService.canGenerateXml(format)) {
      // For plugins, get invoice data and let plugin generate XML
      const documentData = await this.invoicesService.getInvoiceDocument(id, xmlFormat as OutputFormat);
      xmlString = Buffer.from(documentData.buffer).toString('utf-8');
    } else {
      // Use compliance document service
      xmlString = await this.invoicesService.getInvoiceXML(id, xmlFormat);
    }

    const fileBuffer = Buffer.from(xmlString, 'utf-8');

    res.set({
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="invoice-${id}-${format}.xml"`,
      'Content-Length': fileBuffer.length.toString(),
    });
    res.send(fileBuffer);
  }

  @Get(':id/download/pdf')
  async downloadInvoicePdf(
    @Param('id') id: string,
    @Query('format') format: OutputFormat | undefined,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');

    const pdfBuffer = await this.invoicesService.getInvoicePdf(id, format || 'pdf');

    if (!pdfBuffer) {
      res.status(404).send('Invoice not found or PDF generation failed');
      return;
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${id}-${format || 'default'}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }

  @Post('create-from-quote')
  createInvoiceFromQuote(@Body('quoteId') quoteId: string) {
    return this.invoicesService.createInvoiceFromQuote(quoteId);
  }

  @Post('mark-as-paid')
  markInvoiceAsPaid(@Body('invoiceId') invoiceId: string) {
    return this.invoicesService.markInvoiceAsPaid(invoiceId);
  }

  @Post()
  postInvoicesInfo(@Body() body: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(body);
  }

  @Post('send')
  sendInvoiceByEmail(@Body('id') id: string) {
    return this.invoicesService.sendInvoiceByEmail(id);
  }

  @Patch(':id')
  editInvoicesInfo(@Param('id') id: string, @Body() body: EditInvoicesDto) {
    return this.invoicesService.editInvoice({ ...body, id });
  }

  @Delete(':id')
  deleteInvoice(@Param('id') id: string) {
    return this.invoicesService.deleteInvoice(id);
  }
}
