import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { logger } from '@/logger/logger.service';

import { MailService } from '@/mail/mail.service';
import type { CreateReceiptDto, EditReceiptDto } from '@/modules/receipts/dto/receipts.dto';
import prisma from '@/prisma/prisma.service';
import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { DocumentService } from '../compliance/documents/document.service';
import { ReceiptDocumentData, PDFStyleConfig } from '../compliance/documents/document.types';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

@Injectable()
export class ReceiptsService {
  private readonly logger: Logger;

  constructor(
    private readonly mailService: MailService,
    private readonly webhookDispatcher: WebhookDispatcherService,
    private readonly documentService: DocumentService,
  ) {
    this.logger = new Logger(ReceiptsService.name);
  }

  async getReceipts(companyId: string, page: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    // Filter receipts by company through the invoice relation
    const whereCompany = { invoice: { companyId } };

    // Parallel queries for better performance
    const [receipts, totalCount] = await Promise.all([
      prisma.receipt.findMany({
        skip,
        take: pageSize,
        where: whereCompany,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          invoice: {
            include: {
              items: true,
              client: true,
              quote: true,
            },
          },
        },
      }),
      prisma.receipt.count({ where: whereCompany }),
    ]);

    // Batch fetch all payment methods in a single query (avoid N+1)
    const paymentMethodIds = receipts.map((r) => r.paymentMethodId).filter(Boolean) as string[];
    const paymentMethods = paymentMethodIds.length > 0
      ? await prisma.paymentMethod.findMany({ where: { id: { in: paymentMethodIds }, companyId } })
      : [];
    const pmMap = new Map(paymentMethods.map((pm) => [pm.id, pm]));

    const receiptsWithPM = receipts.map((r) => ({
      ...r,
      paymentMethod: r.paymentMethodId ? pmMap.get(r.paymentMethodId) ?? null : null,
    }));

    return {
      pageCount: Math.ceil(totalCount / pageSize),
      receipts: receiptsWithPM,
      stats: {
        total: totalCount,
      },
    };
  }

  async searchReceipts(companyId: string, query: string) {
    if (!query) {
      const results = await prisma.receipt.findMany({
        where: { invoice: { companyId } },
        take: 10,
        orderBy: {
          number: 'asc',
        },
        include: {
          items: true,
          invoice: {
            include: {
              client: true,
              quote: true,
            },
          },
        },
      });

      // Batch fetch payment methods (avoid N+1)
      const pmIds = results.map((r) => r.paymentMethodId).filter(Boolean) as string[];
      const pms = pmIds.length > 0
        ? await prisma.paymentMethod.findMany({ where: { id: { in: pmIds }, companyId } })
        : [];
      const pmMap = new Map(pms.map((pm) => [pm.id, pm]));

      return results.map((r) => ({
        ...r,
        paymentMethod: r.paymentMethodId ? pmMap.get(r.paymentMethodId) ?? null : null,
      }));
    }

    const results = await prisma.receipt.findMany({
      where: {
        invoice: { companyId },
        OR: [
          { invoice: { quote: { title: { contains: query } } } },
          { invoice: { client: { name: { contains: query } } } },
        ],
      },
      take: 10,
      orderBy: {
        number: 'asc',
      },
      include: {
        items: true,
        invoice: {
          include: {
            client: true,
            quote: true,
          },
        },
      },
    });

    // Batch fetch payment methods (avoid N+1)
    const pmIds = results.map((r) => r.paymentMethodId).filter(Boolean) as string[];
    const pms = pmIds.length > 0
      ? await prisma.paymentMethod.findMany({ where: { id: { in: pmIds }, companyId } })
      : [];
    const pmMap = new Map(pms.map((pm) => [pm.id, pm]));

    return results.map((r) => ({
      ...r,
      paymentMethod: r.paymentMethodId ? pmMap.get(r.paymentMethodId) ?? null : null,
    }));
  }

  private async checkInvoiceAfterReceipt(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      logger.error('Invoice not found', { category: 'receipt', details: { invoiceId } });
      throw new BadRequestException('Invoice not found');
    }

    if (invoice.status === 'UNPAID') {
      const receipts = await prisma.receipt.findMany({
        where: { invoiceId },
        select: { totalPaid: true },
      });

      const totalPaid = receipts.reduce((sum, receipt) => sum + receipt.totalPaid, 0);
      if (totalPaid >= invoice.totalTTC) {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: 'PAID' },
        });
      } else {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: 'UNPAID' },
        });
      }
    }
  }

  async createReceipt(companyId: string, body: CreateReceiptDto) {
    // Verify invoice belongs to the company (multi-tenant check)
    const invoice = await prisma.invoice.findFirst({
      where: { id: body.invoiceId, companyId },
      include: {
        company: true,
        client: true,
        items: true,
      },
    });

    if (!invoice) {
      logger.error('Invoice not found', {
        category: 'receipt',
        details: { invoiceId: body.invoiceId, companyId },
      });
      throw new BadRequestException('Invoice not found');
    }

    const receipt = await prisma.receipt.create({
      data: {
        invoiceId: body.invoiceId,
        items: {
          create: body.items.map((item) => ({
            invoiceItemId: item.invoiceItemId,
            amountPaid: +item.amountPaid,
          })),
        },
        totalPaid: body.items.reduce((sum, item) => sum + +item.amountPaid, 0),
        paymentMethodId: body.paymentMethodId,
        paymentMethod: body.paymentMethod,
        paymentDetails: body.paymentDetails,
      },
      include: {
        items: true,
      },
    });

    await this.checkInvoiceAfterReceipt(invoice.id);

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_CREATED, {
        receipt,
        invoice,
        client: invoice.client,
        company: invoice.company,
      });
    } catch (error) {
      this.logger.error('Failed to dispatch RECEIPT_CREATED webhook', error);
    }

    logger.info('Receipt created', {
      category: 'receipt',
      details: { receiptId: receipt.id, companyId: invoice.company?.id },
    });

    return receipt;
  }

  async createReceiptFromInvoice(companyId: string, invoiceId: string) {
    // Verify invoice belongs to the company (multi-tenant check)
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });
    if (!invoice) {
      logger.error('Invoice not found', { category: 'receipt', details: { invoiceId, companyId } });
      throw new BadRequestException('Invoice not found');
    }

    const newReceipt = await this.createReceipt(companyId, {
      invoiceId: invoice.id,
      items: invoice.items.map((item) => ({
        invoiceItemId: item.id,
        amountPaid: (item.quantity * item.unitPrice * (1 + item.vatRate / 100)).toFixed(2),
      })),
      paymentMethodId: invoice.paymentMethodId || undefined,
      paymentMethod: invoice.paymentMethod || '',
      paymentDetails: invoice.paymentDetails || '',
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_CREATED_FROM_INVOICE, {
        receipt: newReceipt,
        invoice,
        client: invoice.client,
        company: invoice.company,
      });
    } catch (error) {
      this.logger.error('Failed to dispatch RECEIPT_CREATED_FROM_INVOICE webhook', error);
    }

    logger.info('Receipt created from invoice', {
      category: 'receipt',
      details: { receiptId: newReceipt.id, invoiceId },
    });

    return newReceipt;
  }

  async editReceipt(companyId: string, body: EditReceiptDto) {
    // Verify receipt belongs to the company through invoice (multi-tenant check)
    const existingReceipt = await prisma.receipt.findFirst({
      where: { id: body.id, invoice: { companyId } },
      include: {
        items: true,
      },
    });

    if (!existingReceipt) {
      logger.error('Receipt not found', { category: 'receipt', details: { receiptId: body.id, companyId } });
      throw new BadRequestException('Receipt not found');
    }

    const updatedReceipt = await prisma.receipt.update({
      where: { id: existingReceipt.id },
      data: {
        items: {
          deleteMany: { receiptId: existingReceipt.id },
          createMany: {
            data: body.items.map((item) => ({
              id: randomUUID(),
              invoiceItemId: item.invoiceItemId,
              amountPaid: +item.amountPaid,
            })),
          },
        },
        totalPaid: body.items.reduce((sum, item) => sum + +item.amountPaid, 0),
        paymentMethodId: body.paymentMethodId,
        paymentMethod: body.paymentMethod,
        paymentDetails: body.paymentDetails,
      },
      include: {
        items: true,
        invoice: {
          include: {
            client: true,
            company: true,
          },
        },
      },
    });

    await this.checkInvoiceAfterReceipt(existingReceipt.invoiceId);

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_UPDATED, {
        receipt: updatedReceipt,
        invoice: updatedReceipt.invoice,
        client: updatedReceipt.invoice.client,
        company: updatedReceipt.invoice.company,
      });
    } catch (error) {
      this.logger.error('Failed to dispatch RECEIPT_UPDATED webhook', error);
    }

    logger.info('Receipt updated', {
      category: 'receipt',
      details: { receiptId: updatedReceipt.id },
    });

    return updatedReceipt;
  }

  async deleteReceipt(companyId: string, id: string) {
    // Verify receipt belongs to the company through invoice (multi-tenant check)
    const existingReceipt = await prisma.receipt.findFirst({
      where: { id, invoice: { companyId } },
      include: {
        items: true,
        invoice: {
          include: {
            client: true,
            company: true,
          },
        },
      },
    });

    if (!existingReceipt) {
      logger.error('Receipt not found', { category: 'receipt', details: { receiptId: id, companyId } });
      throw new BadRequestException('Receipt not found');
    }

    await prisma.receiptItem.deleteMany({
      where: { receiptId: id },
    });

    await prisma.receipt.delete({
      where: { id },
    });

    await this.checkInvoiceAfterReceipt(existingReceipt.invoiceId);

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_DELETED, {
        receipt: existingReceipt,
        invoice: existingReceipt.invoice,
        client: existingReceipt.invoice.client,
        company: existingReceipt.invoice.company,
      });
    } catch (error) {
      this.logger.error('Failed to dispatch RECEIPT_DELETED webhook', error);
    }

    logger.info('Receipt deleted', { category: 'receipt', details: { receiptId: id } });

    return { message: 'Receipt deleted successfully' };
  }

  async getReceiptPdf(companyId: string, receiptId: string): Promise<Uint8Array> {
    // Verify receipt belongs to the company through invoice (multi-tenant check)
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, invoice: { companyId } },
      include: {
        items: true,
        invoice: {
          include: {
            items: true,
            client: true,
            company: {
              include: { pdfConfig: true },
            },
          },
        },
      },
    });

    if (!receipt) {
      logger.error('Receipt not found', { category: 'receipt', details: { receiptId, companyId } });
      throw new BadRequestException('Receipt not found');
    }

    const { pdfConfig } = receipt.invoice.company;

    // Resolve client name
    const clientName = receipt.invoice.client.name.length > 0
      ? receipt.invoice.client.name
      : `${receipt.invoice.client.contactFirstname} ${receipt.invoice.client.contactLastname}`;

    // Resolve payment method
    let paymentMethodType = receipt.paymentMethod;
    let paymentDetails = receipt.paymentDetails;
    if (receipt.paymentMethodId) {
      const pm = await prisma.paymentMethod.findUnique({ where: { id: receipt.paymentMethodId } });
      if (pm) {
        paymentMethodType = pm.type;
        paymentDetails = pm.details || paymentDetails;
      }
    }

    // Extract identifiers from JSON fields
    const companyIdentifiers = (receipt.invoice.company.identifiers || {}) as Record<string, string>;
    const clientIdentifiers = (receipt.invoice.client.identifiers || {}) as Record<string, string>;

    // Build receipt items with invoice item details
    const receiptItems = receipt.items.map((item) => {
      const invoiceItem = receipt.invoice.items.find((i) => i.id === item.invoiceItemId);
      return {
        id: item.id,
        description: invoiceItem?.description || 'N/A',
        quantity: 1,
        unitPrice: item.amountPaid,
        vatRate: invoiceItem?.vatRate || 0,
        type: invoiceItem?.type || 'SERVICE',
      };
    });

    // Build DocumentData for DocumentService
    const documentData: ReceiptDocumentData = {
      type: 'receipt',
      id: receipt.id,
      number: receipt.rawNumber || receipt.number.toString(),
      createdAt: receipt.createdAt,
      currency: receipt.invoice.currency,
      paymentDate: receipt.createdAt, // Use receipt creation date as payment date
      invoiceRef: receipt.invoice.id,
      invoiceNumber: receipt.invoice.rawNumber || receipt.invoice.number.toString(),
      supplier: {
        name: receipt.invoice.company.name,
        address: receipt.invoice.company.address || '',
        postalCode: receipt.invoice.company.postalCode || '',
        city: receipt.invoice.company.city || '',
        country: receipt.invoice.company.country || '',
        countryCode: companyIdentifiers.countryCode || receipt.invoice.company.country || '',
        email: receipt.invoice.company.email || undefined,
        phone: receipt.invoice.company.phone || undefined,
        identifiers: companyIdentifiers,
      },
      customer: {
        name: clientName,
        address: receipt.invoice.client.address || '',
        postalCode: receipt.invoice.client.postalCode || '',
        city: receipt.invoice.client.city || '',
        country: receipt.invoice.client.country || '',
        countryCode: clientIdentifiers.countryCode || receipt.invoice.client.country || '',
        email: receipt.invoice.client.contactEmail || undefined,
        phone: receipt.invoice.client.contactPhone || undefined,
        identifiers: clientIdentifiers,
      },
      items: receiptItems,
      totals: {
        totalHT: receipt.totalPaid,
        totalVAT: 0, // Receipt doesn't track VAT separately
        totalTTC: receipt.totalPaid,
      },
      paymentMethod: paymentMethodType
        ? { type: paymentMethodType, details: paymentDetails || undefined }
        : undefined,
    };

    // Build PDFStyleConfig from company's pdfConfig
    const pdfStyleConfig: PDFStyleConfig = {
      fontFamily: pdfConfig.fontFamily,
      padding: pdfConfig.padding,
      primaryColor: pdfConfig.primaryColor,
      secondaryColor: pdfConfig.secondaryColor,
      includeLogo: pdfConfig.includeLogo,
      logoB64: pdfConfig.logoB64 || undefined,
      labels: {
        invoice: pdfConfig.invoice,
        quote: pdfConfig.quote,
        receipt: pdfConfig.receipt,
        creditNote: 'Credit Note',
        proforma: 'Proforma',
        date: pdfConfig.date,
        dueDate: pdfConfig.dueDate,
        validUntil: pdfConfig.validUntil,
        paymentDate: pdfConfig.paymentDate,
        billTo: pdfConfig.billTo,
        quoteFor: pdfConfig.quoteFor,
        receivedFrom: pdfConfig.receivedFrom,
        description: pdfConfig.description,
        quantity: pdfConfig.quantity,
        unitPrice: pdfConfig.unitPrice,
        vatRate: pdfConfig.vatRate,
        total: pdfConfig.total,
        subtotal: pdfConfig.subtotal,
        vat: pdfConfig.vat,
        grandTotal: pdfConfig.grandTotal,
        notes: pdfConfig.notes,
        paymentMethod: pdfConfig.paymentMethod,
        paymentDetails: pdfConfig.paymentDetails,
        hour: pdfConfig.hour,
        day: pdfConfig.day,
        service: pdfConfig.service,
        product: pdfConfig.product,
        deposit: pdfConfig.deposit,
        paymentMethodBankTransfer: pdfConfig.paymentMethodBankTransfer,
        paymentMethodPayPal: pdfConfig.paymentMethodPayPal,
        paymentMethodCash: pdfConfig.paymentMethodCash,
        paymentMethodCheck: pdfConfig.paymentMethodCheck,
        paymentMethodOther: pdfConfig.paymentMethodOther,
        originalInvoice: 'Original invoice:',
        correctionReason: 'Reason:',
      },
    };

    // Determine supplier country code
    const supplierCountry = companyIdentifiers.countryCode || receipt.invoice.company.country || 'GENERIC';

    // Generate PDF via DocumentService
    const pdfBuffer = await this.documentService.generateDocument(
      'receipt',
      documentData,
      supplierCountry,
      'pdf',
      pdfStyleConfig,
    );

    return pdfBuffer;
  }

  async sendReceiptByEmail(companyId: string, id: string) {
    // Verify receipt belongs to the company through invoice (multi-tenant check)
    const receipt = await prisma.receipt.findFirst({
      where: { id, invoice: { companyId } },
      include: {
        invoice: {
          include: {
            client: true,
            company: true,
          },
        },
      },
    });

    if (!receipt || !receipt.invoice || !receipt.invoice.client) {
      logger.error('Receipt or associated invoice/client not found', {
        category: 'receipt',
        details: { id, companyId },
      });
      throw new BadRequestException('Receipt or associated invoice/client not found');
    }

    const pdfBuffer = await this.getReceiptPdf(companyId, id);

    const mailTemplate = await prisma.mailTemplate.findFirst({
      where: { type: 'RECEIPT' },
      select: { subject: true, body: true },
    });

    if (!mailTemplate) {
      logger.error('Email template for receipt not found.', { category: 'receipt' });
      throw new BadRequestException('Email template for receipt not found.');
    }

    const envVariables = {
      APP_URL: process.env.APP_URL,
      RECEIPT_NUMBER: receipt.rawNumber || receipt.number.toString(),
      COMPANY_NAME: receipt.invoice.company.name,
      CLIENT_NAME: receipt.invoice.client.name,
    };

    if (!receipt.invoice.client.contactEmail) {
      logger.error('Client has no email configured; receipt not sent', {
        category: 'receipt',
        details: { id },
      });
      throw new BadRequestException('Client has no email configured; receipt not sent');
    }

    const mailOptions = {
      to: receipt.invoice.client.contactEmail,
      subject: mailTemplate.subject.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
      html: mailTemplate.body.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
      attachments: [
        {
          filename: `receipt-${receipt.rawNumber || receipt.number}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    };

    try {
      await this.mailService.sendMail(mailOptions);
    } catch (error) {
      logger.error('Failed to send receipt email', { category: 'receipt', details: { error } });
      throw new BadRequestException(
        'Failed to send receipt email. Please check your SMTP configuration.',
      );
    }

    return { message: 'Receipt sent successfully' };
  }
}
