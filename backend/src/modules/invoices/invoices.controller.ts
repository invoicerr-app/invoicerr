import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Sse, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { from, map, startWith, switchMap } from 'rxjs';
import { interval } from 'rxjs/internal/observable/interval';
import type { CreateInvoiceDto, EditInvoicesDto } from '@/modules/invoices/dto/invoices.dto';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { PluginsService } from '@/modules/plugins/plugins.service';
import { OutputFormat } from '../compliance/documents';
import { CompanyGuard } from '@/guards/company.guard';
import { CompanyId } from '@/decorators/company.decorator';

@Controller('invoices')
@UseGuards(CompanyGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly pluginService: PluginsService,
  ) {}

  @Get()
  async getInvoicesInfo(@CompanyId() companyId: string, @Query('page') page: string) {
    return await this.invoicesService.getInvoices(companyId, page);
  }

  @Sse('sse')
  async getInvoicesInfoSse(@CompanyId() companyId: string, @Query('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.invoicesService.getInvoices(companyId, page))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get('search')
  async searchInvoices(@CompanyId() companyId: string, @Query('query') query: string) {
    return await this.invoicesService.searchInvoices(companyId, query);
  }

  @Get(':id')
  async getInvoiceById(@CompanyId() companyId: string, @Param('id') id: string) {
    return await this.invoicesService.getInvoiceById(companyId, id);
  }

  @Get(':id/modification-options')
  async getModificationOptions(@CompanyId() companyId: string, @Param('id') id: string) {
    return await this.invoicesService.getModificationOptions(companyId, id);
  }

  @Get(':id/pdf')
  async getInvoicePdf(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Query('format') format: OutputFormat | undefined,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');

    const pdfBuffer = await this.invoicesService.getInvoicePdf(companyId, id, format || 'pdf');

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
    @CompanyId() companyId: string,
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
      const documentData = await this.invoicesService.getInvoiceDocument(companyId, id, xmlFormat as OutputFormat);
      xmlString = Buffer.from(documentData.buffer).toString('utf-8');
    } else {
      // Use compliance document service
      xmlString = await this.invoicesService.getInvoiceXML(companyId, id, xmlFormat);
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
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Query('format') format: OutputFormat | undefined,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');

    const pdfBuffer = await this.invoicesService.getInvoicePdf(companyId, id, format || 'pdf');

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
  createInvoiceFromQuote(@CompanyId() companyId: string, @Body('quoteId') quoteId: string) {
    return this.invoicesService.createInvoiceFromQuote(companyId, quoteId);
  }

  @Post('mark-as-paid')
  markInvoiceAsPaid(@CompanyId() companyId: string, @Body('invoiceId') invoiceId: string) {
    return this.invoicesService.markInvoiceAsPaid(companyId, invoiceId);
  }

  @Post()
  postInvoicesInfo(@CompanyId() companyId: string, @Body() body: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(companyId, body);
  }

  @Post('send')
  sendInvoiceByEmail(@CompanyId() companyId: string, @Body('id') id: string) {
    return this.invoicesService.sendInvoiceByEmail(companyId, id);
  }

  @Post(':id/credit-note')
  createCreditNote(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { correctionCode: string; reason?: string; items: Array<{ originalItemId: string; quantity: number }> },
  ) {
    return this.invoicesService.createCreditNote(companyId, id, body);
  }

  @Patch(':id')
  editInvoicesInfo(@CompanyId() companyId: string, @Param('id') id: string, @Body() body: EditInvoicesDto) {
    return this.invoicesService.editInvoice(companyId, { ...body, id });
  }

  @Delete(':id')
  deleteInvoice(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.invoicesService.deleteInvoice(companyId, id);
  }
}
