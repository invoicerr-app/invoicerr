import { CreateQuoteDto, EditQuotesDto } from '@/modules/quotes/dto/quotes.dto';
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
  Sse,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Response } from 'express';
import { from, interval, map, startWith, switchMap } from 'rxjs';

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) { }

  @Sse('sse')
  @ApiOperation({ summary: 'Subscribe to quote list updates', description: 'Server-sent event stream that pushes the list of quotes every second.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated quote list. Defaults to 1.' })
  async getQuotesInfoSse(@Query('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.quotesService.getQuotes(page))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get('search')
  @ApiOperation({ summary: 'Search quotes', description: 'Searches quotes by query string (client name, quote number, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name and quote number.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchClients(@Query('query') query: string) {
    return await this.quotesService.searchQuotes(query);
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
