import * as Handlebars from 'handlebars';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateQuoteDto, EditQuotesDto } from '@/modules/quotes/dto/quotes.dto';
import { PluginType, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { getInvertColor, getPDF } from '@/utils/pdf';

import { ISigningProvider } from '@/plugins/signing/types';
import { PluginsService } from '../plugins/plugins.service';
import { StorageUploadService } from '@/utils/storage-upload';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { baseTemplate } from '@/modules/quotes/templates/base.template';
import { formatAmount } from '@/utils/format-amount';
import { formatDate } from '@/utils/date';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { calculateDiscountedTotals, clampDiscountRate } from '@/utils/financial';
import { formatNotes, formatRichText } from '@/utils/format-text';
import { getDraftWatermarkLabel } from '@/utils/watermark';

@Injectable()
export class QuotesService {
    private readonly pluginsService: PluginsService

    constructor(private readonly webhookDispatcher: WebhookDispatcherService) {
        this.pluginsService = new PluginsService();
    }

    async getQuotes(companyId: string, page: string) {
        const pageNumber = parseInt(page, 10) || 1;
        const pageSize = 10;
        const skip = (pageNumber - 1) * pageSize;

        const quotes = await prisma.quote.findMany({
            skip,
            take: pageSize,
            where: {
                companyId,
                isActive: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                items: true,
                client: true,
                company: true
            },
        });

        const totalQuotes = await prisma.quote.count({ where: { companyId } });

        // Attach payment method object when available so frontend can consume quote.paymentMethod as an object
        const quotesWithPM = await Promise.all(quotes.map(async (q: any) => {
            if (q.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: q.paymentMethodId } });
                return { ...q, paymentMethod: pm ?? q.paymentMethod };
            }
            return q;
        }));

        return { pageCount: Math.ceil(totalQuotes / pageSize), quotes: quotesWithPM };
    }

    async getQuotesTable(companyId: string, filters: { clientId?: string; year?: string; month?: string; sort?: 'asc' | 'desc' }) {
        const where: Record<string, any> = { companyId, isActive: true };

        if (filters.clientId) {
            where.clientId = filters.clientId;
        }

        const year = parseInt(filters.year ?? '', 10);
        if (!isNaN(year)) {
            const month = parseInt(filters.month ?? '', 10);
            if (!isNaN(month) && month >= 1 && month <= 12) {
                where.createdAt = {
                    gte: new Date(year, month - 1, 1),
                    lt: new Date(year, month, 1),
                };
            } else {
                where.createdAt = {
                    gte: new Date(year, 0, 1),
                    lt: new Date(year + 1, 0, 1),
                };
            }
        }

        const sort = filters.sort === 'asc' ? 'asc' : 'desc';

        const quotes = await prisma.quote.findMany({
            where,
            orderBy: {
                createdAt: sort,
            },
            include: {
                items: true,
                client: true,
                company: true,
            },
        });

        const quotesWithPM = await Promise.all(quotes.map(async (q: any) => {
            if (q.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: q.paymentMethodId } });
                return { ...q, paymentMethod: pm ?? q.paymentMethod };
            }
            return q;
        }));

        return quotesWithPM;
    }

    async searchQuotes(companyId: string, query: string) {
        if (!query) {
            const results = await prisma.quote.findMany({
                where: { companyId },
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

            const resultsWithPM = await Promise.all(results.map(async (q: any) => {
                if (q.paymentMethodId) {
                    const pm = await prisma.paymentMethod.findUnique({ where: { id: q.paymentMethodId } });
                    return { ...q, paymentMethod: pm ?? q.paymentMethod };
                }
                return q;
            }));

            return resultsWithPM;
        }

        const results = await prisma.quote.findMany({
            where: {
                companyId,
                isActive: true,
                OR: [
                    { title: { contains: query } },
                    { client: { name: { contains: query } } },
                ],
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

        const resultsWithPM = await Promise.all(results.map(async (q: any) => {
            if (q.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: q.paymentMethodId } });
                return { ...q, paymentMethod: pm ?? q.paymentMethod };
            }
            return q;
        }));

        return resultsWithPM;
    }

    async createQuote(companyId: string, body: CreateQuoteDto) {
        const { items, ...data } = body;

        const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

        const client = await prisma.client.findFirst({
            where: { id: body.clientId, companyId },
        });

        if (!client) {
            logger.error('Client not found', { category: 'quote', details: { clientId: body.clientId } });
            throw new BadRequestException('Client not found');
        }

        const isVatExemptFrance = !!(company.exemptVat && (company.country || '').toUpperCase() === 'FRANCE');
        const discountRate = clampDiscountRate(body.discountRate);
        const totals = calculateDiscountedTotals(items, discountRate, { isVatExempt: isVatExemptFrance });

        const quote = await prisma.quote.create({
            data: {
                ...data,
                notes: body.notes,
                companyId: company.id,
                currency: body.currency || client.currency || company.currency,
                paymentMethod: body.paymentMethod,
                paymentDetails: body.paymentDetails,
                paymentMethodId: body.paymentMethodId,
                discountRate: totals.discountRate,
                totalHT: totals.totalHT,
                totalVAT: totals.totalVAT,
                totalTTC: totals.totalTTC,
                items: {
                    create: items.map(item => ({
                        name: item.name,
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        vatRate: isVatExemptFrance ? 0 : (item.vatRate || 0),
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

        logger.info('Quote created', { category: 'quote', details: { quoteId: quote.id, clientId: client.id } });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.QUOTE_CREATED, {
                quote,
                client,
                company,
            });
        } catch (error) {
            logger.error('Failed to dispatch QUOTE_CREATED webhook', { category: 'quote', details: { error } });
        }

        return quote;
    }

    async editQuote(companyId: string, body: EditQuotesDto) {
        const { items, id, discountRate, ...data } = body;

        if (!id) {
            logger.error('Quote ID is required for editing', { category: 'quote' });
            throw new BadRequestException('Quote ID is required for editing');
        }

        const existingQuote = await prisma.quote.findFirst({
            where: { id, companyId },
            include: { items: true }
        });

        if (!existingQuote) {
            logger.error('Quote not found', { category: 'quote', details: { id } });
            throw new NotFoundException('Quote not found');
        }

        const existingItemIds = existingQuote.items.map(i => i.id);
        const incomingItemIds = items.filter(i => i.id).map(i => i.id!);

        const itemIdsToDelete = existingItemIds.filter(id => !incomingItemIds.includes(id));

        const company = await prisma.company.findUnique({ where: { id: companyId } });
        const isVatExemptFrance = !!(company?.exemptVat && (company?.country || '').toUpperCase() === 'FRANCE');
        const normalizedDiscountRate = clampDiscountRate(discountRate ?? existingQuote.discountRate);
        const totals = calculateDiscountedTotals(items, normalizedDiscountRate, { isVatExempt: isVatExemptFrance });

        const updateQuote = await prisma.quote.update({
            where: { id },
            data: {
                ...data,
                validUntil: body.validUntil ? new Date(body.validUntil) : null,
                paymentMethod: data.paymentMethod || existingQuote.paymentMethod,
                paymentDetails: data.paymentDetails || existingQuote.paymentDetails,
                paymentMethodId: (data as any).paymentMethodId || existingQuote.paymentMethodId,
                discountRate: totals.discountRate,
                totalHT: totals.totalHT,
                totalVAT: totals.totalVAT,
                totalTTC: totals.totalTTC,
                items: {
                    deleteMany: {
                        id: { in: itemIdsToDelete },
                    },
                    updateMany: items
                        .filter(i => i.id)
                        .map(i => ({
                            where: { id: i.id! },
                            data: {
                                name: i.name,
                                description: i.description,
                                quantity: i.quantity,
                                unitPrice: i.unitPrice,
                                vatRate: isVatExemptFrance ? 0 : (i.vatRate || 0),
                                type: i.type,
                                order: i.order || 0,
                            },
                        })),
                    create: items
                        .filter(i => !i.id)
                        .map(i => ({
                            name: i.name,
                            description: i.description,
                            quantity: i.quantity,
                            unitPrice: i.unitPrice,
                            vatRate: isVatExemptFrance ? 0 : (i.vatRate || 0),
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
            logger.error('Failed to dispatch QUOTE_UPDATED webhook', { category: 'quote', details: { error } });
        }

        return updateQuote;
    }

    async deleteQuote(companyId: string, id: string) {
        const existingQuote = await prisma.quote.findFirst({
            where: { id, companyId },
            include: {
                items: true,
                client: true,
                company: true,
            },
        });

        if (!existingQuote) {
            logger.error('Quote not found', { category: 'quote', details: { id } });
            throw new NotFoundException('Quote not found');
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
            logger.error('Failed to dispatch QUOTE_DELETED webhook', { category: 'quote', details: { error } });
        }

        return deletedQuote;
    }

    // companyId is optional: the public (anonymous) signature-viewing flow
    // (SignaturesService.getSignaturePdf) resolves a quote purely through an
    // unguessable signature id, with no active company in scope. The
    // authenticated quotes controller always passes it for tenant scoping.
    async getQuotePdf(id: string, companyId?: string): Promise<Uint8Array> {

        const quote = await prisma.quote.findFirst({
            where: companyId ? { id, companyId } : { id },
            include: {
                items: true,
                client: true,
                company: {
                    include: { pdfConfig: true },
                },
            },
        });

        if (!quote || !quote.company || !quote.company.pdfConfig) {
            logger.error('Quote or associated PDF config not found', { category: 'quote', details: { id: quote?.id } });
            throw new BadRequestException('Quote or associated PDF config not found');
        }

        // Only use signing provider to generate PDF if quote is signed
        if (quote.status === 'SIGNED') {
            const provider = await this.pluginsService.getProviderByType<ISigningProvider>(PluginType.SIGNING);
            try {
                if (provider && typeof provider.generatePdfPreview == 'function') {
                    const pdf = await provider.generatePdfPreview(id);
                    return pdf;
                }
            } catch (error) {
                logger.error(`Error generating PDF via signing provider, falling back to built-in PDF generation`, { category: 'quote', details: { error } });
            }
        }

        const config = quote.company.pdfConfig;
        const templateHtml = baseTemplate;
        const template = Handlebars.compile(templateHtml);

        if (quote.client.name.length == 0) {
            quote.client.name = quote.client.contactFirstname + " " + quote.client.contactLastname
        }

        // Map payment method enum -> PDFConfig label
        const paymentMethodLabels: Record<string, string> = {
            BANK_TRANSFER: config.paymentMethodBankTransfer,
            PAYPAL: config.paymentMethodPayPal,
            CASH: config.paymentMethodCash,
            CHECK: config.paymentMethodCheck,
            OTHER: config.paymentMethodOther,
        };

        // Resolve payment method display values (use saved payment method type + details when available)
        let paymentMethodType = quote.paymentMethod;
        let paymentDetails = quote.paymentDetails;
        if (quote.paymentMethodId) {
            const pm = await prisma.paymentMethod.findUnique({ where: { id: quote.paymentMethodId } });
            if (pm) {
                paymentMethodType = paymentMethodLabels[pm.type as string] || pm.type;
                paymentDetails = pm.details || paymentDetails;
            }
        }

        // Map item type enums to PDF label text (from config)
        const itemTypeLabels: Record<string, string> = {
            HOUR: config.hour,
            DAY: config.day,
            DEPOSIT: config.deposit,
            SERVICE: config.service,
            PRODUCT: config.product,
        };

        const subtotalBeforeDiscount = quote.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const normalizedDiscountRate = clampDiscountRate(quote.discountRate);
        const discountAmountValue = Math.max(0, subtotalBeforeDiscount - quote.totalHT);
        const hasDiscount = normalizedDiscountRate > 0 && discountAmountValue > 0;

        const html = template({
            number: quote.rawNumber || quote.number.toString(),
            date: formatDate(quote.company, quote.createdAt),
            validUntil: formatDate(quote.company, quote.validUntil),
            company: quote.company,
            client: quote.client,
            currency: quote.currency,
            items: quote.items.map(i => ({
                name: i.name,
                description: formatRichText(i.description),
                quantity: Number.isInteger(i.quantity) ? i.quantity.toString() : i.quantity.toFixed(3).replace(/\.?0+$/, ''),
                unitPrice: formatAmount(i.unitPrice, quote.company.country),
                vatRate: i.vatRate,
                totalPrice: formatAmount(i.quantity * i.unitPrice * (1 + (i.vatRate || 0) / 100), quote.company.country),
                type: itemTypeLabels[i.type] || i.type,
            })),
            totalHT: formatAmount(quote.totalHT, quote.company.country),
            totalVAT: formatAmount(quote.totalVAT, quote.company.country),
            totalTTC: formatAmount(quote.totalTTC, quote.company.country),
            subtotalBeforeDiscount: formatAmount(subtotalBeforeDiscount, quote.company.country),
            discountAmount: formatAmount(discountAmountValue, quote.company.country),
            discountRate: Number(normalizedDiscountRate.toFixed(2)),
            hasDiscount,
            vatExemptText: quote.company.exemptVat && (quote.company.country || '').toUpperCase() === 'FRANCE' ? 'TVA non applicable, art. 293 B du CGI' : null,

            paymentMethod: paymentMethodType,
            paymentDetails: paymentDetails,

            // 🎨 Style & labels from PDFConfig
            fontFamily: config.fontFamily,
            padding: config.padding,
            primaryColor: config.primaryColor,
            secondaryColor: config.secondaryColor,
            tableTextColor: getInvertColor(config.secondaryColor),
            includeLogo: config.includeLogo,
            logoB64: config?.logoB64 ?? '',
            isDraft: quote.status === 'DRAFT',
            draftLabel: getDraftWatermarkLabel(quote.company.country),
            noteExists: !!quote.notes,
            notes: formatNotes(quote.notes),
            labels: {
                quote: config.quote,
                quoteFor: config.quoteFor,
                description: config.description,
                type: config.type,
                quantity: config.quantity,
                unitPrice: config.unitPrice,
                vatRate: config.vatRate,
                subtotal: config.subtotal,
                discount: config.discount,
                total: config.total,
                vat: config.vat,
                grandTotal: config.grandTotal,
                validUntil: config.validUntil,
                date: config.date,
                notes: config.notes,
                paymentMethod: config.paymentMethod,
                paymentDetails: config.paymentDetails,
                legalId: config.legalId,
                VATId: config.VATId,
                hour: config.hour,
                day: config.day,
                deposit: config.deposit,
                service: config.service,
                product: config.product
            },
        });

        const pdfBuffer = await getPDF(html, config.padding);

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
            data: { signedAt: new Date(), status: "SIGNED" },
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
            logger.error('Failed to dispatch QUOTE_SIGNED webhook', { category: 'quote', details: { error } });
        }

        try {
            logger.info(`Uploading signed quote ${id} to storage providers...`, { category: 'quote' });
            const pdfBuffer = await this.getQuotePdf(id);
            const uploadedUrls = await StorageUploadService.uploadSignedQuotePdf(id, pdfBuffer);
            if (uploadedUrls.length > 0) {
                logger.info(`Quote ${id} successfully uploaded to ${uploadedUrls.length} storage provider(s)`, { category: 'quote', details: { uploadedUrls } });
            }
        } catch (error) {
            logger.error(
                `Failed to upload signed quote ${id} to storage providers`,
                { category: 'quote', details: { error: error instanceof Error ? error.message : String(error) } }
            );
        }

        return signedQuote;
    }

}
