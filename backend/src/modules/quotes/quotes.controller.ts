import { CreateQuoteDto, EditQuotesDto } from '@/modules/quotes/dto/quotes.dto';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { QuotesService } from '@/modules/quotes/quotes.service';
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
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Response } from 'express';

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly invoicesService: InvoicesService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'List quotes', description: 'Returns a paginated list of quotes.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated quote list. Defaults to 1.' })
  @ApiResponse({ status: 200, description: 'Quotes retrieved' })
  async getQuotes(@Query('page') page: string) {
    return this.quotesService.getQuotes(page);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search quotes', description: 'Searches quotes by query string (client name, quote number, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name and quote number.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchClients(@Query('query') query: string) {
    return await this.quotesService.searchQuotes(query);
  }

  @Get('table')
  @ApiOperation({ summary: 'List quotes for table view', description: 'Returns the full (unpaginated) list of quotes matching the given filters, sorted by creation date. Used by the quotes table view and its export.' })
  @ApiQuery({ name: 'clientId', required: false, type: String, description: 'Filter quotes by client ID.' })
  @ApiQuery({ name: 'year', required: false, type: String, description: 'Filter quotes created during this year.' })
  @ApiQuery({ name: 'month', required: false, type: String, description: 'Filter quotes created during this month (1-12). Ignored unless "year" is also provided.' })
  @ApiQuery({ name: 'sort', required: false, enum: ['asc', 'desc'], description: 'Sort order on creation date. Defaults to "desc".' })
  @ApiResponse({ status: 200, description: 'Quotes retrieved' })
  async getQuotesTable(
    @Query('clientId') clientId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('sort') sort?: 'asc' | 'desc',
  ) {
    return await this.quotesService.getQuotesTable({ clientId, year, month, sort });
  }

  @Get(':id/invoicing-status')
  @ApiOperation({ summary: 'Get quote invoicing status', description: 'Returns the remaining invoicable quantity per quote item and the overall remaining percentage, based on invoices already created from this quote.' })
  @ApiParam({ name: 'id', type: String, description: 'Quote ID' })
  @ApiResponse({ status: 200, description: 'Invoicing status retrieved' })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  async getQuoteInvoicingStatus(@Param('id') id: string) {
    return this.invoicesService.getQuoteInvoicingStatus(id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Get quote PDF', description: 'Downloads the PDF version of a specific quote.' })
  @ApiParam({ name: 'id', type: String, description: 'Quote ID' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  async getQuotePdf(@Param('id') id: string, @Res() res: Response) {
    if (id === 'undefined') return res.status(400).send('Invalid quote ID');
    const pdfBuffer = await this.quotesService.getQuotePdf(id);
    if (!pdfBuffer) {
      res.status(404).send('Quote not found or PDF generation failed');
      return;
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${id}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }

  @Post()
  @ApiOperation({ summary: 'Create a quote', description: 'Creates a new quote with items, client, and pricing information.' })
  @ApiResponse({ status: 201, description: 'Quote created' })
  postQuotesInfo(@Body() body: CreateQuoteDto) {
    return this.quotesService.createQuote(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a quote', description: 'Updates an existing quote by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Quote ID' })
  @ApiResponse({ status: 200, description: 'Quote updated' })
  editQuotesInfo(@Param('id') id: string, @Body() body: EditQuotesDto) {
    return this.quotesService.editQuote({ ...body, id });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a quote', description: 'Permanently removes a quote by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Quote ID' })
  @ApiResponse({ status: 200, description: 'Quote deleted' })
  deleteQuote(@Param('id') id: string) {
    return this.quotesService.deleteQuote(id);
  }
}
