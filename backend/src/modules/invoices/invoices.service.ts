import { BadRequestException, Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import type { CreateInvoiceDto, EditInvoicesDto } from '@/modules/invoices/dto/invoices.dto';
import prisma from '@/prisma/prisma.service';
import { formatDate } from '@/utils/date';
import { StorageUploadService } from '@/utils/storage-upload';
import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { ComplianceService } from '../compliance/compliance.service';
import {
  DocumentService,
  OutputFormat,
  InvoiceDocumentData,
  DocumentItem,
  DocumentParty,
} from '../compliance/documents';
import { InvoiceData as ComplianceInvoiceData, FormatResult } from '../compliance/formats';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

/**
 * Extract VAT number from identifiers JSON field
 */
function extractVAT(identifiers: unknown): string | null {
  if (!identifiers || typeof identifiers !== 'object') return null;
  const ids = identifiers as Record<string, string>;
  return ids.vat || ids.VAT || null;
}

/**
 * Extract legal ID (first non-VAT identifier) from identifiers JSON field
 */
function extractLegalId(identifiers: unknown): string | null {
  if (!identifiers || typeof identifiers !== 'object') return null;
  const ids = identifiers as Record<string, string>;
  // Return SIRET if present (common for France), otherwise first non-VAT identifier
  if (ids.siret) return ids.siret;
  for (const [key, value] of Object.entries(ids)) {
    if (key.toLowerCase() !== 'vat' && value) return value;
  }
  return null;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    private readonly complianceService: ComplianceService,
    private readonly documentService: DocumentService,
  ) {}

  async getInvoices(page: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    const whereActive = { isActive: true };

    // Parallel queries for better performance
    const [invoices, totalCount, sentCount, paidCount, overdueCount] = await Promise.all([
      prisma.invoice.findMany({
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
      prisma.invoice.count({ where: whereActive }),
      prisma.invoice.count({ where: { ...whereActive, status: 'SENT' } }),
      prisma.invoice.count({ where: { ...whereActive, status: 'PAID' } }),
      prisma.invoice.count({ where: { ...whereActive, status: 'OVERDUE' } }),
    ]);

    // Batch fetch all payment methods in a single query (avoid N+1)
    const paymentMethodIds = invoices.map((inv) => inv.paymentMethodId).filter(Boolean) as string[];
    const paymentMethods = paymentMethodIds.length > 0
      ? await prisma.paymentMethod.findMany({ where: { id: { in: paymentMethodIds } } })
      : [];
    const pmMap = new Map(paymentMethods.map((pm) => [pm.id, pm]));

    const invoicesWithPM = invoices.map((inv) => ({
      ...inv,
      paymentMethod: inv.paymentMethodId ? pmMap.get(inv.paymentMethodId) ?? null : null,
    }));

    return {
      pageCount: Math.ceil(totalCount / pageSize),
      invoices: invoicesWithPM,
      stats: {
        total: totalCount,
        sent: sentCount,
        paid: paidCount,
        overdue: overdueCount,
      },
    };
  }

  async searchInvoices(query: string) {
    if (query === '') {
      return this.getInvoices('1'); // Return first page if query is empty
    }

    const results = await prisma.invoice.findMany({
      where: {
        OR: [
          { client: { name: { contains: query } } },
          { items: { some: { description: { contains: query } } } },
        ],
      },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    // Batch fetch payment methods (avoid N+1)
    const pmIds = results.map((inv) => inv.paymentMethodId).filter(Boolean) as string[];
    const pms = pmIds.length > 0
      ? await prisma.paymentMethod.findMany({ where: { id: { in: pmIds } } })
      : [];
    const pmMap = new Map(pms.map((pm) => [pm.id, pm]));

    return results.map((inv) => ({
      ...inv,
      paymentMethod: inv.paymentMethodId ? pmMap.get(inv.paymentMethodId) ?? null : null,
    }));
  }

  async createInvoice(body: CreateInvoiceDto) {
    const { items, ...data } = body;

    const company = await prisma.company.findFirst();
    if (!company) {
      logger.error('No company found. Please create a company first.', { category: 'invoice' });
      throw new BadRequestException('No company found. Please create a company first.');
    }

    const client = await prisma.client.findUnique({
      where: { id: body.clientId },
    });
    if (!client) {
      logger.error('Client not found', { category: 'invoice' });
      throw new BadRequestException('Client not found');
    }

    // Build compliance context and resolve rules
    const supplierCountryCode = this.extractCountryCode(company.country);
    const companyIdentifiers = company.identifiers as Record<string, string> | null;
    const clientIdentifiers = client.identifiers as Record<string, string> | null;
    const context = await this.complianceService.buildContext({
      company: {
        countryCode: supplierCountryCode,
        VAT: extractVAT(companyIdentifiers),
        exemptVat: company.exemptVat,
        identifiers: companyIdentifiers || {},
      },
      client: {
        countryCode: client.country ? this.extractCountryCode(client.country) : null,
        VAT: extractVAT(clientIdentifiers),
        type: client.type as 'COMPANY' | 'INDIVIDUAL',
        isPublicEntity: false,
        identifiers: clientIdentifiers || {},
      },
      items: items.map((i) => ({ type: i.type })),
    });

    const rules = this.complianceService.resolveRules(context);
    const countryConfig = this.complianceService.getConfig(supplierCountryCode);

    // Calculate VAT using compliance engine with country-specific rounding mode
    const vatResult = this.complianceService.calculateVAT(
      items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: rules.vat.reverseCharge ? 0 : item.vatRate || rules.vat.defaultRate,
      })),
      {
        rates: rules.vat.rates,
        defaultRate: rules.vat.defaultRate,
        reverseCharge: rules.vat.reverseCharge,
        roundingMode: countryConfig.vat.roundingMode,
      },
    );

    const invoice = await prisma.invoice.create({
      data: {
        ...data,
        recurringInvoiceId: body.recurringInvoiceId,
        paymentMethod: body.paymentMethod,
        paymentDetails: body.paymentDetails,
        paymentMethodId: body.paymentMethodId,
        currency: body.currency || client.currency || company.currency,
        companyId: company.id,
        totalHT: vatResult.totalHT,
        totalVAT: vatResult.totalVAT,
        totalTTC: vatResult.totalTTC,
        items: {
          create: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            vatRate: rules.vat.reverseCharge ? 0 : item.vatRate || rules.vat.defaultRate,
            type: item.type,
            order: item.order || 0,
          })),
        },
        dueDate: data.dueDate
          ? new Date(data.dueDate)
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    logger.info('Invoice created', {
      category: 'invoice',
      details: { invoiceId: invoice.id, clientId: client.id },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_CREATED, {
        invoice,
        client,
        company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_CREATED webhook', {
        category: 'invoice',
        details: { error },
      });
    }

    return invoice;
  }

  async editInvoice(body: EditInvoicesDto) {
    const { items, id, ...data } = body;

    if (!id) {
      logger.error('Invoice ID is required for editing', { category: 'invoice' });
      throw new BadRequestException('Invoice ID is required for editing');
    }

    const company = await prisma.company.findFirst();
    if (!company) {
      logger.error('No company found. Please create a company first.', { category: 'invoice' });
      throw new BadRequestException('No company found. Please create a company first.');
    }

    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
    });
    if (!client) {
      logger.error('Client not found', { category: 'invoice' });
      throw new BadRequestException('Client not found');
    }

    const existingInvoice = await prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingInvoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    const existingItemIds = existingInvoice.items.map((i) => i.id);
    const incomingItemIds = items.filter((i) => i.id).map((i) => i.id!);

    const itemIdsToDelete = existingItemIds.filter((id) => !incomingItemIds.includes(id));

    // Build compliance context and resolve rules
    const supplierCountryCode = this.extractCountryCode(company.country);
    const companyIdentifiers = company.identifiers as Record<string, string> | null;
    const clientIdentifiers = client.identifiers as Record<string, string> | null;
    const context = await this.complianceService.buildContext({
      company: {
        countryCode: supplierCountryCode,
        VAT: extractVAT(companyIdentifiers),
        exemptVat: company.exemptVat,
        identifiers: companyIdentifiers || {},
      },
      client: {
        countryCode: client.country ? this.extractCountryCode(client.country) : null,
        VAT: extractVAT(clientIdentifiers),
        type: client.type as 'COMPANY' | 'INDIVIDUAL',
        isPublicEntity: false,
        identifiers: clientIdentifiers || {},
      },
      items: items.map((i) => ({ type: i.type })),
    });

    const rules = this.complianceService.resolveRules(context);
    const countryConfig = this.complianceService.getConfig(supplierCountryCode);

    // Calculate VAT using compliance engine with country-specific rounding mode
    const vatResult = this.complianceService.calculateVAT(
      items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: rules.vat.reverseCharge ? 0 : item.vatRate || rules.vat.defaultRate,
      })),
      {
        rates: rules.vat.rates,
        defaultRate: rules.vat.defaultRate,
        reverseCharge: rules.vat.reverseCharge,
        roundingMode: countryConfig.vat.roundingMode,
      },
    );

    const updateInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        recurringInvoiceId: data.recurringInvoiceId,
        paymentMethod: data.paymentMethod || existingInvoice.paymentMethod,
        paymentMethodId: (data as any).paymentMethodId || existingInvoice.paymentMethodId,
        paymentDetails: data.paymentDetails || existingInvoice.paymentDetails,
        quoteId: data.quoteId || existingInvoice.quoteId,
        clientId: data.clientId || existingInvoice.clientId,
        notes: data.notes,
        currency: body.currency || client.currency || company.currency,
        dueDate: data.dueDate
          ? new Date(data.dueDate)
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        totalHT: vatResult.totalHT,
        totalVAT: vatResult.totalVAT,
        totalTTC: vatResult.totalTTC,
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
                vatRate: rules.vat.reverseCharge ? 0 : i.vatRate || rules.vat.defaultRate,
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
              vatRate: rules.vat.reverseCharge ? 0 : i.vatRate || rules.vat.defaultRate,
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

    logger.info('Invoice updated', {
      category: 'invoice',
      details: { invoiceId: updateInvoice.id },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_UPDATED, {
        invoice: updateInvoice,
        client: updateInvoice.client,
        company: updateInvoice.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_UPDATED webhook', {
        category: 'invoice',
        details: { error },
      });
    }

    return updateInvoice;
  }

  async deleteInvoice(id: string) {
    const existingInvoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    if (!existingInvoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    const deletedInvoice = await prisma.invoice.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Invoice deleted', { category: 'invoice', details: { invoiceId: id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_DELETED, {
        invoice: existingInvoice,
        client: existingInvoice.client,
        company: existingInvoice.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_DELETED webhook', {
        category: 'invoice',
        details: { error },
      });
    }

    return deletedInvoice;
  }

  /**
   * Generate invoice PDF using the compliance DocumentService
   */
  async getInvoicePdf(id: string, format: OutputFormat = 'pdf'): Promise<Uint8Array> {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
        company: {
          include: { pdfConfig: true },
        },
      },
    });

    if (!invoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    // Get supplier country code
    const supplierCountryCode = this.extractCountryCode(invoice.company.country);

    // Transform invoice data to DocumentData format
    const documentData = await this.buildInvoiceDocumentData(invoice);

    // Build PDF config from company settings
    const pdfConfig = this.buildPdfConfig(invoice.company.pdfConfig);

    // Generate document using compliance DocumentService
    const result = await this.documentService.generate({
      type: 'invoice',
      data: documentData,
      format,
      supplierCountry: supplierCountryCode,
      pdfConfig,
    });

    return result.buffer;
  }

  /**
   * Get invoice document in the specified format
   * Supports: pdf, facturx, zugferd, xrechnung, ubl, cii, fatturapa
   */
  async getInvoiceDocument(
    invoiceId: string,
    format: OutputFormat = 'pdf',
  ): Promise<{ buffer: Uint8Array; mimeType: string; filename: string }> {
    const result = await this.documentService.generate({
      type: 'invoice',
      data: await this.getInvoiceDocumentData(invoiceId),
      format,
      supplierCountry: await this.getInvoiceCountry(invoiceId),
      pdfConfig: await this.getInvoicePdfConfig(invoiceId),
    });

    return {
      buffer: result.buffer,
      mimeType: result.mimeType,
      filename: result.filename,
    };
  }

  /**
   * Get invoice XML in UBL or CII format
   */
  async getInvoiceXML(invoiceId: string, format: 'ubl' | 'cii' = 'ubl'): Promise<string> {
    const result = await this.documentService.generate({
      type: 'invoice',
      data: await this.getInvoiceDocumentData(invoiceId),
      format,
      supplierCountry: await this.getInvoiceCountry(invoiceId),
    });

    return result.buffer.toString('utf-8');
  }

  /**
   * @deprecated Use getInvoiceDocument() instead
   * Legacy method - redirects to getInvoicePdf with format support
   */
  async getInvoicePDFFormat(invoiceId: string, format: '' | OutputFormat): Promise<Uint8Array> {
    const outputFormat = format === '' ? 'pdf' : format;
    return this.getInvoicePdf(invoiceId, outputFormat);
  }

  async createInvoiceFromQuote(quoteId: string) {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    if (!quote) {
      logger.error('Quote not found when creating invoice from quote', {
        category: 'invoice',
        details: { quoteId },
      });
      throw new BadRequestException('Quote not found');
    }

    const newInvoice = await this.createInvoice({
      clientId: quote.clientId,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      items: quote.items,
      currency: quote.currency,
      notes: quote.notes || '',
      paymentMethodId: (quote as any).paymentMethodId || undefined,
      paymentMethod: (quote as any).paymentMethod || undefined,
      paymentDetails: (quote as any).paymentDetails || undefined,
    });

    logger.info('Invoice created from quote', {
      category: 'invoice',
      details: { invoiceId: newInvoice.id, quoteId },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_CREATED_FROM_QUOTE, {
        invoice: newInvoice,
        quote,
        client: quote.client,
        company: quote.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_CREATED_FROM_QUOTE webhook', {
        category: 'invoice',
        details: { error },
      });
    }

    return newInvoice;
  }

  async markInvoiceAsPaid(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    if (!invoice) {
      logger.error('Invoice not found when trying to mark as paid', {
        category: 'invoice',
        details: { invoiceId },
      });
      throw new BadRequestException('Invoice not found');
    }

    const paidInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    logger.info('Invoice marked as paid', { category: 'invoice', details: { invoiceId } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_MARKED_AS_PAID, {
        invoice: paidInvoice,
        client: invoice.client,
        company: invoice.company,
        paidAt: paidInvoice.paidAt,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_MARKED_AS_PAID webhook', {
        category: 'invoice',
        details: { error },
      });
    }

    try {
      logger.info(`Uploading paid invoice ${invoiceId} to storage providers...`, {
        category: 'invoice',
      });
      const pdfBuffer = await this.getInvoicePdf(invoiceId);
      const uploadedUrls = await StorageUploadService.uploadPaidInvoicePdf(invoiceId, pdfBuffer);
      if (uploadedUrls.length > 0) {
        logger.info(
          `Invoice ${invoiceId} successfully uploaded to ${uploadedUrls.length} storage provider(s)`,
          { category: 'invoice', details: { uploadedUrls } },
        );
      }
    } catch (error) {
      logger.error(`Failed to upload paid invoice ${invoiceId} to storage providers`, {
        category: 'invoice',
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    return paidInvoice;
  }

  async sendInvoice(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        company: true,
        items: true,
      },
    });

    if (!invoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    // If client has no email, skip sending and return an informative message
    if (!invoice.client?.contactEmail) {
      logger.error('Client has no email configured; invoice not sent', { category: 'invoice' });
      return { success: false, message: 'Client has no email configured; invoice not sent' };
    }

    // Build compliance context to determine transmission method
    const invoiceCompanyIdentifiers = invoice.company.identifiers as Record<string, string> | null;
    const context = await this.complianceService.buildContext({
      company: {
        countryCode: this.extractCountryCode(invoice.company.country),
        VAT: extractVAT(invoiceCompanyIdentifiers),
        exemptVat: invoice.company.exemptVat,
        identifiers: invoiceCompanyIdentifiers || {},
      },
      client: {
        countryCode: invoice.client.country
          ? this.extractCountryCode(invoice.client.country)
          : null,
        VAT: extractVAT(invoice.client.identifiers),
        type: invoice.client.type as 'COMPANY' | 'INDIVIDUAL',
        isPublicEntity: false, // Not tracked in current schema
        identifiers: (invoice.client.identifiers as Record<string, string>) || {},
      },
    });

    const rules = this.complianceService.resolveRules(context);
    const transmissionMethod = rules.transmission.platform || rules.transmission.method;

    logger.info(`Sending invoice via ${transmissionMethod}`, {
      category: 'invoice',
      details: { invoiceId, method: transmissionMethod },
    });

    const pdfBuffer = await this.getInvoicePdf(
      invoiceId,
      (invoice.company.invoicePDFFormat as OutputFormat) || 'pdf',
    );

    // Use compliance transmission service with strategy pattern
    const result = await this.complianceService.sendInvoice(transmissionMethod, {
      companyId: invoice.companyId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.rawNumber || invoice.number.toString(),
      pdfBuffer: Buffer.from(pdfBuffer),
      recipient: {
        email: invoice.client.contactEmail,
        name:
          invoice.client.name ||
          `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`,
        siret: extractLegalId(invoice.client.identifiers) || undefined,
        vatNumber: extractVAT(invoice.client.identifiers) || undefined,
      },
      sender: {
        email: invoice.company.email || '',
        name: invoice.company.name,
        siret: extractLegalId(invoice.company.identifiers) || undefined,
        vatNumber: extractVAT(invoice.company.identifiers) || undefined,
      },
      metadata: {
        totalHT: invoice.totalHT,
        totalVAT: invoice.totalVAT,
        totalTTC: invoice.totalTTC,
        currency: invoice.currency,
      },
    });

    if (result.success) {
      logger.info(`Invoice sent successfully via ${transmissionMethod}`, {
        category: 'invoice',
        details: { invoiceId, externalId: result.externalId },
      });

      try {
        await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_SENT, {
          invoice,
          client: invoice.client,
          company: invoice.company,
          sentAt: new Date(),
          transmissionMethod,
          externalId: result.externalId,
        });
      } catch (error) {
        logger.error('Failed to dispatch INVOICE_SENT webhook', {
          category: 'invoice',
          details: { error },
        });
      }
    } else {
      logger.error(`Failed to send invoice via ${transmissionMethod}`, {
        category: 'invoice',
        details: { invoiceId, errorCode: result.errorCode, message: result.message },
      });
    }

    return result;
  }

  // Backward compatibility alias
  async sendInvoiceByEmail(invoiceId: string) {
    return this.sendInvoice(invoiceId);
  }

  /**
   * Generate e-invoice XML using compliance format generators
   * Supports: UBL, Factur-X/ZUGFeRD, FatturaPA
   */
  async generateInvoiceXML(invoiceId: string): Promise<FormatResult> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    const supplierCountryCode = this.extractCountryCode(invoice.company.country);

    // Build invoice data for format generator
    const invoiceData: ComplianceInvoiceData = {
      id: invoice.id,
      number: invoice.rawNumber || invoice.number.toString(),
      issueDate: invoice.createdAt,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      totalHT: invoice.totalHT,
      totalVAT: invoice.totalVAT,
      totalTTC: invoice.totalTTC,
      supplier: {
        name: invoice.company.name,
        vatNumber: extractVAT(invoice.company.identifiers) || undefined,
        legalId: extractLegalId(invoice.company.identifiers) || undefined,
        address: invoice.company.address,
        postalCode: invoice.company.postalCode,
        city: invoice.company.city,
        country: supplierCountryCode,
        email: invoice.company.email,
        phone: invoice.company.phone,
      },
      customer: {
        name:
          invoice.client.name ||
          `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`,
        vatNumber: extractVAT(invoice.client.identifiers) || undefined,
        legalId: extractLegalId(invoice.client.identifiers) || undefined,
        address: invoice.client.address,
        postalCode: invoice.client.postalCode,
        city: invoice.client.city,
        country: invoice.client.country
          ? this.extractCountryCode(invoice.client.country)
          : supplierCountryCode,
        email: invoice.client.contactEmail || undefined,
        phone: invoice.client.contactPhone || undefined,
      },
      items: invoice.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        vatAmount: item.quantity * item.unitPrice * (item.vatRate / 100),
        lineTotal: item.quantity * item.unitPrice,
        itemType: item.type === 'PRODUCT' ? ('goods' as const) : ('services' as const),
      })),
      notes: invoice.notes || undefined,
    };

    return this.complianceService.generateInvoiceXML(invoiceData, supplierCountryCode);
  }

  /**
   * Extract ISO country code from country name
   * Maps common country names to their ISO 3166-1 alpha-2 codes
   */
  private extractCountryCode(country: string): string {
    const countryMap: Record<string, string> = {
      france: 'FR',
      germany: 'DE',
      deutschland: 'DE',
      italy: 'IT',
      italia: 'IT',
      spain: 'ES',
      españa: 'ES',
      belgium: 'BE',
      belgique: 'BE',
      netherlands: 'NL',
      portugal: 'PT',
      austria: 'AT',
      österreich: 'AT',
      switzerland: 'CH',
      suisse: 'CH',
      schweiz: 'CH',
      'united kingdom': 'GB',
      uk: 'GB',
      ireland: 'IE',
      poland: 'PL',
      polska: 'PL',
      romania: 'RO',
      'czech republic': 'CZ',
      czechia: 'CZ',
      hungary: 'HU',
      sweden: 'SE',
      denmark: 'DK',
      finland: 'FI',
      norway: 'NO',
      greece: 'GR',
      luxembourg: 'LU',
      'united states': 'US',
      usa: 'US',
      canada: 'CA',
      australia: 'AU',
      japan: 'JP',
      china: 'CN',
    };

    const normalized = country.toLowerCase().trim();

    // If already a 2-letter code, return uppercase
    if (normalized.length === 2) {
      return normalized.toUpperCase();
    }

    return countryMap[normalized] || 'FR'; // Default to France
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Document Generation Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build InvoiceDocumentData from Prisma invoice record
   */
  private async buildInvoiceDocumentData(invoice: any): Promise<InvoiceDocumentData> {
    // Resolve payment method display values
    let paymentMethodType = invoice.paymentMethod || '';
    let paymentMethodDetails = invoice.paymentDetails || '';

    if (invoice.paymentMethodId) {
      const pm = await prisma.paymentMethod.findUnique({
        where: { id: invoice.paymentMethodId },
      });
      if (pm) {
        paymentMethodType = pm.type;
        paymentMethodDetails = pm.details || '';
      }
    }

    // Build supplier party
    const supplierIdentifiers = (invoice.company.identifiers as Record<string, string>) || {};
    const supplier: DocumentParty = {
      name: invoice.company.name,
      address: invoice.company.address || '',
      postalCode: invoice.company.postalCode || '',
      city: invoice.company.city || '',
      country: this.extractCountryCode(invoice.company.country),
      email: invoice.company.email || undefined,
      phone: invoice.company.phone || undefined,
      identifiers: supplierIdentifiers,
    };

    // Build customer party
    const clientName =
      invoice.client.name ||
      `${invoice.client.contactFirstname || ''} ${invoice.client.contactLastname || ''}`.trim() ||
      'Client';

    const clientIdentifiers = (invoice.client.identifiers as Record<string, string>) || {};
    const customer: DocumentParty = {
      name: clientName,
      address: invoice.client.address || '',
      postalCode: invoice.client.postalCode || '',
      city: invoice.client.city || '',
      country: invoice.client.country
        ? this.extractCountryCode(invoice.client.country)
        : this.extractCountryCode(invoice.company.country),
      email: invoice.client.contactEmail || undefined,
      phone: invoice.client.contactPhone || undefined,
      identifiers: clientIdentifiers,
    };

    // Build items
    const items: DocumentItem[] = invoice.items.map((item: any) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate || 0,
      vatAmount: item.quantity * item.unitPrice * ((item.vatRate || 0) / 100),
      lineTotal: item.quantity * item.unitPrice,
      itemType: (item.type === 'PRODUCT' ? 'goods' : 'services') as 'goods' | 'services',
      type: item.type,
    }));

    // Build legal mentions based on compliance rules
    const legalMentions: string[] = [];
    if (invoice.company.exemptVat) {
      const countryCode = this.extractCountryCode(invoice.company.country);
      if (countryCode === 'FR') {
        legalMentions.push('TVA non applicable, art. 293 B du CGI');
      }
    }

    return {
      type: 'invoice',
      id: invoice.id,
      number: invoice.rawNumber || invoice.number.toString(),
      createdAt: invoice.createdAt,
      dueDate: invoice.dueDate,
      currency: invoice.currency || invoice.company.currency || 'EUR',
      supplier,
      customer,
      items,
      totals: {
        totalHT: invoice.totalHT,
        totalVAT: invoice.totalVAT,
        totalTTC: invoice.totalTTC,
      },
      notes: invoice.notes || undefined,
      paymentMethod: paymentMethodType
        ? { type: paymentMethodType, details: paymentMethodDetails || undefined }
        : undefined,
      legalMentions: legalMentions.length > 0 ? legalMentions : undefined,
    };
  }

  /**
   * Build PDF style config from company PDFConfig
   */
  private buildPdfConfig(pdfConfig: any) {
    if (!pdfConfig) return undefined;

    return {
      fontFamily: pdfConfig.fontFamily || 'Inter',
      padding: pdfConfig.padding || 40,
      primaryColor: pdfConfig.primaryColor || '#2563eb',
      secondaryColor: pdfConfig.secondaryColor || '#64748b',
      includeLogo: !!pdfConfig.logoB64,
      logoB64: pdfConfig.logoB64 || undefined,
      labels: {
        invoice: pdfConfig.invoice || 'Invoice',
        quote: pdfConfig.quote || 'Quote',
        receipt: pdfConfig.receipt || 'Receipt',
        creditNote: pdfConfig.creditNote || 'Credit Note',
        proforma: pdfConfig.proforma || 'Proforma Invoice',
        date: pdfConfig.date || 'Date:',
        dueDate: pdfConfig.dueDate || 'Due date:',
        validUntil: pdfConfig.validUntil || 'Valid until:',
        paymentDate: pdfConfig.paymentDate || 'Payment date:',
        billTo: pdfConfig.billTo || 'Bill to:',
        quoteFor: pdfConfig.quoteFor || 'Quote for:',
        receivedFrom: pdfConfig.receivedFrom || 'Received from:',
        description: pdfConfig.description || 'Description',
        quantity: pdfConfig.quantity || 'Qty',
        unitPrice: pdfConfig.unitPrice || 'Unit price',
        vatRate: pdfConfig.vatRate || 'VAT (%)',
        total: pdfConfig.total || 'Total',
        subtotal: pdfConfig.subtotal || 'Subtotal:',
        vat: pdfConfig.vat || 'VAT:',
        grandTotal: pdfConfig.grandTotal || 'Grand total:',
        notes: pdfConfig.notes || 'Notes:',
        paymentMethod: pdfConfig.paymentMethod || 'Payment method:',
        paymentDetails: pdfConfig.paymentDetails || 'Payment details:',
        hour: pdfConfig.hour || 'Hour',
        day: pdfConfig.day || 'Day',
        service: pdfConfig.service || 'Service',
        product: pdfConfig.product || 'Product',
        deposit: pdfConfig.deposit || 'Deposit',
        paymentMethodBankTransfer: pdfConfig.paymentMethodBankTransfer || 'Bank transfer',
        paymentMethodPayPal: pdfConfig.paymentMethodPayPal || 'PayPal',
        paymentMethodCash: pdfConfig.paymentMethodCash || 'Cash',
        paymentMethodCheck: pdfConfig.paymentMethodCheck || 'Check',
        paymentMethodOther: pdfConfig.paymentMethodOther || 'Other',
        originalInvoice: pdfConfig.originalInvoice || 'Original invoice:',
        correctionReason: pdfConfig.correctionReason || 'Reason:',
      },
    };
  }

  /**
   * Get invoice document data by ID
   */
  private async getInvoiceDocumentData(invoiceId: string): Promise<InvoiceDocumentData> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        client: true,
        company: { include: { pdfConfig: true } },
      },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    return this.buildInvoiceDocumentData(invoice);
  }

  /**
   * Get invoice country code by ID
   */
  private async getInvoiceCountry(invoiceId: string): Promise<string> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { company: true },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    return this.extractCountryCode(invoice.company.country);
  }

  /**
   * Get invoice PDF config by ID
   */
  private async getInvoicePdfConfig(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { company: { include: { pdfConfig: true } } },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    return this.buildPdfConfig(invoice.company.pdfConfig);
  }

  /**
   * Get modification options for an invoice based on country compliance rules
   */
  async getModificationOptions(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        company: true,
        items: true,
      },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    // Build compliance context
    const invoiceCompanyIdentifiers = invoice.company.identifiers as Record<string, string> | null;
    const context = await this.complianceService.buildContext({
      company: {
        countryCode: this.extractCountryCode(invoice.company.country),
        VAT: extractVAT(invoiceCompanyIdentifiers),
        exemptVat: invoice.company.exemptVat,
        identifiers: invoiceCompanyIdentifiers || {},
      },
      client: {
        countryCode: invoice.client.country
          ? this.extractCountryCode(invoice.client.country)
          : null,
        VAT: extractVAT(invoice.client.identifiers),
        type: invoice.client.type as 'COMPANY' | 'INDIVIDUAL',
        isPublicEntity: false,
        identifiers: (invoice.client.identifiers as Record<string, string>) || {},
      },
    });

    // Get country config for correction rules
    const supplierCountry = context.supplier.countryCode;
    const countryConfig = this.complianceService.getConfig(supplierCountry);
    const correctionConfig = countryConfig?.correction;

    // Determine invoice state
    const isTransmitted = !!(invoice as any).transmittedAt || !!(invoice as any).platformId;
    const isPaid = invoice.status === 'PAID';
    // Note: CANCELLED and CREDITED statuses don't exist yet - using isActive as proxy
    const isCancelled = !invoice.isActive;
    const isCredited = false; // Would need linkedCreditNote field to track
    const isFinalState = isPaid || isCancelled;

    // Build options list with availability status
    const options: Array<{
      id: string;
      labelKey: string;
      descriptionKey: string;
      icon: string;
      available: boolean;
      reason?: string;
      route?: string;
    }> = [];

    // Option 1: Direct Edit
    const canEditDirectly = correctionConfig?.allowDirectModification !== false
      && !isTransmitted
      && !isFinalState;

    options.push({
      id: 'direct_edit',
      labelKey: 'invoices.modification.directEdit.label',
      descriptionKey: 'invoices.modification.directEdit.description',
      icon: 'edit',
      available: canEditDirectly,
      reason: !canEditDirectly
        ? (correctionConfig?.allowDirectModification === false
            ? 'invoices.modification.directEdit.disabledByCountry'
            : isTransmitted
              ? 'invoices.modification.directEdit.alreadyTransmitted'
              : 'invoices.modification.directEdit.finalState')
        : undefined,
    });

    // Option 2: Credit Note
    options.push({
      id: 'credit_note',
      labelKey: 'invoices.modification.creditNote.label',
      descriptionKey: 'invoices.modification.creditNote.description',
      icon: 'file-minus',
      available: !isCredited && !isCancelled,
      reason: isCredited
        ? 'invoices.modification.creditNote.alreadyCredited'
        : isCancelled
          ? 'invoices.modification.creditNote.cancelled'
          : undefined,
      route: `/invoices/${invoiceId}/credit-note`,
    });

    // Option 3: Corrective Invoice
    options.push({
      id: 'corrective_invoice',
      labelKey: 'invoices.modification.correctiveInvoice.label',
      descriptionKey: 'invoices.modification.correctiveInvoice.description',
      icon: 'file-edit',
      available: !isCancelled,
      reason: isCancelled
        ? 'invoices.modification.correctiveInvoice.cancelled'
        : undefined,
      route: `/invoices/${invoiceId}/corrective`,
    });

    // Option 4: Void and Reissue
    options.push({
      id: 'void_and_reissue',
      labelKey: 'invoices.modification.voidAndReissue.label',
      descriptionKey: 'invoices.modification.voidAndReissue.description',
      icon: 'refresh-cw',
      available: !isPaid && !isCancelled,
      reason: isPaid
        ? 'invoices.modification.voidAndReissue.alreadyPaid'
        : isCancelled
          ? 'invoices.modification.voidAndReissue.cancelled'
          : undefined,
      route: `/invoices/${invoiceId}/void-reissue`,
    });

    // Option 5: Cancel Invoice
    options.push({
      id: 'cancel',
      labelKey: 'invoices.modification.cancel.label',
      descriptionKey: 'invoices.modification.cancel.description',
      icon: 'x-circle',
      available: !isPaid && !isCancelled,
      reason: isPaid
        ? 'invoices.modification.cancel.alreadyPaid'
        : isCancelled
          ? 'invoices.modification.cancel.alreadyCancelled'
          : undefined,
    });

    return {
      invoiceId,
      invoiceNumber: invoice.rawNumber || invoice.number.toString(),
      invoiceStatus: invoice.status,
      countryCode: supplierCountry,
      correctionConfig: correctionConfig ? {
        allowDirectModification: correctionConfig.allowDirectModification,
        method: correctionConfig.method,
        requiresOriginalReference: correctionConfig.requiresOriginalReference,
        codes: correctionConfig.codes || [],
        requiresPreApproval: correctionConfig.requiresPreApproval || false,
      } : null,
      options,
      recommendedOption: !canEditDirectly && correctionConfig?.method
        ? correctionConfig.method
        : (canEditDirectly ? 'direct_edit' : 'credit_note'),
    };
  }

  async getInvoiceById(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        company: true,
        items: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    // Get payment method if present
    const paymentMethod = invoice.paymentMethodId
      ? await prisma.paymentMethod.findUnique({
          where: { id: invoice.paymentMethodId },
        })
      : null;

    return {
      ...invoice,
      paymentMethod,
    };
  }

  async createCreditNote(
    originalInvoiceId: string,
    data: {
      correctionCode: string;
      reason?: string;
      items: Array<{ originalItemId: string; quantity: number }>;
    },
  ) {
    const originalInvoice = await prisma.invoice.findUnique({
      where: { id: originalInvoiceId },
      include: {
        client: true,
        company: true,
        items: true,
      },
    });

    if (!originalInvoice) {
      throw new BadRequestException('Original invoice not found');
    }

    // Map items from original invoice to credit note items
    const creditNoteItems = data.items.map((creditItem) => {
      const originalItem = originalInvoice.items.find((item) => item.id === creditItem.originalItemId);
      if (!originalItem) {
        throw new BadRequestException(`Item with id ${creditItem.originalItemId} not found in original invoice`);
      }
      if (creditItem.quantity > originalItem.quantity) {
        throw new BadRequestException(`Credit quantity cannot exceed original quantity for item ${originalItem.description}`);
      }
      return {
        description: originalItem.description,
        quantity: creditItem.quantity,
        unitPrice: originalItem.unitPrice,
        vatRate: originalItem.vatRate,
        type: originalItem.type,
      };
    });

    // Calculate totals
    let totalHT = 0;
    let totalVAT = 0;
    creditNoteItems.forEach((item) => {
      const lineTotal = item.quantity * item.unitPrice;
      const lineVAT = lineTotal * (item.vatRate / 100);
      totalHT += lineTotal;
      totalVAT += lineVAT;
    });
    const totalTTC = totalHT + totalVAT;

    // Get next credit note number
    const lastCreditNote = await prisma.invoice.findFirst({
      where: {
        companyId: originalInvoice.companyId,
        rawNumber: { startsWith: 'CN-' },
      },
      orderBy: { number: 'desc' },
    });

    const year = new Date().getFullYear();
    const nextNumber = lastCreditNote
      ? lastCreditNote.number + 1
      : await this.getNextInvoiceNumber(originalInvoice.companyId);

    // Create credit note
    const creditNote = await prisma.invoice.create({
      data: {
        number: nextNumber,
        rawNumber: `CN-${year}-${String(nextNumber).padStart(4, '0')}`,
        clientId: originalInvoice.clientId,
        companyId: originalInvoice.companyId,
        currency: originalInvoice.currency,
        // Store reference to original invoice and correction info in notes
        notes: [
          data.reason || '',
          `[CREDIT_NOTE]`,
          `Original Invoice: ${originalInvoice.rawNumber || originalInvoice.number}`,
          `Correction Code: ${data.correctionCode}`,
          `Original Invoice ID: ${originalInvoiceId}`,
        ].filter(Boolean).join('\n'),
        status: 'SENT',
        dueDate: new Date(),
        totalHT: -totalHT,
        totalVAT: -totalVAT,
        totalTTC: -totalTTC,
        isActive: true,
        items: {
          create: creditNoteItems.map((item, index) => ({
            ...item,
            order: index,
            // Store negative values to represent credits
            quantity: item.quantity,
            unitPrice: -item.unitPrice, // Negative price to represent credit
          })),
        },
      },
      include: {
        client: true,
        company: true,
        items: true,
      },
    });

    // Dispatch webhook
    this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_CREATED, {
      id: creditNote.id,
      number: creditNote.rawNumber || creditNote.number.toString(),
      client: creditNote.client.name,
      totalTTC: creditNote.totalTTC,
      type: 'credit_note',
      originalInvoiceId,
    });

    logger.info('Credit note created', {
      category: 'invoice',
      details: {
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.rawNumber,
        originalInvoiceId,
        originalInvoiceNumber: originalInvoice.rawNumber,
      },
    });

    return creditNote;
  }

  private async getNextInvoiceNumber(companyId: string): Promise<number> {
    const lastInvoice = await prisma.invoice.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
    });
    return (lastInvoice?.number || 0) + 1;
  }
}
