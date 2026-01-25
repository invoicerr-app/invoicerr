import { BadRequestException, Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import type { CreateQuoteDto, EditQuotesDto } from '@/modules/quotes/dto/quotes.dto';

import type { ISigningProvider } from '@/plugins/signing/types';
import prisma from '@/prisma/prisma.service';
import { StorageUploadService } from '@/utils/storage-upload';
import { PluginType, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { DocumentService } from '../compliance/documents/document.service';
import { QuoteDocumentData, PDFStyleConfig } from '../compliance/documents/document.types';
import { PluginsService } from '../plugins/plugins.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

@Injectable()
export class QuotesService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    private readonly pluginsService: PluginsService,
    private readonly documentService: DocumentService,
  ) {}

  async getQuotes(page: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    const whereActive = { isActive: true };

    // Parallel queries for better performance
    const [quotes, totalCount, draftCount, sentCount, signedCount, expiredCount] = await Promise.all([
      prisma.quote.findMany({
        skip,
        take: pageSize,
        where: whereActive,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          client: true,
          company: true,
        },
      }),
      prisma.quote.count({ where: whereActive }),
      prisma.quote.count({ where: { ...whereActive, status: 'DRAFT' } }),
      prisma.quote.count({ where: { ...whereActive, status: 'SENT' } }),
      prisma.quote.count({ where: { ...whereActive, status: 'SIGNED' } }),
      prisma.quote.count({ where: { ...whereActive, status: 'EXPIRED' } }),
    ]);

    // Batch fetch all payment methods in a single query (avoid N+1)
    const paymentMethodIds = quotes.map((q) => q.paymentMethodId).filter(Boolean) as string[];
    const paymentMethods = paymentMethodIds.length > 0
      ? await prisma.paymentMethod.findMany({ where: { id: { in: paymentMethodIds } } })
      : [];
    const pmMap = new Map(paymentMethods.map((pm) => [pm.id, pm]));

    const quotesWithPM = quotes.map((q) => ({
      ...q,
      paymentMethod: q.paymentMethodId ? pmMap.get(q.paymentMethodId) ?? null : null,
    }));

    return {
      pageCount: Math.ceil(totalCount / pageSize),
      quotes: quotesWithPM,
      stats: {
        total: totalCount,
        draft: draftCount,
        sent: sentCount,
        signed: signedCount,
        expired: expiredCount,
      },
    };
  }

  async searchQuotes(query: string) {
    if (!query) {
      const results = await prisma.quote.findMany({
        take: 10,
        orderBy: {
          number: 'asc',
        },
        include: {
          items: true,
          company: true,
          client: true,
        },
      });

      // Batch fetch payment methods (avoid N+1)
      const pmIds = results.map((q) => q.paymentMethodId).filter(Boolean) as string[];
      const pms = pmIds.length > 0
        ? await prisma.paymentMethod.findMany({ where: { id: { in: pmIds } } })
        : [];
      const pmMap = new Map(pms.map((pm) => [pm.id, pm]));

      return results.map((q) => ({
        ...q,
        paymentMethod: q.paymentMethodId ? pmMap.get(q.paymentMethodId) ?? null : null,
      }));
    }

    const results = await prisma.quote.findMany({
      where: {
        isActive: true,
        OR: [{ title: { contains: query } }, { client: { name: { contains: query } } }],
      },
      take: 10,
      orderBy: {
        number: 'asc',
      },
      include: {
        items: true,
        company: true,
        client: true,
      },
    });

    // Batch fetch payment methods (avoid N+1)
    const pmIds = results.map((q) => q.paymentMethodId).filter(Boolean) as string[];
    const pms = pmIds.length > 0
      ? await prisma.paymentMethod.findMany({ where: { id: { in: pmIds } } })
      : [];
    const pmMap = new Map(pms.map((pm) => [pm.id, pm]));

    return results.map((q) => ({
      ...q,
      paymentMethod: q.paymentMethodId ? pmMap.get(q.paymentMethodId) ?? null : null,
    }));
  }

  async createQuote(body: CreateQuoteDto) {
    const { items, ...data } = body;

    const company = await prisma.company.findFirst();

    if (!company) {
      logger.error('No company found. Please create a company first.', { category: 'quote' });
      throw new BadRequestException('No company found. Please create a company first.');
    }

    const client = await prisma.client.findUnique({
      where: { id: body.clientId },
    });

    if (!client) {
      logger.error('Client not found', { category: 'quote', details: { clientId: body.clientId } });
      throw new BadRequestException('Client not found');
    }

    const totalHT = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    let totalVAT = items.reduce(
      (sum, item) => sum + (item.quantity * item.unitPrice * (item.vatRate || 0)) / 100,
      0,
    );
    let totalTTC = items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100),
      0,
    );

    const isVatExemptFrance = !!(
      company.exemptVat && (company.country || '').toUpperCase() === 'FRANCE'
    );
    if (isVatExemptFrance) {
      totalVAT = 0;
      totalTTC = totalHT;
    }

    const quote = await prisma.quote.create({
      data: {
        ...data,
        notes: body.notes,
        companyId: company.id,
        currency: body.currency || client.currency || company.currency,
        paymentMethod: body.paymentMethod,
        paymentDetails: body.paymentDetails,
        paymentMethodId: body.paymentMethodId,
        totalHT,
        totalVAT,
        totalTTC,
        items: {
          create: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            vatRate: isVatExemptFrance ? 0 : item.vatRate || 0,
            type: item.type,
            order: item.order || 0,
          })),
        },
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    logger.info('Quote created', {
      category: 'quote',
      details: { quoteId: quote.id, clientId: client.id },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.QUOTE_CREATED, {
        quote,
        client,
        company,
      });
    } catch (error) {
      logger.error('Failed to dispatch QUOTE_CREATED webhook', {
        category: 'quote',
        details: { error },
      });
    }

    return quote;
  }

  async editQuote(body: EditQuotesDto) {
    const { items, id, ...data } = body;

    if (!id) {
      logger.error('Quote ID is required for editing', { category: 'quote' });
      throw new BadRequestException('Quote ID is required for editing');
    }

    const existingQuote = await prisma.quote.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingQuote) {
      logger.error('Quote not found', { category: 'quote', details: { id } });
      throw new BadRequestException('Quote not found');
    }

    const existingItemIds = existingQuote.items.map((i) => i.id);
    const incomingItemIds = items.filter((i) => i.id).map((i) => i.id!);

    const itemIdsToDelete = existingItemIds.filter((id) => !incomingItemIds.includes(id));

    const totalHT = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    let totalVAT = items.reduce(
      (sum, item) => sum + (item.quantity * item.unitPrice * (item.vatRate || 0)) / 100,
      0,
    );
    let totalTTC = items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100),
      0,
    );

    const company = await prisma.company.findFirst();
    const isVatExemptFrance = !!(
      company?.exemptVat && (company?.country || '').toUpperCase() === 'FRANCE'
    );
    if (isVatExemptFrance) {
      totalVAT = 0;
      totalTTC = totalHT;
    }

    const updateQuote = await prisma.quote.update({
      where: { id },
      data: {
        ...data,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        paymentMethod: data.paymentMethod || existingQuote.paymentMethod,
        paymentDetails: data.paymentDetails || existingQuote.paymentDetails,
        paymentMethodId: (data as any).paymentMethodId || existingQuote.paymentMethodId,
        totalHT,
        totalVAT,
        totalTTC,
        items: {
          deleteMany: {
            id: { in: itemIdsToDelete },
          },
          updateMany: items
            .filter((i) => i.id)
            .map((i) => ({
              where: { id: i.id! },
              data: {
                description: i.description,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                vatRate: isVatExemptFrance ? 0 : i.vatRate || 0,
                type: i.type,
                order: i.order || 0,
              },
            })),
          create: items
            .filter((i) => !i.id)
            .map((i) => ({
              description: i.description,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              vatRate: isVatExemptFrance ? 0 : i.vatRate || 0,
              type: i.type,
              order: i.order || 0,
            })),
        },
      },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    await prisma.signature.updateMany({
      where: { quoteId: id },
      data: { isActive: false },
    });

    logger.info('Quote updated', { category: 'quote', details: { quoteId: updateQuote.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.QUOTE_UPDATED, {
        quote: updateQuote,
        client: updateQuote.client,
        company: updateQuote.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch QUOTE_UPDATED webhook', {
        category: 'quote',
        details: { error },
      });
    }

    return updateQuote;
  }

  async deleteQuote(id: string) {
    const existingQuote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    if (!existingQuote) {
      logger.error('Quote not found', { category: 'quote', details: { id } });
      throw new BadRequestException('Quote not found');
    }

    const deletedQuote = await prisma.quote.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Quote deleted', { category: 'quote', details: { quoteId: id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.QUOTE_DELETED, {
        quote: existingQuote,
        client: existingQuote.client,
        company: existingQuote.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch QUOTE_DELETED webhook', {
        category: 'quote',
        details: { error },
      });
    }

    return deletedQuote;
  }

  async getQuotePdf(id: string): Promise<Uint8Array> {
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
        company: {
          include: { pdfConfig: true },
        },
      },
    });

    if (!quote || !quote.company || !quote.company.pdfConfig) {
      logger.error('Quote or associated PDF config not found', {
        category: 'quote',
        details: { id: quote?.id },
      });
      throw new BadRequestException('Quote or associated PDF config not found');
    }

    // Only use signing provider to generate PDF if quote is signed
    if (quote.status === 'SIGNED') {
      const provider = await this.pluginsService.getProviderByType<ISigningProvider>(
        PluginType.SIGNING,
      );
      try {
        if (provider && typeof provider.generatePdfPreview === 'function') {
          const pdf = await provider.generatePdfPreview(id);
          return pdf;
        }
      } catch (error) {
        logger.error(
          `Error generating PDF via signing provider, falling back to built-in PDF generation`,
          { category: 'quote', details: { error } },
        );
      }
    }

    const config = quote.company.pdfConfig;

    // Resolve client name
    const clientName = quote.client.name.length > 0
      ? quote.client.name
      : `${quote.client.contactFirstname} ${quote.client.contactLastname}`;

    // Resolve payment method
    let paymentMethodType = quote.paymentMethod;
    let paymentDetails = quote.paymentDetails;
    if (quote.paymentMethodId) {
      const pm = await prisma.paymentMethod.findUnique({ where: { id: quote.paymentMethodId } });
      if (pm) {
        paymentMethodType = pm.type;
        paymentDetails = pm.details || paymentDetails;
      }
    }

    // Extract identifiers from JSON field
    const companyIdentifiers = (quote.company.identifiers || {}) as Record<string, string>;
    const clientIdentifiers = (quote.client.identifiers || {}) as Record<string, string>;

    // Build DocumentData for DocumentService
    const documentData: QuoteDocumentData = {
      type: 'quote',
      id: quote.id,
      number: quote.rawNumber || quote.number.toString(),
      createdAt: quote.createdAt,
      currency: quote.currency,
      validUntil: quote.validUntil || new Date(),
      signedAt: quote.signedAt || undefined,
      supplier: {
        name: quote.company.name,
        address: quote.company.address || '',
        postalCode: quote.company.postalCode || '',
        city: quote.company.city || '',
        country: quote.company.country || '',
        countryCode: companyIdentifiers.countryCode || quote.company.country || '',
        email: quote.company.email || undefined,
        phone: quote.company.phone || undefined,
        identifiers: companyIdentifiers,
      },
      customer: {
        name: clientName,
        address: quote.client.address || '',
        postalCode: quote.client.postalCode || '',
        city: quote.client.city || '',
        country: quote.client.country || '',
        countryCode: clientIdentifiers.countryCode || quote.client.country || '',
        email: quote.client.contactEmail || undefined,
        phone: quote.client.contactPhone || undefined,
        identifiers: clientIdentifiers,
      },
      items: quote.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        vatAmount: (item.quantity * item.unitPrice * (item.vatRate || 0)) / 100,
        lineTotal: item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100),
        totalHT: item.quantity * item.unitPrice,
        totalTTC: item.quantity * item.unitPrice * (1 + (item.vatRate || 0) / 100),
        type: item.type,
      })),
      totals: {
        totalHT: quote.totalHT,
        totalVAT: quote.totalVAT,
        totalTTC: quote.totalTTC,
      },
      notes: quote.notes || undefined,
      paymentMethod: paymentMethodType
        ? { type: paymentMethodType, details: paymentDetails || undefined }
        : undefined,
    };

    // Build PDFStyleConfig from company's pdfConfig
    const pdfStyleConfig: PDFStyleConfig = {
      fontFamily: config.fontFamily,
      padding: config.padding,
      primaryColor: config.primaryColor,
      secondaryColor: config.secondaryColor,
      includeLogo: config.includeLogo,
      logoB64: config.logoB64 || undefined,
      labels: {
        invoice: config.invoice,
        quote: config.quote,
        receipt: config.receipt,
        creditNote: 'Credit Note',
        proforma: 'Proforma',
        date: config.date,
        dueDate: config.dueDate,
        validUntil: config.validUntil,
        paymentDate: config.paymentDate,
        billTo: config.billTo,
        quoteFor: config.quoteFor,
        receivedFrom: config.receivedFrom,
        description: config.description,
        quantity: config.quantity,
        unitPrice: config.unitPrice,
        vatRate: config.vatRate,
        total: config.total,
        subtotal: config.subtotal,
        vat: config.vat,
        grandTotal: config.grandTotal,
        notes: config.notes,
        paymentMethod: config.paymentMethod,
        paymentDetails: config.paymentDetails,
        hour: config.hour,
        day: config.day,
        service: config.service,
        product: config.product,
        deposit: config.deposit,
        paymentMethodBankTransfer: config.paymentMethodBankTransfer,
        paymentMethodPayPal: config.paymentMethodPayPal,
        paymentMethodCash: config.paymentMethodCash,
        paymentMethodCheck: config.paymentMethodCheck,
        paymentMethodOther: config.paymentMethodOther,
        originalInvoice: 'Original invoice:',
        correctionReason: 'Reason:',
      },
    };

    // Determine supplier country code from identifiers or country name
    const supplierCountry = companyIdentifiers.countryCode || quote.company.country || 'GENERIC';

    // Generate PDF via DocumentService
    const pdfBuffer = await this.documentService.generateDocument(
      'quote',
      documentData,
      supplierCountry,
      'pdf',
      pdfStyleConfig,
    );

    return pdfBuffer;
  }

  async markQuoteAsSigned(id: string) {
    if (!id) {
      logger.error('Quote ID is required', { category: 'quote' });
      throw new BadRequestException('Quote ID is required');
    }

    const existingQuote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    if (!existingQuote) {
      logger.error('Quote not found', { category: 'quote', details: { id } });
      throw new BadRequestException('Quote not found');
    }

    const signedQuote = await prisma.quote.update({
      where: { id },
      data: { signedAt: new Date(), status: 'SIGNED' },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    logger.info('Quote marked as signed', { category: 'quote', details: { quoteId: id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.QUOTE_SIGNED, {
        quote: signedQuote,
        client: signedQuote.client,
        company: signedQuote.company,
        signedAt: signedQuote.signedAt,
      });
    } catch (error) {
      logger.error('Failed to dispatch QUOTE_SIGNED webhook', {
        category: 'quote',
        details: { error },
      });
    }

    try {
      logger.info(`Uploading signed quote ${id} to storage providers...`, { category: 'quote' });
      const pdfBuffer = await this.getQuotePdf(id);
      const uploadedUrls = await StorageUploadService.uploadSignedQuotePdf(id, pdfBuffer);
      if (uploadedUrls.length > 0) {
        logger.info(
          `Quote ${id} successfully uploaded to ${uploadedUrls.length} storage provider(s)`,
          { category: 'quote', details: { uploadedUrls } },
        );
      }
    } catch (error) {
      logger.error(`Failed to upload signed quote ${id} to storage providers`, {
        category: 'quote',
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    return signedQuote;
  }
}
