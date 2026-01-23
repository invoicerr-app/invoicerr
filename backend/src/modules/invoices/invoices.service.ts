import { EInvoice, type ExportFormat } from '@fin.cx/einvoice';
import type { finance } from '@fin.cx/einvoice/dist_ts/plugins';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { business } from '@tsclass/tsclass/dist_ts';
import * as Handlebars from 'handlebars';
import { logger } from '@/logger/logger.service';
import type { CreateInvoiceDto, EditInvoicesDto } from '@/modules/invoices/dto/invoices.dto';
import { baseTemplate } from '@/modules/invoices/templates/base.template';
import prisma from '@/prisma/prisma.service';
import { parseAddress } from '@/utils/adress';
import { formatDate } from '@/utils/date';
import { getInvertColor, getPDF } from '@/utils/pdf';
import { StorageUploadService } from '@/utils/storage-upload';
import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { ComplianceService } from '../compliance/compliance.service';
import { FormatResult, InvoiceData as ComplianceInvoiceData } from '../compliance/formats';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    private readonly complianceService: ComplianceService,
  ) {}

  async getInvoices(page: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    const invoices = await prisma.invoice.findMany({
      skip,
      take: pageSize,
      where: {
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        items: true,
        client: true,
        company: true,
      },
    });

    const totalInvoices = await prisma.invoice.count();

    // Attach payment method object when available so frontend can consume invoice.paymentMethod as an object
    const invoicesWithPM = await Promise.all(
      invoices.map(async (inv: any) => {
        if (inv.paymentMethodId) {
          const pm = await prisma.paymentMethod.findUnique({ where: { id: inv.paymentMethodId } });
          return { ...inv, paymentMethod: pm ?? inv.paymentMethod };
        }
        return inv;
      }),
    );

    return { pageCount: Math.ceil(totalInvoices / pageSize), invoices: invoicesWithPM };
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

    const resultsWithPM = await Promise.all(
      results.map(async (inv: any) => {
        if (inv.paymentMethodId) {
          const pm = await prisma.paymentMethod.findUnique({ where: { id: inv.paymentMethodId } });
          return { ...inv, paymentMethod: pm ?? inv.paymentMethod };
        }
        return inv;
      }),
    );

    return resultsWithPM;
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
    const context = await this.complianceService.buildContext({
      company: {
        countryCode: supplierCountryCode,
        VAT: company.VAT,
        exemptVat: company.exemptVat,
      },
      client: {
        countryCode: client.country ? this.extractCountryCode(client.country) : null,
        VAT: client.VAT,
        type: client.type as 'COMPANY' | 'INDIVIDUAL',
        isPublicEntity: false,
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
    const context = await this.complianceService.buildContext({
      company: {
        countryCode: supplierCountryCode,
        VAT: company.VAT,
        exemptVat: company.exemptVat,
      },
      client: {
        countryCode: client.country ? this.extractCountryCode(client.country) : null,
        VAT: client.VAT,
        type: client.type as 'COMPANY' | 'INDIVIDUAL',
        isPublicEntity: false,
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

  async getInvoicePdf(id: string): Promise<Uint8Array> {
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

    const template = Handlebars.compile(baseTemplate);

    // Default payment display values
    let paymentMethodName = invoice.paymentMethod;
    let paymentMethodDetails = invoice.paymentDetails;

    if (invoice.client.name.length === 0) {
      invoice.client.name = `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`;
    }

    const { pdfConfig } = invoice.company;

    // Map payment method enum -> PDFConfig label
    const paymentMethodLabels: Record<string, string> = {
      BANK_TRANSFER: pdfConfig.paymentMethodBankTransfer,
      PAYPAL: pdfConfig.paymentMethodPayPal,
      CASH: pdfConfig.paymentMethodCash,
      CHECK: pdfConfig.paymentMethodCheck,
      OTHER: pdfConfig.paymentMethodOther,
    };

    // Resolve payment method display values if a saved paymentMethodId is referenced
    if (invoice.paymentMethodId) {
      const pm = await prisma.paymentMethod.findUnique({ where: { id: invoice.paymentMethodId } });
      if (pm) {
        // Use configured label for the payment method type when available
        paymentMethodName = paymentMethodLabels[pm.type as string] || pm.type;
        paymentMethodDetails = pm.details || invoice.paymentDetails;
      }
    } else {
      // If paymentMethod was stored as an enum-like string (e.g. "PAYPAL"), map it to the configured label
      if (paymentMethodName && paymentMethodLabels[paymentMethodName.toUpperCase()]) {
        paymentMethodName = paymentMethodLabels[paymentMethodName.toUpperCase()];
      }
    }

    // Map item type enums to PDF label text (from pdfConfig)
    const itemTypeLabels: Record<string, string> = {
      HOUR: pdfConfig.hour,
      DAY: pdfConfig.day,
      DEPOSIT: pdfConfig.deposit,
      SERVICE: pdfConfig.service,
      PRODUCT: pdfConfig.product,
    };

    const html = template({
      number: invoice.rawNumber || invoice.number.toString(),
      date: formatDate(invoice.company, invoice.createdAt),
      dueDate: formatDate(invoice.company, invoice.dueDate),
      company: invoice.company,
      client: invoice.client,
      currency: invoice.currency,
      items: invoice.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toFixed(2),
        vatRate: (i.vatRate || 0).toFixed(2),
        totalPrice: (i.quantity * i.unitPrice * (1 + (i.vatRate || 0) / 100)).toFixed(2),
        type: itemTypeLabels[i.type] || i.type,
      })),
      totalHT: invoice.totalHT.toFixed(2),
      totalVAT: invoice.totalVAT.toFixed(2),
      totalTTC: invoice.totalTTC.toFixed(2),
      vatExemptText:
        invoice.company.exemptVat && (invoice.company.country || '').toUpperCase() === 'FRANCE'
          ? 'TVA non applicable, art. 293 B du CGI'
          : null,

      paymentMethod: paymentMethodName,
      paymentDetails: paymentMethodDetails,

      fontFamily: pdfConfig.fontFamily ?? 'Inter',
      primaryColor: pdfConfig.primaryColor ?? '#0ea5e9',
      secondaryColor: pdfConfig.secondaryColor ?? '#f3f4f6',
      tableTextColor: getInvertColor(pdfConfig.secondaryColor),
      padding: pdfConfig?.padding ?? 40,
      includeLogo: !!pdfConfig?.logoB64,
      logoB64: pdfConfig?.logoB64 ?? '',

      noteExists: !!invoice.notes,
      notes: (invoice.notes || '').replace(/\n/g, '<br>'),

      // Labels
      labels: {
        invoice: pdfConfig.invoice,
        dueDate: pdfConfig.dueDate,
        billTo: pdfConfig.billTo,
        description: pdfConfig.description,
        type: pdfConfig.type,
        quantity: pdfConfig.quantity,
        unitPrice: pdfConfig.unitPrice,
        vatRate: pdfConfig.vatRate,
        subtotal: pdfConfig.subtotal,
        total: pdfConfig.total,
        vat: pdfConfig.vat,
        grandTotal: pdfConfig.grandTotal,
        date: pdfConfig.date,
        notes: pdfConfig.notes,
        paymentMethod: pdfConfig.paymentMethod,
        paymentDetails: pdfConfig.paymentDetails,
        legalId: pdfConfig.legalId,
        VATId: pdfConfig.VATId,
        hour: pdfConfig.hour,
        day: pdfConfig.day,
        deposit: pdfConfig.deposit,
        service: pdfConfig.service,
        product: pdfConfig.product,
      },
    });

    const pdfBuffer = await getPDF(html);

    return pdfBuffer;
  }

  async getInvoiceXMLFormat(id: string): Promise<EInvoice> {
    const invRec = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
        company: {
          include: { pdfConfig: true },
        },
      },
    });

    if (!invRec) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    const inv = new EInvoice();

    const companyFoundedDate = new Date(invRec.company.foundedAt || new Date());
    const clientFoundedDate = new Date(invRec.client.foundedAt || new Date());

    inv.id = invRec.rawNumber || invRec.number.toString();
    inv.issueDate = new Date(invRec.createdAt.toISOString().split('T')[0]);
    inv.currency = (invRec.company.currency as finance.TCurrency) || 'EUR';

    let fromAdress: { streetName: string; houseNumber: string };
    try {
      fromAdress = parseAddress(invRec.company.address || '');
    } catch {
      fromAdress = {
        streetName: invRec.company.address || 'N/A',
        houseNumber: 'N/A',
      };
    }

    inv.from = {
      name: invRec.company.name,
      description: invRec.company.description || 'N/A',
      status: 'active',
      foundedDate: {
        day: companyFoundedDate.getDay(),
        month: companyFoundedDate.getMonth() + 1,
        year: companyFoundedDate.getFullYear(),
      },
      type: 'company',
      address: {
        streetName: fromAdress.streetName,
        houseNumber: fromAdress.houseNumber,
        city: invRec.company.city,
        postalCode: invRec.company.postalCode,
        country: invRec.company.country,
        countryCode: invRec.company.country,
      },
      registrationDetails: {
        vatId: invRec.company.VAT || 'N/A',
        registrationId: invRec.company.legalId || 'N/A',
        registrationName: invRec.company.name,
      },
    };

    let toAdress: { streetName: string; houseNumber: string };
    try {
      toAdress = parseAddress(invRec.client.address || '');
    } catch {
      toAdress = {
        streetName: invRec.client.address || 'N/A',
        houseNumber: 'N/A',
      };
    }

    if (invRec.client.type === 'COMPANY') {
      const companyContact: business.TCompany = {
        type: 'company',
        name: invRec.client.name || 'N/A',
        description: invRec.client.description || 'N/A',
        status: invRec.client.isActive ? 'active' : 'planned',
        foundedDate: {
          day: clientFoundedDate.getDay(),
          month: clientFoundedDate.getMonth() + 1,
          year: clientFoundedDate.getFullYear(),
        },
        address: {
          streetName: toAdress.streetName,
          houseNumber: toAdress.houseNumber,
          city: invRec.client.city,
          postalCode: invRec.client.postalCode,
          country: invRec.client.country || 'FR',
          countryCode: invRec.client.country.slice(0, 2).toUpperCase() || 'FR', // TODO: Refactor the app to store country codes instead of custom country names
        },
        registrationDetails: {
          vatId: invRec.client.VAT || 'N/A',
          registrationId: invRec.client.legalId || 'N/A',
          registrationName: invRec.client.name,
        },
      };

      inv.to = companyContact;
    } else {
      const personContact: business.TPerson = {
        type: 'person',
        name: `${invRec.client.contactFirstname} ${invRec.client.contactLastname}` || 'N/A',
        description: invRec.client.description || 'N/A',
        surname: invRec.client.contactLastname || 'N/A',
        salutation: invRec.client.salutation as 'Mr' | 'Ms' | 'Mrs',
        sex: invRec.client.sex as 'male' | 'female' | 'other',
        title: invRec.client.title as 'Doctor' | 'Professor',
        address: {
          streetName: toAdress.streetName,
          houseNumber: toAdress.houseNumber,
          city: invRec.client.city,
          postalCode: invRec.client.postalCode,
          country: invRec.client.country || 'FR',
          countryCode: invRec.client.country.slice(0, 2).toUpperCase() || 'FR', // TODO: Refactor the app to store country codes instead of custom country names
        },
      };

      inv.to = personContact;
    }

    invRec.items.forEach((item, _index) => {
      inv.addItem({
        name: item.description,
        unitQuantity: item.quantity,
        unitNetPrice: item.unitPrice,
        vatPercentage: item.vatRate || 0,
        unitType:
          item.type === 'HOUR'
            ? 'HUR'
            : item.type === 'DAY'
              ? 'DAY'
              : item.type === 'DEPOSIT'
                ? 'SET'
                : item.type === 'SERVICE'
                  ? 'C62'
                  : item.type === 'PRODUCT'
                    ? 'C62'
                    : 'C62',
      });
    });

    const validation = await inv.validate();

    logger.info(`E-Invoice validation result: ${validation.valid ? 'valid' : 'invalid'}`, {
      category: 'invoice',
    });
    logger.info(
      `E-Invoice validation warnings: ${validation.warnings ? validation.warnings.length : '0'}`,
      { category: 'invoice' },
    );
    logger.info(
      `E-Invoice validation errors: ${validation.errors ? validation.errors.length : '0'}`,
      { category: 'invoice' },
    );

    if (!validation.valid) {
      if (validation.warnings) {
        logger.warn('Validation warnings:', {
          category: 'invoice',
          details: { warnings: validation.warnings },
        });
      }

      logger.error('Validation errors:', {
        category: 'invoice',
        details: { errors: validation.errors },
      });
    }

    return inv;
  }

  async getInvoicePDFFormat(
    invoiceId: string,
    format: '' | 'pdf' | ExportFormat,
  ): Promise<Uint8Array> {
    const invRec = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, client: true, company: true, quote: true },
    });
    if (!invRec) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new BadRequestException('Invoice not found');
    }

    const pdfBuffer = await this.getInvoicePdf(invoiceId);

    if (format === 'pdf' || format === '') {
      return pdfBuffer;
    }

    const inv = await this.getInvoiceXMLFormat(invoiceId);

    return await inv.embedInPdf(Buffer.from(pdfBuffer), format);
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
    const context = await this.complianceService.buildContext({
      company: {
        countryCode: this.extractCountryCode(invoice.company.country),
        VAT: invoice.company.VAT,
        exemptVat: invoice.company.exemptVat,
      },
      client: {
        countryCode: invoice.client.country
          ? this.extractCountryCode(invoice.client.country)
          : null,
        VAT: invoice.client.VAT,
        type: invoice.client.type as 'COMPANY' | 'INDIVIDUAL',
        isPublicEntity: false, // Not tracked in current schema
      },
    });

    const rules = this.complianceService.resolveRules(context);
    const transmissionMethod = rules.transmission.platform || rules.transmission.method;

    logger.info(`Sending invoice via ${transmissionMethod}`, {
      category: 'invoice',
      details: { invoiceId, method: transmissionMethod },
    });

    const pdfBuffer = await this.getInvoicePDFFormat(
      invoiceId,
      (invoice.company.invoicePDFFormat as ExportFormat) || 'pdf',
    );

    // Use compliance transmission service with strategy pattern
    const result = await this.complianceService.sendInvoice(transmissionMethod, {
      invoiceId: invoice.id,
      invoiceNumber: invoice.rawNumber || invoice.number.toString(),
      pdfBuffer: Buffer.from(pdfBuffer),
      recipient: {
        email: invoice.client.contactEmail,
        name:
          invoice.client.name ||
          `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`,
        siret: invoice.client.legalId || undefined,
        vatNumber: invoice.client.VAT || undefined,
      },
      sender: {
        email: invoice.company.email || '',
        name: invoice.company.name,
        siret: invoice.company.legalId || undefined,
        vatNumber: invoice.company.VAT || undefined,
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
        vatNumber: invoice.company.VAT || undefined,
        legalId: invoice.company.legalId || undefined,
        address: invoice.company.address,
        postalCode: invoice.company.postalCode,
        city: invoice.company.city,
        country: supplierCountryCode,
        email: invoice.company.email,
        phone: invoice.company.phone,
      },
      customer: {
        name: invoice.client.name || `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`,
        vatNumber: invoice.client.VAT || undefined,
        legalId: invoice.client.legalId || undefined,
        address: invoice.client.address,
        postalCode: invoice.client.postalCode,
        city: invoice.client.city,
        country: invoice.client.country ? this.extractCountryCode(invoice.client.country) : supplierCountryCode,
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
        itemType: item.type === 'PRODUCT' ? 'goods' as const : 'services' as const,
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
}
