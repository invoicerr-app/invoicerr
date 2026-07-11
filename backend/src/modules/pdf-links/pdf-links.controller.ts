import { Controller, Get, Param, Res } from '@nestjs/common';

import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { PdfLinksService } from './pdf-links.service';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { Response } from 'express';

@Controller('pdf-links')
export class PdfLinksController {
  constructor(
    private readonly pdfLinksService: PdfLinksService,
    private readonly quotesService: QuotesService,
    private readonly invoicesService: InvoicesService,
  ) {}

  // Public and unauthenticated by design — the token itself (256 bits of
  // entropy, short-lived) is the only access control, so a chat user with
  // no Invoicerr account/API key can still open the link. See
  // backend/src/guards/auth.guard.ts: @AllowAnonymous() sets the same
  // metadata key our global AuthGuard checks to bypass auth entirely.
  @Get(':token')
  @AllowAnonymous()
  async download(@Param('token') token: string, @Res() res: Response) {
    const record = await this.pdfLinksService.resolveToken(token);
    if (!record) {
      res.status(404).send('Link not found or expired');
      return;
    }

    const pdfBuffer =
      record.documentType === 'QUOTE'
        ? await this.quotesService.getQuotePdf(record.documentId, record.companyId)
        : await this.invoicesService.getInvoicePdf(record.companyId, record.documentId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${record.documentType.toLowerCase()}-${record.documentId}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(Buffer.from(pdfBuffer));
  }
}
