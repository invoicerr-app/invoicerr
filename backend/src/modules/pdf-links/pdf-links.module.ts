import { InvoicesModule } from '@/modules/invoices/invoices.module';
import { Module } from '@nestjs/common';
import { PdfLinksController } from './pdf-links.controller';
import { PdfLinksService } from './pdf-links.service';
import { QuotesModule } from '@/modules/quotes/quotes.module';

@Module({
  imports: [QuotesModule, InvoicesModule],
  controllers: [PdfLinksController],
  providers: [PdfLinksService],
  exports: [PdfLinksService],
})
export class PdfLinksModule {}
