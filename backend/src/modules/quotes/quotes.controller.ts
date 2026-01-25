import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Sse, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { from, interval, map, startWith, switchMap } from 'rxjs';
import type { CreateQuoteDto, EditQuotesDto } from '@/modules/quotes/dto/quotes.dto';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { CompanyGuard } from '@/guards/company.guard';
import { CompanyId } from '@/decorators/company.decorator';

@Controller('quotes')
@UseGuards(CompanyGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  async getQuotesInfo(@CompanyId() companyId: string, @Query('page') page: string) {
    return await this.quotesService.getQuotes(companyId, page);
  }

  @Sse('sse')
  async getQuotesInfoSse(@CompanyId() companyId: string, @Query('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.quotesService.getQuotes(companyId, page))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get('search')
  async searchClients(@CompanyId() companyId: string, @Query('query') query: string) {
    return await this.quotesService.searchQuotes(companyId, query);
  }

  @Get(':id/pdf')
  async getQuotePdf(@CompanyId() companyId: string, @Param('id') id: string, @Res() res: Response) {
    if (id === 'undefined') return res.status(400).send('Invalid quote ID');
    const pdfBuffer = await this.quotesService.getQuotePdf(companyId, id);
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
  async markQuoteAsSigned(@CompanyId() companyId: string, @Body('id') id: string) {
    return await this.quotesService.markQuoteAsSigned(companyId, id);
  }

  @Post()
  postQuotesInfo(@CompanyId() companyId: string, @Body() body: CreateQuoteDto) {
    return this.quotesService.createQuote(companyId, body);
  }

  @Patch(':id')
  editQuotesInfo(@CompanyId() companyId: string, @Param('id') id: string, @Body() body: EditQuotesDto) {
    return this.quotesService.editQuote(companyId, { ...body, id });
  }

  @Delete(':id')
  deleteQuote(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.quotesService.deleteQuote(companyId, id);
  }
}
