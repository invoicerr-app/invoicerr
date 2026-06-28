import { Injectable, BadRequestException } from '@nestjs/common';
import { InvoiceMailPort } from '@/compliance/providers/transmission/invoice-mail-port';
import { MailService } from '@/mail/mail.service';
import { InvoiceRenderingService } from './invoice-rendering.service';
import { ExportFormat } from '@/compliance/providers/format/invoice-artifact-port';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

/**
 * Cycle-safe implementation of InvoiceMailPort.
 *
 * Lives in `invoice-rendering` (imported by ComplianceModule, never imports compliance).
 * Verbatim logic moved from invoices.service.ts sendInvoiceByEmail (lines 1256–1291).
 */
@Injectable()
export class InvoiceMailGateway implements InvoiceMailPort {
  constructor(
    private readonly mailService: MailService,
    private readonly rendering: InvoiceRenderingService,
  ) {}

  async sendInvoiceEmail(
    invoiceId: string,
  ): Promise<{ sent: boolean; skipped?: boolean; reason?: string }> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
        items: true,
      },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    // Guard: client must have an email
    if (!invoice.client?.contactEmail) {
      logger.error('Client has no email configured; invoice not sent', { category: 'invoice' });
      return { sent: false, skipped: true, reason: 'Client has no email configured; invoice not sent' };
    }

    // Render PDF using the company's preferred format (byte-for-byte identical to the old path)
    const pdfBuffer = await this.rendering.renderPdfFormat(
      invoiceId,
      (invoice.company.invoicePDFFormat as ExportFormat) || 'pdf',
    );

    // Lookup INVOICE mail template
    const mailTemplate = await prisma.mailTemplate.findFirst({
      where: { type: 'INVOICE' },
      select: { subject: true, body: true },
    });

    if (!mailTemplate) {
      logger.error('Email template for signature request not found.', { category: 'invoice' });
      throw new BadRequestException('Email template for signature request not found.');
    }

    const envVariables = {
      APP_URL: process.env.APP_URL,
      INVOICE_NUMBER: invoice.rawNumber || (invoice.number?.toString() ?? 'DRAFT'),
      COMPANY_NAME: invoice.company.name,
      CLIENT_NAME: invoice.client.name,
    };

    const mailOptions = {
      to: invoice.client.contactEmail,
      subject: mailTemplate.subject.replace(/{{(\w+)}}/g, (_, key: string) => envVariables[key as keyof typeof envVariables] || ''),
      html: mailTemplate.body.replace(/{{(\w+)}}/g, (_, key: string) => envVariables[key as keyof typeof envVariables] || ''),
      attachments: [
        {
          filename: `invoice-${invoice.rawNumber || invoice.number || 'draft'}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    };

    await this.mailService.sendMail(mailOptions);

    logger.info('Invoice sent by email', {
      category: 'invoice',
      details: { invoiceId, email: invoice.client.contactEmail },
    });

    return { sent: true };
  }
}
