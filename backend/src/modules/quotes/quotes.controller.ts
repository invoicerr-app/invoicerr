import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { from, interval, map, startWith, switchMap } from 'rxjs';
import type { CreateQuoteDto, EditQuotesDto } from '@/modules/quotes/dto/quotes.dto';
import { QuotesService } from '@/modules/quotes/quotes.service';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  async getQuotesInfo(@Param('page') page: string) {
    return await this.quotesService.getQuotes(page);
  }

  @Sse('sse')
  async getQuotesInfoSse(@Param('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.quotesService.getQuotes(page))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get('search')
  async searchClients(@Query('query') query: string) {
    return await this.quotesService.searchQuotes(query);
  }

  @Get(':id/pdf')
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

  @Post('/mark-as-signed')
  async markQuoteAsSigned(@Body('id') id: string) {
    return await this.quotesService.markQuoteAsSigned(id);
  }

  @Post()
  postQuotesInfo(@Body() body: CreateQuoteDto) {
    return this.quotesService.createQuote(body);
  }

  @Patch(':id')
  editQuotesInfo(@Param('id') id: string, @Body() body: EditQuotesDto) {
    return this.quotesService.editQuote({ ...body, id });
  }

  @Delete(':id')
  deleteQuote(@Param('id') id: string) {
    return this.quotesService.deleteQuote(id);
  }
}
