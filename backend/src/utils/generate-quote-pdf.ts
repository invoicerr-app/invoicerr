import * as Handlebars from 'handlebars';

import { getInvertColor, getPDF } from '@/utils/pdf';

import { BadRequestException } from '@nestjs/common';
import { baseTemplate } from '@/modules/quotes/templates/base.template';
import { formatDate } from '@/utils/date';
import prisma from '@/prisma/prisma.service';

/**
 * Generate PDF for a quote without requiring QuotesService
 * This is a utility function that can be used outside of NestJS context
 */
export async function generateQuotePdf(quoteId: string): Promise<Uint8Array> {
    const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: {
            items: true,
            client: true,
            company: {
                include: { pdfConfig: true },
            },
        },
    });

    if (!quote || !quote.company || !quote.company.pdfConfig) {
        throw new BadRequestException('Quote or associated PDF config not found');
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

    const html = template({
        number: quote.rawNumber || quote.number.toString(),
        date: formatDate(quote.company, quote.createdAt),
        validUntil: formatDate(quote.company, quote.validUntil),
        company: quote.company,
        client: quote.client,
        currency: quote.currency,
        items: quote.items.map(i => ({
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice.toFixed(2),
            vatRate: i.vatRate,
            totalPrice: (i.quantity * i.unitPrice * (1 + (i.vatRate || 0) / 100)).toFixed(2),
            type: itemTypeLabels[i.type] || i.type,
        })),
        totalHT: quote.totalHT.toFixed(2),
        totalVAT: quote.totalVAT.toFixed(2),
        totalTTC: quote.totalTTC.toFixed(2),
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
        noteExists: !!quote.notes,
        notes: (quote.notes || '').replace(/\n/g, '<br>'),
        labels: {
            quote: config.quote,
            quoteFor: config.quoteFor,
            description: config.description,
            type: config.type,
            quantity: config.quantity,
            unitPrice: config.unitPrice,
            vatRate: config.vatRate,
            subtotal: config.subtotal,
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

    const pdfBuffer = await getPDF(html);

    return pdfBuffer;
}
