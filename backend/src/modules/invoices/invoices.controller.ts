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
import { ExportFormat } from '@fin.cx/einvoice';
import { CreateInvoiceDto, CreateInvoiceFromQuoteDto, EditInvoicesDto } from '@/modules/invoices/dto/invoices.dto';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { PluginsService } from '@/modules/plugins/plugins.service';

@ApiTags('invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly pluginService: PluginsService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'List invoices', description: 'Returns a paginated list of invoices.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated invoice list. Defaults to 1.' })
  @ApiResponse({ status: 200, description: 'Invoices retrieved' })
  async getInvoices(@Query('page') page: string) {
    return this.invoicesService.getInvoices(page);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search invoices', description: 'Searches invoices by query string (client name, invoice number, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name and item descriptions.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchInvoices(@Query('query') query: string) {
    return await this.invoicesService.searchInvoices(query);
  }

  @Get('table')
  @ApiOperation({ summary: 'List invoices for table view', description: 'Returns the full (unpaginated) list of invoices matching the given filters, sorted by creation date. Used by the invoices table view and its export.' })
  @ApiQuery({ name: 'clientId', required: false, type: String, description: 'Filter invoices by client ID.' })
  @ApiQuery({ name: 'year', required: false, type: String, description: 'Filter invoices created during this year.' })
  @ApiQuery({ name: 'month', required: false, type: String, description: 'Filter invoices created during this month (1-12). Ignored unless "year" is also provided.' })
  @ApiQuery({ name: 'sort', required: false, enum: ['asc', 'desc'], description: 'Sort order on creation date. Defaults to "desc".' })
  @ApiResponse({ status: 200, description: 'Invoices retrieved' })
  async getInvoicesTable(
    @Query('clientId') clientId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('sort') sort?: 'asc' | 'desc',
  ) {
    return await this.invoicesService.getInvoicesTable({ clientId, year, month, sort });
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Get invoice PDF', description: 'Downloads the PDF version of a specific invoice, optionally in a different format (e.g. ZUGFeRD).' })
  @ApiParam({ name: 'id', type: String, description: 'Invoice ID' })
  @ApiQuery({ name: 'format', required: false, enum: ['facturx', 'zugferd', 'xrechnung', 'ubl', 'cii'], description: 'E-invoicing format to render the PDF in. Defaults to the invoice/company configured format.' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async getInvoicePdf(
    @Param('id') id: string,
    @Query('format') format: ExportFormat | undefined,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');
    let pdfBuffer: Uint8Array | null = null;
    if (format) {
      pdfBuffer = await this.invoicesService.getInvoicePDFFormat(id, format);
    } else {
      pdfBuffer = await this.invoicesService.getInvoicePdf(id);
    }
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
  @ApiOperation({ summary: 'Download invoice as XML', description: 'Downloads an invoice in an XML e-invoicing format (e.g. XRechnung, Factur-X).' })
  @ApiParam({ name: 'id', type: String, description: 'Invoice ID' })
  @ApiQuery({ name: 'format', required: true, enum: ['facturx', 'zugferd', 'xrechnung', 'ubl', 'cii'], description: 'E-invoicing XML format to export.' })
  @ApiResponse({ status: 200, description: 'XML retrieved' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async downloadInvoiceXml(
    @Param('id') id: string,
    @Query('format') format: string | ExportFormat,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');
    let fileBuffer: Uint8Array | null = null;

    const xmlInvoice = await this.invoicesService.getInvoiceXMLFormat(id);
    let xmlString = '';
    if (this.pluginService.canGenerateXml(format)) {
      xmlString = await this.pluginService.generateXml(format, xmlInvoice);
    } else {
      xmlString = await xmlInvoice.exportXml(format as ExportFormat);
    }
    fileBuffer = Buffer.from(xmlString, 'utf-8');

    if (!fileBuffer) {
      res.status(404).send('Invoice not found or file generation failed');
      return;
    }
    res.set({
      'Content-Type': `application/xml`,
      'Content-Disposition': `attachment; filename="invoice-${id}-${format}.xml"`,
      'Content-Length': fileBuffer.length.toString(),
    });
    res.send(fileBuffer);
  }

  @Get(':id/download/pdf')
  @ApiOperation({ summary: 'Download invoice PDF', description: 'Downloads an invoice PDF, optionally in a specific format. Similar to GET :id/pdf but with a download-friendly Content-Disposition.' })
  @ApiParam({ name: 'id', type: String, description: 'Invoice ID' })
  @ApiQuery({ name: 'format', required: false, enum: ['facturx', 'zugferd', 'xrechnung', 'ubl', 'cii'], description: 'E-invoicing format to render the PDF in. Defaults to the invoice/company configured format.' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async downloadInvoicePdf(
    @Param('id') id: string,
    @Query('format') format: ExportFormat | undefined,
    @Res() res: Response,
  ) {
    if (id === 'undefined') return res.status(400).send('Invalid invoice ID');
    let pdfBuffer: Uint8Array | null = null;
    if (format) {
      pdfBuffer = await this.invoicesService.getInvoicePDFFormat(id, format);
    } else {
      pdfBuffer = await this.invoicesService.getInvoicePdf(id);
    }
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
  @ApiOperation({ summary: 'Create invoice from quote', description: 'Generates a new invoice based on an existing quote, with a partial selection of items and quantities.' })
  @ApiResponse({ status: 201, description: 'Invoice created from quote' })
  @ApiBody({ schema: { type: 'object', properties: { quoteId: { type: 'string', description: 'ID of the quote to convert to an invoice' }, items: { type: 'array', items: { type: 'object', properties: { quoteItemId: { type: 'string' }, quantity: { type: 'number' } } }, description: 'Quote items to invoice with their requested quantities' } } } })
  createInvoiceFromQuote(@Body() body: CreateInvoiceFromQuoteDto) {
    return this.invoicesService.createInvoiceFromQuote(body);
  }

  @Post()
  @ApiOperation({ summary: 'Create an invoice', description: 'Creates a new invoice with items, client, and pricing information.' })
  @ApiResponse({ status: 201, description: 'Invoice created' })
  postInvoicesInfo(@Body() body: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(body);
  }

  @Post('archive')
  @ApiOperation({ summary: 'Archive invoice', description: 'Archives a paid invoice.' })
  @ApiResponse({ status: 201, description: 'Invoice archived' })
  @ApiBody({ schema: { type: 'object', properties: { invoiceId: { type: 'string', description: 'ID of the invoice to archive' } } } })
  archiveInvoice(@Body('invoiceId') invoiceId: string) {
    return this.invoicesService.archiveInvoice(invoiceId);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send invoice by email', description: 'Sends an invoice as a PDF attachment via email to the client.' })
  @ApiResponse({ status: 201, description: 'Invoice sent' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the invoice to send' } } } })
  sendInvoiceByEmail(@Body('id') id: string) {
    return this.invoicesService.sendInvoiceByEmail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an invoice', description: 'Updates an existing invoice by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Invoice ID' })
  @ApiResponse({ status: 200, description: 'Invoice updated' })
  editInvoicesInfo(@Param('id') id: string, @Body() body: EditInvoicesDto) {
    return this.invoicesService.editInvoice({ ...body, id });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an invoice', description: 'Permanently removes an invoice by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Invoice ID' })
  @ApiResponse({ status: 200, description: 'Invoice deleted' })
  deleteInvoice(@Param('id') id: string) {
    return this.invoicesService.deleteInvoice(id);
  }
}
