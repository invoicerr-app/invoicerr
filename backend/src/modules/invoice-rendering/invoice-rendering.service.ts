import { Injectable, BadRequestException } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { EInvoice, ExportFormat } from '@fin.cx/einvoice';
import { finance } from '@fin.cx/einvoice/dist_ts/plugins';
import { business } from '@tsclass/tsclass/dist_ts';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import { getInvertColor, getPDF } from '@/utils/pdf';
import { baseTemplate } from '@/modules/invoices/templates/base.template';
import { formatDate } from '@/utils/date';
import { formatItemDescription } from '@/utils/format-text';
import { clampDiscountRate } from '@/utils/financial';
import { getDraftWatermarkLabel } from '@/utils/watermark';
import { augmentWithIdentifiers, getIdentifier } from '@/utils/entity-identifiers';
import { parseAddress } from '@/utils/adress';

/** Minimal data shape required by {@link InvoiceRenderingService.buildEInvoice}.
 *  Matches the Prisma include used by {@link renderXml} / {@link renderPdf} but is
 *  decoupled from Prisma so tests can build invoices from plain objects. */
export interface InvoiceRenderData {
  rawNumber: string | null;
  number: number | null;
  issuedAt: Date | null;
  createdAt: Date;
  company: {
    name: string;
    description: string | null;
    foundedAt: Date | null;
    currency: string;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
    partyIdentifiers?: { scheme: string; value: string }[];
  };
  client: {
    type: string;
    name: string;
    description: string | null;
    foundedAt: Date | null;
    contactFirstname: string | null;
    contactLastname: string | null;
    salutation: string | null;
    sex: string | null;
    title: string | null;
    isActive: boolean;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
    partyIdentifiers?: { scheme: string; value: string }[];
  };
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    type: string;
  }[];
}

@Injectable()
export class InvoiceRenderingService {

    async renderPdf(id: string): Promise<Uint8Array> {
        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: {
                    include: { pdfConfig: true, partyIdentifiers: true },
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

        if (invoice.client.name.length == 0) {
            invoice.client.name = invoice.client.contactFirstname + " " + invoice.client.contactLastname
        }

        const companyAugmented = augmentWithIdentifiers(invoice.company);
        const clientAugmented = augmentWithIdentifiers(invoice.client);
        const { pdfConfig } = companyAugmented;

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

        const subtotalBeforeDiscount = invoice.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const normalizedDiscountRate = clampDiscountRate(invoice.discountRate);
        const discountAmountValue = Math.max(0, subtotalBeforeDiscount - invoice.totalHT);
        const hasDiscount = normalizedDiscountRate > 0 && discountAmountValue > 0;

        const html = template({
            isDraft: invoice.status === 'DRAFT',
            draftLabel: getDraftWatermarkLabel(invoice.company.country),
            number: invoice.rawNumber || (invoice.number?.toString() ?? getDraftWatermarkLabel(invoice.company.country)),
            date: formatDate(invoice.company, invoice.issuedAt ?? invoice.createdAt),
            dueDate: formatDate(invoice.company, invoice.dueDate),
            company: companyAugmented,
            client: clientAugmented,
            currency: invoice.currency,
            items: invoice.items.map(i => ({
                name: i.name,
                description: formatItemDescription(i.description),
                quantity: Number.isInteger(i.quantity) ? i.quantity.toString() : i.quantity.toFixed(3).replace(/\.?0+$/, ''),
                unitPrice: i.unitPrice.toFixed(2),
                vatRate: (i.vatRate || 0).toFixed(2),
                totalPrice: (i.quantity * i.unitPrice * (1 + (i.vatRate || 0) / 100)).toFixed(2),
                type: itemTypeLabels[i.type] || i.type,
            })),
            totalHT: invoice.totalHT.toFixed(2),
            totalVAT: invoice.totalVAT.toFixed(2),
            totalTTC: invoice.totalTTC.toFixed(2),
            subtotalBeforeDiscount: subtotalBeforeDiscount.toFixed(2),
            discountAmount: discountAmountValue.toFixed(2),
            discountRate: Number(normalizedDiscountRate.toFixed(2)),
            hasDiscount,
            vatExemptText: invoice.company.exemptVat && (invoice.company.country || '').toUpperCase() === 'FRANCE' ? 'TVA non applicable, art. 293 B du CGI' : null,

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
                discount: pdfConfig.discount,
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

    /** Pure construction — no DB access. Builds an EInvoice from a plain data object. */
    buildEInvoice(data: InvoiceRenderData): EInvoice {
        const inv = new EInvoice();

        const companyFoundedDate = new Date(data.company.foundedAt || new Date());
        const clientFoundedDate = new Date(data.client.foundedAt || new Date());

        inv.id = data.rawNumber || (data.number?.toString() ?? 'DRAFT');
        inv.issueDate = new Date((data.issuedAt ?? data.createdAt).toISOString().split('T')[0]);
        inv.currency = data.company.currency as finance.TCurrency || 'EUR';

        let fromAdress;
        try {
            fromAdress = parseAddress(data.company.address || '');
        } catch (error) {
            fromAdress = {
                streetName: data.company.address || 'N/A',
                houseNumber: 'N/A',
            };
        }

        inv.from = {
            name: data.company.name,
            description: data.company.description || "N/A",
            status: 'active',
            foundedDate: { day: companyFoundedDate.getDay(), month: companyFoundedDate.getMonth() + 1, year: companyFoundedDate.getFullYear() },
            type: 'company',
            address: {
                streetName: fromAdress.streetName,
                houseNumber: fromAdress.houseNumber,
                city: data.company.city || '',
                postalCode: data.company.postalCode || '',
                country: data.company.country || '',
                countryCode: data.company.country || ''
            },
            registrationDetails: { vatId: getIdentifier(data.company, 'VAT') || "N/A", registrationId: getIdentifier(data.company, 'LEGAL_ID') || "N/A", registrationName: data.company.name }
        };

        let toAdress;
        try {
            toAdress = parseAddress(data.client.address || '');
        } catch (error) {
            toAdress = {
                streetName: data.client.address || 'N/A',
                houseNumber: 'N/A',
            };
        }

        if (data.client.type === 'COMPANY') {
            const companyContact: business.TCompany = {
                type: 'company',
                name: data.client.name || "N/A",
                description: data.client.description || "N/A",
                status: data.client.isActive ? 'active' : 'planned',
                foundedDate: { day: clientFoundedDate.getDay(), month: clientFoundedDate.getMonth() + 1, year: clientFoundedDate.getFullYear() },
                address: {
                    streetName: toAdress.streetName,
                    houseNumber: toAdress.houseNumber,
                    city: data.client.city || '',
                    postalCode: data.client.postalCode || '',
                    country: data.client.country || 'FR',
                    countryCode: (data.client.country || 'FR').slice(0, 2).toUpperCase()
                },
                registrationDetails: { vatId: getIdentifier(data.client, 'VAT') || 'N/A', registrationId: getIdentifier(data.client, 'LEGAL_ID') || 'N/A', registrationName: data.client.name }
            };

            inv.to = companyContact;
        } else {
            const personContact: business.TPerson = {
                type: 'person',
                name: `${data.client.contactFirstname} ${data.client.contactLastname}` || "N/A",
                description: data.client.description || "N/A",
                surname: data.client.contactLastname || 'N/A',
                salutation: data.client.salutation as "Mr" | "Ms" | "Mrs",
                sex: data.client.sex as "male" | "female" | "other",
                title: data.client.title as "Doctor" | "Professor",
                address: {
                    streetName: toAdress.streetName,
                    houseNumber: toAdress.houseNumber,
                    city: data.client.city || '',
                    postalCode: data.client.postalCode || '',
                    country: data.client.country || 'FR',
                    countryCode: (data.client.country || 'FR').slice(0, 2).toUpperCase()
                },
            };

            inv.to = personContact;
        }

        data.items.forEach((item) => {
            inv.addItem({
                name: item.name,
                unitQuantity: item.quantity,
                unitNetPrice: item.unitPrice,
                vatPercentage: item.vatRate || 0,
                unitType: item.type === 'HOUR' ? 'HUR' : item.type === 'DAY' ? 'DAY' : item.type === 'DEPOSIT' ? 'SET' : item.type === 'SERVICE' ? 'C62' : item.type === 'PRODUCT' ? 'C62' : 'C62',
            });
        });

        return inv;
    }

    async renderXml(id: string): Promise<EInvoice> {
        const invRec = await prisma.invoice.findUnique({
            where: { id },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: {
                    include: { pdfConfig: true, partyIdentifiers: true },
                },
            },
        });

        if (!invRec) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        const inv = this.buildEInvoice(invRec);

        const validation = await inv.validate()

        logger.info('E-Invoice validation result: ' + (validation.valid ? 'valid' : 'invalid'), { category: 'invoice' });
        logger.info('E-Invoice validation warnings: ' + (validation.warnings ? validation.warnings.length : '0'), { category: 'invoice' });
        logger.info('E-Invoice validation errors: ' + (validation.errors ? validation.errors.length : '0'), { category: 'invoice' });

        if (!validation.valid) {
            if (validation.warnings) {
                logger.warn('Validation warnings:', { category: 'invoice', details: { warnings: validation.warnings } });
            }

            logger.error('Validation errors:', { category: 'invoice', details: { errors: validation.errors } });
        }

        return inv;
    }

    async renderXmlFormat(invoiceId: string, format: 'ubl' | 'cii' | 'xrechnung'): Promise<string> {
        const inv = await this.renderXml(invoiceId);
        return inv.exportXml(format);
    }

    async renderPdfFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array> {
        const invRec = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, client: { include: { partyIdentifiers: true } }, company: { include: { partyIdentifiers: true } }, quote: true } });
        if (!invRec) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        const pdfBuffer = await this.renderPdf(invoiceId);

        if (format === 'pdf' || format === '') {
            return pdfBuffer;
        }

        const inv = await this.renderXml(invoiceId);

        return await inv.embedInPdf(Buffer.from(pdfBuffer), format)
    }
}
