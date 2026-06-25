import * as Handlebars from 'handlebars';

import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateInvoiceDto, EditInvoicesDto } from '@/modules/invoices/dto/invoices.dto';
import { EInvoice, ExportFormat } from '@fin.cx/einvoice';
import { getInvertColor, getPDF } from '@/utils/pdf';

import { MailService } from '@/mail/mail.service';
import { NumberingService } from '@/utils/numbering';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { Prisma, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { baseTemplate } from '@/modules/invoices/templates/base.template';
import { business } from '@tsclass/tsclass/dist_ts';
import { finance } from '@fin.cx/einvoice/dist_ts/plugins';
import { formatDate } from '@/utils/date';
import { logger } from '@/logger/logger.service';
import { parseAddress } from '@/utils/adress';
import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { resolveInvoiceTax } from '@/compliance/integration/invoice-tax';
import { ComplianceService } from '@/compliance/operations/compliance-service';
import type { TransactionContext } from '@/compliance/canonical/canonical-document';
import { clampDiscountRate, toMinor } from '@/utils/financial';
import type { SupplyType, DocumentKind } from '@/compliance/types';
import { getDraftWatermarkLabel } from '@/utils/watermark';
import { augmentWithIdentifiers, getIdentifier } from '@/utils/entity-identifiers';

@Injectable()
export class InvoicesService {

    constructor(
        private readonly mailService: MailService,
        private readonly webhookDispatcher: WebhookDispatcherService,
        private readonly numberingService: NumberingService,
        private readonly complianceService: ComplianceService,
    ) {
    }


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
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                payments: { select: { totalPaid: true } },
            },
        });

        const totalInvoices = await prisma.invoice.count();

        // Attach payment method object when available so frontend can consume invoice.paymentMethod as an object
        const invoicesWithPM = await Promise.all(invoices.map(async (inv: any) => {
            if (inv.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: inv.paymentMethodId } });
                return { ...inv, paymentMethod: pm ?? inv.paymentMethod };
            }
            return inv;
        }));

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
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                payments: { select: { id: true, totalPaid: true } },
            },
        });

        const resultsWithPM = await Promise.all(results.map(async (inv: any) => {
            if (inv.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: inv.paymentMethodId } });
                return { ...inv, paymentMethod: pm ?? inv.paymentMethod };
            }
            return inv;
        }));

        return resultsWithPM;
    }

    async createInvoice(body: CreateInvoiceDto) {
        const { items, ...data } = body;

        const company = await prisma.company.findFirst({
            include: { partyIdentifiers: true },
        });
        if (!company) {
            logger.error('No company found. Please create a company first.', { category: 'invoice' });
            throw new BadRequestException('No company found. Please create a company first.');
        }

        const client = await prisma.client.findUnique({
            where: { id: body.clientId },
            include: { partyIdentifiers: true },
        });
        if (!client) {
            logger.error('Client not found', { category: 'invoice' });
            throw new BadRequestException('Client not found');
        }

        const discountRate = clampDiscountRate(body.discountRate);
        const taxResult = resolveInvoiceTax({
            supplierCountryCode: company.countryCode ?? guessCountryCode(company.country),
            supplierExemptVat: !!company.exemptVat,
            supplierVatNumber: getIdentifier(company, 'VAT'),
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: getIdentifier(client, 'VAT'),
            currency: body.currency || client.currency || company.currency,
            issueDate: new Date(),
            discountRate,
            items: items.map(item => ({
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
            })),
        });

        if (taxResult.warnings.length > 0) {
            logger.warn('Tax resolution warnings', { category: 'invoice', details: { warnings: taxResult.warnings } });
        }

        const invoice = await prisma.invoice.create({
            data: {
                ...data,
                status: 'DRAFT',
                recurringInvoiceId: body.recurringInvoiceId,
                paymentMethod: body.paymentMethod,
                paymentDetails: body.paymentDetails,
                paymentMethodId: body.paymentMethodId,
                currency: body.currency || client.currency || company.currency,
                companyId: company.id,
                discountRate,
                totalHT: taxResult.totalHT,
                totalHTMinor: taxResult.totalsMinor.netMinor,
                totalVAT: taxResult.totalVAT,
                totalVATMinor: taxResult.totalsMinor.taxMinor,
                totalTTC: taxResult.totalTTC,
                totalTTCMinor: taxResult.totalsMinor.grossMinor,
                items: {
                    create: items.map((item, i) => ({
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        unitPriceMinor: toMinor(item.unitPrice, body.currency || client.currency || company.currency),
                        vatRate: taxResult.itemVatRates[i],
                        type: item.type,
                        order: item.order || 0,
                        discountRate: item.discountRate ?? 0,
                        discountAmount: item.discountAmount ?? null,
                        discountAmountMinor: item.discountAmount ? toMinor(item.discountAmount, body.currency || client.currency || company.currency) : null,
                        chargeAmount: item.chargeAmount ?? null,
                        chargeAmountMinor: item.chargeAmount ? toMinor(item.chargeAmount, body.currency || client.currency || company.currency) : null,
                        chargeDescription: item.chargeDescription ?? null,
                        unitOfMeasure: item.unitOfMeasure ?? 'C62',
                    })),
                },
                dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
            },
        });

        logger.info('Invoice created', { category: 'invoice', details: { invoiceId: invoice.id, clientId: client.id } });

        // Wire ComplianceService: create a draft compliance document linked to this invoice
        try {
            const complianceCtx: TransactionContext = {
                supplier: {
                    legalName: company.name,
                    countryCode: company.countryCode ?? guessCountryCode(company.country) ?? 'FR',
                    role: 'B2B',
                    identifiers: (company as any).partyIdentifiers?.map((pi: any) => ({ scheme: pi.scheme, value: pi.value })) ?? [],
                },
                buyer: {
                    legalName: client.name,
                    countryCode: client.countryCode ?? guessCountryCode(client.country) ?? 'FR',
                    role: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
                    identifiers: (client as any).partyIdentifiers?.map((pi: any) => ({ scheme: pi.scheme, value: pi.value })) ?? [],
                },
                lines: items.map((item) => ({
                    id: `item-${item.order ?? 0}`,
                    description: item.description,
                    quantity: item.quantity,
                    unitNetMinor: toMinor(item.unitPrice, body.currency || client.currency || company.currency),
                    supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
                })),
                issueDate: new Date(),
                currency: body.currency || client.currency || company.currency,
            };
            await this.complianceService.createDraft(complianceCtx, 'INVOICE', invoice.id);
        } catch (error) {
            logger.warn('ComplianceService.createDraft failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_CREATED, {
                invoice,
                client,
                company,
            });
        } catch (error) {
            logger.error('Failed to dispatch INVOICE_CREATED webhook', { category: 'invoice', details: { error } });
        }

        return invoice;
    }

    async issueInvoice(id: string) {
        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: { client: true, company: true },
        });

        if (!invoice) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        if (invoice.status !== 'DRAFT') {
            logger.error('Only DRAFT invoices can be issued', { category: 'invoice', details: { id, status: invoice.status } });
            throw new BadRequestException('Only DRAFT invoices can be issued');
        }

        if (invoice.number !== null) {
            logger.error('Invoice already has a number', { category: 'invoice', details: { id } });
            throw new BadRequestException('Invoice already has a number');
        }

        const issueDate = new Date();
        const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const { counter, rawNumber } = await this.numberingService.nextNumber(
                tx,
                invoice.companyId,
                'invoice',
                issueDate,
            );

            return tx.invoice.update({
                where: { id },
                data: {
                    number: counter,
                    rawNumber,
                    issuedAt: issueDate,
                    status: 'SENT',
                },
                include: {
                    items: true,
                    client: { include: { partyIdentifiers: true } },
                    company: { include: { partyIdentifiers: true } },
                },
            });
        });

        // Wire ComplianceService: issue the compliance document linked to this invoice
        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId: id },
                orderBy: { createdAt: 'desc' },
            });
            if (complianceDoc) {
                await this.complianceService.issue(complianceDoc.id);
            } else {
                logger.warn('No compliance document found for issued invoice', { category: 'invoice', details: { invoiceId: id } });
            }
        } catch (error) {
            logger.warn('ComplianceService.issue failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        logger.info('Invoice issued', { category: 'invoice', details: { invoiceId: id, number: updated.rawNumber } });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_UPDATED, {
                invoice: updated,
                client: updated.client,
                company: updated.company,
            });
        } catch (error) {
            logger.error('Failed to dispatch INVOICE_UPDATED webhook after issue', { category: 'invoice', details: { error } });
        }

        return updated;
    }

    async correctInvoice(id: string, reason?: string) {
        const invoice = await prisma.invoice.findUnique({ where: { id } });
        if (!invoice) throw new BadRequestException('Invoice not found');
        if (invoice.status === 'DRAFT') throw new BadRequestException('Only issued invoices can be corrected');

        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId: id },
                orderBy: { createdAt: 'desc' },
            });
            if (!complianceDoc) {
                throw new BadRequestException('No compliance document found for this invoice');
            }
            const result = await this.complianceService.correct(complianceDoc.id, { reason });

            logger.info('Invoice corrected', { category: 'invoice', details: { invoiceId: id, correctionId: result.correction.id, correctionKind: result.correction.kind } });
            return {
                message: 'Correction initiated',
                correctionId: result.correction.id,
                correctionKind: result.correction.kind,
            };
        } catch (error) {
            logger.error('Failed to correct invoice', { category: 'invoice', details: { error: String(error) } });
            throw new BadRequestException(`Failed to correct invoice: ${(error as Error).message}`);
        }
    }

    async cancelInvoice(id: string, reason?: string) {
        const invoice = await prisma.invoice.findUnique({ where: { id } });
        if (!invoice) throw new BadRequestException('Invoice not found');
        if (invoice.status === 'DRAFT') throw new BadRequestException('Only issued invoices can be cancelled');

        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId: id },
                orderBy: { createdAt: 'desc' },
            });
            if (!complianceDoc) {
                throw new BadRequestException('No compliance document found for this invoice');
            }
            const result = await this.complianceService.cancel(complianceDoc.id, { reason });
            if (!result.accepted) {
                return { message: 'Cancellation rejected', reason: result.reason };
            }

            logger.info('Invoice cancelled', { category: 'invoice', details: { invoiceId: id } });
            return { message: 'Invoice cancelled', accepted: true };
        } catch (error) {
            logger.error('Failed to cancel invoice', { category: 'invoice', details: { error: String(error) } });
            throw new BadRequestException(`Failed to cancel invoice: ${(error as Error).message}`);
        }
    }

    async editInvoice(body: EditInvoicesDto) {
        const { items, id, discountRate, ...data } = body;

        if (!id) {
            logger.error('Invoice ID is required for editing', { category: 'invoice' });
            throw new BadRequestException('Invoice ID is required for editing');
        }

        const company = await prisma.company.findFirst({
            include: { partyIdentifiers: true },
        });
        if (!company) {
            logger.error('No company found. Please create a company first.', { category: 'invoice' });
            throw new BadRequestException('No company found. Please create a company first.');
        }

        const client = await prisma.client.findUnique({
            where: { id: data.clientId },
            include: { partyIdentifiers: true },
        });
        if (!client) {
            logger.error('Client not found', { category: 'invoice' });
            throw new BadRequestException('Client not found');
        }

        const existingInvoice = await prisma.invoice.findUnique({
            where: { id },
            include: { items: true }
        });

        if (!existingInvoice) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        if (existingInvoice.status !== 'DRAFT') {
            logger.error('Only DRAFT invoices can be edited', { category: 'invoice', details: { id, status: existingInvoice.status } });
            throw new BadRequestException('Only DRAFT invoices can be edited. Issued documents require a correction.');
        }

        const existingItemIds = existingInvoice.items.map(i => i.id);
        const incomingItemIds = items.filter(i => i.id).map(i => i.id!);

        const itemIdsToDelete = existingItemIds.filter(id => !incomingItemIds.includes(id));

        const normalizedDiscountRate = clampDiscountRate(discountRate ?? existingInvoice.discountRate);
        const taxResult = resolveInvoiceTax({
            supplierCountryCode: company.countryCode ?? guessCountryCode(company.country),
            supplierExemptVat: !!company.exemptVat,
            supplierVatNumber: getIdentifier(company, 'VAT'),
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: getIdentifier(client, 'VAT'),
            currency: body.currency || client.currency || company.currency,
            issueDate: new Date(),
            discountRate: normalizedDiscountRate,
            items: items.map(item => ({
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
            })),
        });

        if (taxResult.warnings.length > 0) {
            logger.warn('Tax resolution warnings', { category: 'invoice', details: { warnings: taxResult.warnings } });
        }

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
                dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                discountRate: normalizedDiscountRate,
                totalHT: taxResult.totalHT,
                totalHTMinor: taxResult.totalsMinor.netMinor,
                totalVAT: taxResult.totalVAT,
                totalVATMinor: taxResult.totalsMinor.taxMinor,
                totalTTC: taxResult.totalTTC,
                totalTTCMinor: taxResult.totalsMinor.grossMinor,
                items: {
                    deleteMany: {
                        id: { in: itemIdsToDelete },
                    },
                    updateMany: items
                        .map((i, originalIdx) => ({ i, originalIdx }))
                        .filter(({ i }) => i.id)
                        .map(({ i, originalIdx }) => ({
                            where: { id: i.id! },
                            data: {
                                description: i.description,
                                quantity: i.quantity,
                                unitPrice: i.unitPrice,
                                unitPriceMinor: toMinor(i.unitPrice, body.currency || client.currency || company.currency),
                                vatRate: taxResult.itemVatRates[originalIdx],
                                type: i.type,
                                order: i.order || 0,
                                discountRate: i.discountRate ?? 0,
                                discountAmount: i.discountAmount ?? null,
                                discountAmountMinor: i.discountAmount ? toMinor(i.discountAmount, body.currency || client.currency || company.currency) : null,
                                chargeAmount: i.chargeAmount ?? null,
                                chargeAmountMinor: i.chargeAmount ? toMinor(i.chargeAmount, body.currency || client.currency || company.currency) : null,
                                chargeDescription: i.chargeDescription ?? null,
                                unitOfMeasure: i.unitOfMeasure ?? 'C62',
                            },
                        })),
                    create: items
                        .map((i, originalIdx) => ({ i, originalIdx }))
                        .filter(({ i }) => !i.id)
                        .map(({ i, originalIdx }) => ({
                            description: i.description,
                            quantity: i.quantity,
                            unitPrice: i.unitPrice,
                            unitPriceMinor: toMinor(i.unitPrice, body.currency || client.currency || company.currency),
                            vatRate: taxResult.itemVatRates[originalIdx],
                            type: i.type,
                            order: i.order || 0,
                            discountRate: i.discountRate ?? 0,
                            discountAmount: i.discountAmount ?? null,
                            discountAmountMinor: i.discountAmount ? toMinor(i.discountAmount, body.currency || client.currency || company.currency) : null,
                            chargeAmount: i.chargeAmount ?? null,
                            chargeAmountMinor: i.chargeAmount ? toMinor(i.chargeAmount, body.currency || client.currency || company.currency) : null,
                            chargeDescription: i.chargeDescription ?? null,
                            unitOfMeasure: i.unitOfMeasure ?? 'C62',
                        })),
                },
            },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
            },
        });

        // Audit: record EDIT event
        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId: id },
                orderBy: { createdAt: 'desc' },
            });
            if (complianceDoc) {
                await this.complianceService.recordAuditEvent(complianceDoc.id, 'EDITED', `draft edited`);
            }
        } catch (error) {
            logger.warn('ComplianceService.recordAuditEvent(EDITED) failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        logger.info('Invoice updated', { category: 'invoice', details: { invoiceId: updateInvoice.id } });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_UPDATED, {
                invoice: updateInvoice,
                client: updateInvoice.client,
                company: updateInvoice.company,
            });
        } catch (error) {
            logger.error('Failed to dispatch INVOICE_UPDATED webhook', { category: 'invoice', details: { error } });
        }

        return updateInvoice;
    }

    async deleteInvoice(id: string) {
        const existingInvoice = await prisma.invoice.findUnique({
            where: { id },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
            }
        });

        if (!existingInvoice) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        if (existingInvoice.status !== 'DRAFT') {
            logger.error('Only DRAFT invoices can be deleted', { category: 'invoice', details: { id, status: existingInvoice.status } });
            throw new BadRequestException('Only DRAFT invoices can be deleted. Issued documents must be cancelled instead.');
        }

        const deletedInvoice = await prisma.invoice.update({
            where: { id },
            data: { isActive: false },
        });

        // Audit: record DELETED event
        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId: id },
                orderBy: { createdAt: 'desc' },
            });
            if (complianceDoc) {
                await this.complianceService.recordAuditEvent(complianceDoc.id, 'DELETED', `draft deleted (soft)`);
            }
        } catch (error) {
            logger.warn('ComplianceService.recordAuditEvent(DELETED) failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        logger.info('Invoice deleted', { category: 'invoice', details: { invoiceId: id } });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_DELETED, {
                invoice: existingInvoice,
                client: existingInvoice.client,
                company: existingInvoice.company,
            });
        } catch (error) {
            logger.error('Failed to dispatch INVOICE_DELETED webhook', { category: 'invoice', details: { error } });
        }

        return deletedInvoice;
    }

    async getInvoicePdf(id: string): Promise<Uint8Array> {
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
                description: i.description,
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

    async getInvoiceXMLFormat(id: string): Promise<EInvoice> {
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

        const inv = new EInvoice();

        const companyFoundedDate = new Date(invRec.company.foundedAt || new Date())
        const clientFoundedDate = new Date(invRec.client.foundedAt || new Date());

        inv.id = invRec.rawNumber || (invRec.number?.toString() ?? 'DRAFT');
        inv.issueDate = new Date((invRec.issuedAt ?? invRec.createdAt).toISOString().split('T')[0]);
        inv.currency = invRec.company.currency as finance.TCurrency || 'EUR';

        let fromAdress;
        try {
            fromAdress = parseAddress(invRec.company.address || '');
        } catch (error) {
            fromAdress = {
                streetName: invRec.company.address || 'N/A',
                houseNumber: 'N/A',
            };
        }

        inv.from = {
            name: invRec.company.name,
            description: invRec.company.description || "N/A",
            status: 'active',
            foundedDate: { day: companyFoundedDate.getDay(), month: companyFoundedDate.getMonth() + 1, year: companyFoundedDate.getFullYear() },
            type: 'company',
            address: {
                streetName: fromAdress.streetName,
                houseNumber: fromAdress.houseNumber,
                city: invRec.company.city,
                postalCode: invRec.company.postalCode,
                country: invRec.company.country,
                countryCode: invRec.company.country
            },
            registrationDetails: { vatId: getIdentifier(invRec.company, 'VAT') || "N/A", registrationId: getIdentifier(invRec.company, 'LEGAL_ID') || "N/A", registrationName: invRec.company.name }
        };

        let toAdress;
        try {
            toAdress = parseAddress(invRec.client.address || '');
        } catch (error) {
            toAdress = {
                streetName: invRec.client.address || 'N/A',
                houseNumber: 'N/A',
            };
        }

        if (invRec.client.type === 'COMPANY') {
            const companyContact: business.TCompany = {
                type: 'company',
                name: invRec.client.name || "N/A",
                description: invRec.client.description || "N/A",
                status: invRec.client.isActive ? 'active' : 'planned',
                foundedDate: { day: clientFoundedDate.getDay(), month: clientFoundedDate.getMonth() + 1, year: clientFoundedDate.getFullYear() },
                address: {
                    streetName: toAdress.streetName,
                    houseNumber: toAdress.houseNumber,
                    city: invRec.client.city,
                    postalCode: invRec.client.postalCode,
                    country: invRec.client.country || 'FR',
                    countryCode: invRec.client.country.slice(0, 2).toUpperCase() || 'FR' // TODO: Refactor the app to store country codes instead of custom country names
                },
                registrationDetails: { vatId: getIdentifier(invRec.client, 'VAT') || 'N/A', registrationId: getIdentifier(invRec.client, 'LEGAL_ID') || 'N/A', registrationName: invRec.client.name }
            };

            inv.to = companyContact;
        } else {
            const personContact: business.TPerson = {
                type: 'person',
                name: `${invRec.client.contactFirstname} ${invRec.client.contactLastname}` || "N/A",
                description: invRec.client.description || "N/A",
                surname: invRec.client.contactLastname || 'N/A',
                salutation: invRec.client.salutation as "Mr" | "Ms" | "Mrs",
                sex: invRec.client.sex as "male" | "female" | "other",
                title: invRec.client.title as "Doctor" | "Professor",
                address: {
                    streetName: toAdress.streetName,
                    houseNumber: toAdress.houseNumber,
                    city: invRec.client.city,
                    postalCode: invRec.client.postalCode,
                    country: invRec.client.country || 'FR',
                    countryCode: invRec.client.country.slice(0, 2).toUpperCase() || 'FR' // TODO: Refactor the app to store country codes instead of custom country names
                },
            };

            inv.to = personContact;
        }

        invRec.items.forEach((item, index) => {
            inv.addItem({
                name: item.description,
                unitQuantity: item.quantity,
                unitNetPrice: item.unitPrice,
                vatPercentage: item.vatRate || 0,
                unitType: item.type === 'HOUR' ? 'HUR' : item.type === 'DAY' ? 'DAY' : item.type === 'DEPOSIT' ? 'SET' : item.type === 'SERVICE' ? 'C62' : item.type === 'PRODUCT' ? 'C62' : 'C62',
            });
        });

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

    async getInvoicePDFFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array> {
        const invRec = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, client: { include: { partyIdentifiers: true } }, company: { include: { partyIdentifiers: true } }, quote: true } });
        if (!invRec) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        const pdfBuffer = await this.getInvoicePdf(invoiceId);

        if (format === 'pdf' || format === '') {
            return pdfBuffer;
        }

        const inv = await this.getInvoiceXMLFormat(invoiceId);

        return await inv.embedInPdf(Buffer.from(pdfBuffer), format)
    }

    async createInvoiceFromQuote(quoteId: string) {
        const quote = await prisma.quote.findUnique({
            where: { id: quoteId },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
            }
        });

        if (!quote) {
            logger.error('Quote not found when creating invoice from quote', { category: 'invoice', details: { quoteId } });
            throw new BadRequestException('Quote not found');
        }

        if (quote.status !== 'SIGNED') {
            logger.error('Only SIGNED quotes can be converted to invoices', { category: 'invoice', details: { quoteId, status: quote.status } });
            throw new BadRequestException('Only SIGNED quotes can be converted to invoices.');
        }

        const newInvoice = await this.createInvoice({
            clientId: quote.clientId,
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            items: quote.items.map(i => ({
                description: i.description,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                vatRate: i.vatRate,
                type: i.type,
                order: i.order,
                discountRate: i.discountRate,
                discountAmount: i.discountAmount ?? undefined,
                chargeAmount: i.chargeAmount ?? undefined,
                chargeDescription: i.chargeDescription ?? undefined,
                unitOfMeasure: i.unitOfMeasure,
            })),
            currency: quote.currency,
            notes: quote.notes || '',
            paymentMethodId: (quote as any).paymentMethodId || undefined,
            paymentMethod: (quote as any).paymentMethod || undefined,
            paymentDetails: (quote as any).paymentDetails || undefined,
        });

        logger.info('Invoice created from quote', { category: 'invoice', details: { invoiceId: newInvoice.id, quoteId } });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_CREATED_FROM_QUOTE, {
                invoice: newInvoice,
                quote,
                client: quote.client,
                company: quote.company,
            });
        } catch (error) {
            logger.error('Failed to dispatch INVOICE_CREATED_FROM_QUOTE webhook', { category: 'invoice', details: { error } });
        }

        return newInvoice;
    }

    async archiveInvoice(invoiceId: string) {
        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: { client: { include: { partyIdentifiers: true } }, company: { include: { partyIdentifiers: true } } },
        });

        if (!invoice) {
            logger.error('Invoice not found when trying to archive', { category: 'invoice', details: { invoiceId } });
            throw new BadRequestException('Invoice not found');
        }

        if (invoice.status !== 'PAID') {
            logger.error('Only paid invoices can be archived', { category: 'invoice', details: { invoiceId, status: invoice.status } });
            throw new BadRequestException('Only paid invoices can be archived');
        }

        const archivedInvoice = await prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: 'ARCHIVED' },
        });

        // Audit: record ARCHIVED event
        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId },
                orderBy: { createdAt: 'desc' },
            });
            if (complianceDoc) {
                await this.complianceService.recordAuditEvent(complianceDoc.id, 'ARCHIVED', `PAID→ARCHIVED`);
            }
        } catch (error) {
            logger.warn('ComplianceService.recordAuditEvent(ARCHIVED) failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        logger.info('Invoice archived', { category: 'invoice', details: { invoiceId } });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_STATUS_CHANGED, {
                invoice: archivedInvoice,
                client: invoice.client,
                company: invoice.company,
                previousStatus: invoice.status,
                newStatus: archivedInvoice.status,
            });
        } catch (error) {
            logger.error('Failed to dispatch INVOICE_STATUS_CHANGED webhook', { category: 'invoice', details: { error } });
        }

        return archivedInvoice;
    }

    async sendInvoiceByEmail(invoiceId: string) {
        let invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: {
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                items: true,
            },
        });

        if (!invoice) {
            logger.error('Invoice not found', { category: 'invoice' });
            throw new BadRequestException('Invoice not found');
        }

        // If the invoice is still a DRAFT, issue it first
        if (invoice.status === 'DRAFT' || invoice.number === null) {
            invoice = await this.issueInvoice(invoiceId);
        }

        // If client has no email, skip sending and return an informative message
        if (!invoice.client?.contactEmail) {
            logger.error('Client has no email configured; invoice not sent', { category: 'invoice' });
            return { message: 'Client has no email configured; invoice not sent' };
        }

        const pdfBuffer = await this.getInvoicePDFFormat(invoiceId, (invoice.company.invoicePDFFormat as ExportFormat || 'pdf'));

        const mailTemplate = await prisma.mailTemplate.findFirst({
            where: { type: 'INVOICE' },
            select: { subject: true, body: true }
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
            subject: mailTemplate.subject.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
            html: mailTemplate.body.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
            attachments: [{
                filename: `invoice-${invoice.rawNumber || invoice.number || 'draft'}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
            }],
        };

        try {
            await this.mailService.sendMail(mailOptions);
        } catch (error) {
            logger.error('Failed to send invoice email', { category: 'invoice', details: { error } });
            throw new BadRequestException('Failed to send invoice email. Please check your SMTP configuration.');
        }

        logger.info('Invoice sent by email', { category: 'invoice', details: { invoiceId, email: invoice.client.contactEmail } });

        // Audit: record SENT event
        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId },
                orderBy: { createdAt: 'desc' },
            });
            if (complianceDoc) {
                await this.complianceService.recordAuditEvent(complianceDoc.id, 'SENT', `sent via email to ${invoice.client.contactEmail}`);
            }
        } catch (error) {
            logger.warn('ComplianceService.recordAuditEvent(SENT) failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        try {
            await prisma.invoice.update({
                where: { id: invoiceId },
                data: { status: 'SENT' },
            });
        } catch (error) {
            logger.error('Failed to update invoice status after sending', { category: 'invoice', details: { error } });
        }

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_SENT, {
                invoice,
                client: invoice.client,
                company: invoice.company,
                sentAt: new Date(),
            });
        } catch (error) {
            logger.error('Failed to dispatch INVOICE_SENT webhook', { category: 'invoice', details: { error } });
        }

        return { message: 'Invoice sent successfully' };
    }
}
