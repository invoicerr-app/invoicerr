import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateInvoiceDto, CreateInvoiceFromQuoteDto, EditInvoicesDto } from '@/modules/invoices/dto/invoices.dto';
import { ExportFormat } from '@fin.cx/einvoice';

import { MailService } from '@/mail/mail.service';
import { NumberingService } from '@/utils/numbering';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { Prisma, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { resolveInvoiceTax } from '@/compliance/integration/invoice-tax';
import { ComplianceService } from '@/compliance/operations/compliance-service';
import type { TransactionContext } from '@/compliance/canonical/canonical-document';
import { assembleLifecycle, phaseContextFromPlan } from '@/compliance/lifecycle/assembler';
import { LifecycleRuntime } from '@/compliance/lifecycle/runtime';
import type { CompliancePlan } from '@/compliance/engine/compliance-engine';
import type { ComplianceStatus } from '@/compliance/lifecycle/state-machine';
import { defaultTransmissionRegistry } from '@/compliance/providers/transmission/registry';
import { describeFlow } from '@/compliance/lifecycle/flow-descriptor';
import { clampDiscountRate, toMinor } from '@/utils/financial';
import type { SupplyType, DocumentKind } from '@/compliance/types';
import { getIdentifier } from '@/utils/entity-identifiers';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';

@Injectable()
export class InvoicesService {

    constructor(
        private readonly mailService: MailService,
        private readonly webhookDispatcher: WebhookDispatcherService,
        private readonly numberingService: NumberingService,
        private readonly complianceService: ComplianceService,
        private readonly rendering: InvoiceRenderingService,
    ) {
    }


    async getInvoice(id: string) {
        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                payments: { select: { totalPaid: true } },
                correctedBy: {
                    select: { id: true, rawNumber: true, number: true, kind: true, totalTTC: true, currency: true, status: true },
                    where: { isActive: true },
                },
                complianceDocuments: {
                    select: {
                        id: true,
                        status: true,
                        number: true,
                        plan: true,
                        immutableHash: true,
                        events: {
                            select: { type: true, at: true, actor: true, detail: true },
                            orderBy: { at: 'asc' as const },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
            },
        });
        if (!invoice) throw new BadRequestException('Invoice not found');

        if (invoice.paymentMethodId) {
            const pm = await prisma.paymentMethod.findUnique({ where: { id: invoice.paymentMethodId } });
            if (pm) return { ...invoice, paymentMethod: pm ?? invoice.paymentMethod };
        }
        return invoice;
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
                correctedBy: {
                    select: { id: true, rawNumber: true, number: true, kind: true, totalTTC: true, currency: true, status: true },
                    where: { isActive: true },
                },
                complianceDocuments: {
                    select: { id: true, status: true, plan: true },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
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

        const mapped = invoicesWithPM.map((inv: any) => {
            const doc = inv.complianceDocuments?.[0];
            if (!doc?.plan) return inv;
            const flow = describeFlow(doc.plan as unknown as CompliancePlan, doc.status as ComplianceStatus);
            return {
                ...inv,
                complianceDocuments: [{
                    id: doc.id,
                    status: doc.status,
                    flow: { channelClass: flow.channelClass, sendLabelKey: flow.sendLabelKey, awaiting: flow.awaiting, pipeline: flow.pipeline, manualActions: flow.manualActions },
                }],
            };
        });

        return { pageCount: Math.ceil(totalInvoices / pageSize), invoices: mapped };
    }

    async getInvoicesTable(filters: { clientId?: string; year?: string; month?: string; sort?: 'asc' | 'desc' }) {
        const where: Record<string, any> = { isActive: true };

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

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: {
                createdAt: sort,
            },
            include: {
                items: true,
                client: true,
                company: true,
                payments: { select: { totalPaid: true } },
            },
        });

        const invoicesWithPM = await Promise.all(invoices.map(async (inv: any) => {
            if (inv.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: inv.paymentMethodId } });
                return { ...inv, paymentMethod: pm ?? inv.paymentMethod };
            }
            return inv;
        }));

        return invoicesWithPM;
    }

    async searchInvoices(query: string) {
        if (query === '') {
            return this.getInvoices('1'); // Return first page if query is empty
        }

        const results = await prisma.invoice.findMany({
            where: {
                OR: [
                    { client: { name: { contains: query } } },
                    { items: { some: { name: { contains: query } } } },
                ],
            },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                payments: { select: { id: true, totalPaid: true } },
                correctedBy: {
                    select: { id: true, rawNumber: true, number: true, kind: true, totalTTC: true, currency: true, status: true },
                    where: { isActive: true },
                },
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
                recurringPeriodKey: body.recurringPeriodKey ?? null,
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
                        name: item.name ?? item.description,
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
                        quoteItemId: item.quoteItemId,
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
                    description: (item.description ?? '') as string,
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
                    status: 'ISSUED',
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
        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
            },
        });
        if (!invoice) throw new BadRequestException('Invoice not found');
        if (invoice.status === 'DRAFT') throw new BadRequestException('Only issued invoices can be corrected');

        try {
            // Resolve the correction model from the compliance plan (consumes the engine, not a if-pays)
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId: id },
                orderBy: { createdAt: 'desc' },
            });
            if (!complianceDoc) {
                throw new BadRequestException('No compliance document found for this invoice');
            }

            const storedPlan = complianceDoc.plan as any;
            const correctionModel: string = storedPlan?.lifecycle?.correctionModel ?? 'CREDIT_NOTE';

            // Determine the correction kind and compute items/totals
            let correctionKind: DocumentKind;
            let correctionItems: any[];
            let totalHT: number;
            let totalVAT: number;
            let totalTTC: number;

            const copyItems = (negate: boolean) => invoice.items.map((item, i) => ({
                description: item.description,
                quantity: negate ? -item.quantity : item.quantity,
                unitPrice: item.unitPrice,
                unitPriceMinor: item.unitPriceMinor != null ? (negate ? -item.unitPriceMinor : item.unitPriceMinor) : null,
                vatRate: item.vatRate,
                type: item.type,
                order: i,
                discountRate: item.discountRate,
                discountAmount: negate ? null : item.discountAmount,
                discountAmountMinor: negate ? null : item.discountAmountMinor,
                chargeAmount: negate ? null : item.chargeAmount,
                chargeAmountMinor: negate ? null : item.chargeAmountMinor,
                chargeDescription: negate ? null : item.chargeDescription,
                unitOfMeasure: item.unitOfMeasure,
            }));

            const toMinorFn = (v: number | null | undefined) => v != null ? v : null;

            if (correctionModel === 'CANCEL_AND_REPLACE') {
                correctionKind = 'INVOICE';
                correctionItems = copyItems(false);
                totalHT = invoice.totalHT;
                totalVAT = invoice.totalVAT;
                totalTTC = invoice.totalTTC;
            } else if (correctionModel === 'CORRECTIVE_INVOICE') {
                correctionKind = 'CORRECTIVE_INVOICE';
                correctionItems = copyItems(false);
                totalHT = invoice.totalHT;
                totalVAT = invoice.totalVAT;
                totalTTC = invoice.totalTTC;
            } else {
                correctionKind = 'CREDIT_NOTE';
                correctionItems = copyItems(true);
                totalHT = -invoice.totalHT;
                totalVAT = -invoice.totalVAT;
                totalTTC = -invoice.totalTTC;
            }

            const totalHTMinor = correctionModel === 'CREDIT_NOTE'
                ? (invoice.totalHTMinor != null ? -invoice.totalHTMinor : null)
                : invoice.totalHTMinor;
            const totalVATMinor = correctionModel === 'CREDIT_NOTE'
                ? (invoice.totalVATMinor != null ? -invoice.totalVATMinor : null)
                : invoice.totalVATMinor;
            const totalTTCMinor = correctionModel === 'CREDIT_NOTE'
                ? (invoice.totalTTCMinor != null ? -invoice.totalTTCMinor : null)
                : invoice.totalTTCMinor;

            // Create the correction invoice as ISSUED (numbered — it's a legal document)
            const issueDate = new Date();
            const correctionInvoice = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const { counter, rawNumber } = await this.numberingService.nextNumber(
                    tx,
                    invoice.companyId,
                    'invoice',
                    issueDate,
                );

                return tx.invoice.create({
                    data: {
                        kind: correctionKind as any,
                        correctsInvoiceId: id,
                        clientId: invoice.clientId,
                        companyId: invoice.companyId,
                        currency: invoice.currency,
                        number: counter,
                        rawNumber,
                        issuedAt: issueDate,
                        status: 'ISSUED',
                        dueDate: invoice.dueDate,
                        notes: reason || `Correction of ${invoice.rawNumber || invoice.number}`,
                        discountRate: invoice.discountRate,
                        totalHT,
                        totalVAT,
                        totalTTC,
                        totalHTMinor,
                        totalVATMinor,
                        totalTTCMinor,
                        items: {
                            create: correctionItems,
                        },
                    },
                    include: {
                        items: true,
                        client: { include: { partyIdentifiers: true } },
                        company: { include: { partyIdentifiers: true } },
                    },
                });
            });

            // Update original invoice status → CORRECTED
            await prisma.invoice.update({
                where: { id },
                data: { status: 'CORRECTED' },
            });

            // Wire ComplianceService for the correction (non-blocking)
            try {
                const company = invoice.company;
                const client = invoice.client;
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
                    lines: correctionItems.map((item: any) => ({
                        id: `item-${item.order ?? 0}`,
                        description: item.description,
                        quantity: Math.abs(item.quantity),
                        unitNetMinor: item.unitPriceMinor ?? toMinor(item.unitPrice, invoice.currency),
                        supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
                    })),
                    issueDate,
                    currency: invoice.currency,
                };
                const correctionDoc = await this.complianceService.createDraft(complianceCtx, correctionKind as any, correctionInvoice.id);
                await this.complianceService.issue(correctionDoc.id);
            } catch (error) {
                logger.warn('ComplianceService wiring for correction failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
            }

            logger.info('Invoice corrected', { category: 'invoice', details: { invoiceId: id, correctionInvoiceId: correctionInvoice.id, correctionKind } });
            return {
                message: 'Correction issued',
                correctionInvoiceId: correctionInvoice.id,
                correctionNumber: correctionInvoice.rawNumber,
                correctionKind,
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

            // Reflect compliance status on the invoice (III.1 — single vocabulary)
            await prisma.invoice.update({
                where: { id },
                data: { status: 'CANCELLED' },
            });

            logger.info('Invoice cancelled', { category: 'invoice', details: { invoiceId: id } });
            return { message: 'Invoice cancelled', accepted: true };
        } catch (error) {
            logger.error('Failed to cancel invoice', { category: 'invoice', details: { error: String(error) } });
            throw new BadRequestException(`Failed to cancel invoice: ${(error as Error).message}`);
        }
    }

    async cancelAndReplaceInvoice(id: string, reason?: string) {
        const invoice = await prisma.invoice.findUnique({
            where: { id },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
            },
        });
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

            // Verify correctionModel is CANCEL_AND_REPLACE
            const storedPlan = complianceDoc.plan as any;
            const correctionModel = storedPlan?.lifecycle?.correctionModel;
            if (correctionModel !== 'CANCEL_AND_REPLACE') {
                throw new BadRequestException('Cancel-and-replace is not available for this country. Use correct instead.');
            }

            // Cancel the original via ComplianceService (policy-gated)
            const cancelResult = await this.complianceService.cancel(complianceDoc.id, { reason });
            if (!cancelResult.accepted) {
                return { message: 'Cancellation rejected', reason: cancelResult.reason };
            }

            await prisma.invoice.update({
                where: { id },
                data: { status: 'CANCELLED' },
            });

            // Create a replacement invoice (same content, numbered)
            const issueDate = new Date();
            const replacement = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const { counter, rawNumber } = await this.numberingService.nextNumber(
                    tx,
                    invoice.companyId,
                    'invoice',
                    issueDate,
                );

                return tx.invoice.create({
                    data: {
                        kind: 'INVOICE' as any,
                        correctsInvoiceId: id,
                        clientId: invoice.clientId,
                        companyId: invoice.companyId,
                        currency: invoice.currency,
                        number: counter,
                        rawNumber,
                        issuedAt: issueDate,
                        status: 'ISSUED',
                        dueDate: invoice.dueDate,
                        notes: reason || `Replacement of ${invoice.rawNumber || invoice.number}`,
                        discountRate: invoice.discountRate,
                        totalHT: invoice.totalHT,
                        totalVAT: invoice.totalVAT,
                        totalTTC: invoice.totalTTC,
                        totalHTMinor: invoice.totalHTMinor,
                        totalVATMinor: invoice.totalVATMinor,
                        totalTTCMinor: invoice.totalTTCMinor,
                        items: {
                            create: invoice.items.map((item, i) => ({
                                name: item.name,
                                description: item.description,
                                quantity: item.quantity,
                                unitPrice: item.unitPrice,
                                unitPriceMinor: item.unitPriceMinor,
                                vatRate: item.vatRate,
                                type: item.type,
                                order: i,
                                discountRate: item.discountRate,
                                discountAmount: item.discountAmount,
                                discountAmountMinor: item.discountAmountMinor,
                                chargeAmount: item.chargeAmount,
                                chargeAmountMinor: item.chargeAmountMinor,
                                chargeDescription: item.chargeDescription,
                                unitOfMeasure: item.unitOfMeasure,
                            })),
                        },
                    },
                    include: {
                        items: true,
                        client: { include: { partyIdentifiers: true } },
                        company: { include: { partyIdentifiers: true } },
                    },
                });
            });

            // Wire ComplianceService for the replacement (non-blocking)
            try {
                const company = invoice.company;
                const client = invoice.client;
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
                    lines: invoice.items.map((item) => ({
                        id: `item-${item.order ?? 0}`,
                        description: (item.description ?? '') as string,
                        quantity: item.quantity,
                        unitNetMinor: item.unitPriceMinor ?? toMinor(item.unitPrice, invoice.currency),
                        supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
                    })),
                    issueDate,
                    currency: invoice.currency,
                };
                const replacementDoc = await this.complianceService.createDraft(complianceCtx, 'INVOICE', replacement.id);
                await this.complianceService.issue(replacementDoc.id);
            } catch (error) {
                logger.warn('ComplianceService wiring for replacement failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
            }

            logger.info('Invoice cancelled and replaced', { category: 'invoice', details: { invoiceId: id, replacementId: replacement.id } });
            return {
                message: 'Invoice cancelled and replaced',
                replacementId: replacement.id,
                replacementNumber: replacement.rawNumber,
            };
        } catch (error) {
            logger.error('Failed to cancel and replace invoice', { category: 'invoice', details: { error: String(error) } });
            throw new BadRequestException(`Failed to cancel and replace invoice: ${(error as Error).message}`);
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
            // Check immutableAfter from the compliance plan — NEVER means always editable
            let immutableAfter = 'ISSUE'; // default
            try {
                const complianceDoc = await prisma.complianceDocument.findFirst({
                    where: { invoiceId: id },
                    orderBy: { createdAt: 'desc' },
                });
                if (complianceDoc?.plan) {
                    immutableAfter = (complianceDoc.plan as any)?.lifecycle?.immutableAfter ?? 'ISSUE';
                }
            } catch {
                // non-blocking: default to ISSUE
            }

            if (immutableAfter !== 'NEVER') {
                logger.error('Only DRAFT invoices can be edited', { category: 'invoice', details: { id, status: existingInvoice.status } });
                throw new BadRequestException('Only DRAFT invoices can be edited. Issued documents require a correction.');
            }
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
                                name: i.name,
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
                            name: i.name ?? i.description,
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
        return this.rendering.renderPdf(id);
    }

    async getInvoiceXMLFormat(id: string) {
        return this.rendering.renderXml(id);
    }

    async getInvoicePDFFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array> {
        return this.rendering.renderPdfFormat(invoiceId, format);
    }

    async createInvoiceFromQuote(body: CreateInvoiceFromQuoteDto) {
        const quote = await prisma.quote.findUnique({
            where: { id: body.quoteId },
            include: {
                items: true,
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
            }
        });

        if (!quote) {
            logger.error('Quote not found when creating invoice from quote', { category: 'invoice', details: { quoteId: body.quoteId } });
            throw new BadRequestException('Quote not found');
        }

        const invoicingStatus = await this.getQuoteInvoicingStatus(body.quoteId);

        if (invoicingStatus.remainingPercent <= 0) {
            logger.error('Quote has already been fully invoiced', { category: 'invoice', details: { quoteId: body.quoteId } });
            throw new BadRequestException('This quote has already been fully invoiced');
        }

        const quoteItemById = new Map<string, (typeof quote.items)[number]>(
            quote.items.map(item => [item.id, item] as const),
        );
        const remainingByItemId = new Map<string, number>(
            invoicingStatus.items.map(item => [item.quoteItemId, item.remainingQuantity] as const),
        );

        const invoiceItems = body.items
            .filter(line => line.quantity > 0)
            .map(line => {
                const quoteItem = quoteItemById.get(line.quoteItemId);
                if (!quoteItem) {
                    throw new BadRequestException(`Quote item ${line.quoteItemId} does not belong to quote ${body.quoteId}`);
                }
                const remaining = remainingByItemId.get(line.quoteItemId) ?? 0;
                if (line.quantity > remaining + 1e-9) {
                    throw new BadRequestException(`Requested quantity ${line.quantity} for item "${quoteItem.description}" exceeds remaining quantity ${remaining}`);
                }
                return {
                    name: quoteItem.name,
                    description: quoteItem.description ?? undefined,
                    quantity: line.quantity,
                    unitPrice: quoteItem.unitPrice,
                    vatRate: quoteItem.vatRate,
                    type: quoteItem.type,
                    order: quoteItem.order,
                    discountRate: quoteItem.discountRate,
                    discountAmount: quoteItem.discountAmount ?? undefined,
                    discountAmountMinor: quoteItem.discountAmountMinor ?? undefined,
                    chargeAmount: quoteItem.chargeAmount ?? undefined,
                    chargeAmountMinor: quoteItem.chargeAmountMinor ?? undefined,
                    chargeDescription: quoteItem.chargeDescription ?? undefined,
                    unitOfMeasure: quoteItem.unitOfMeasure,
                    quoteItemId: quoteItem.id,
                };
            });

        if (invoiceItems.length === 0) {
            throw new BadRequestException('No items selected to invoice');
        }

        const newInvoice = await this.createInvoice({
            clientId: quote.clientId,
            quoteId: quote.id,
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            items: invoiceItems,
            currency: quote.currency,
            notes: quote.notes || '',
            paymentMethodId: (quote as any).paymentMethodId || undefined,
            paymentMethod: (quote as any).paymentMethod || undefined,
            paymentDetails: (quote as any).paymentDetails || undefined,
        });

        logger.info('Invoice created from quote', { category: 'invoice', details: { invoiceId: newInvoice.id, quoteId: quote.id } });

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

    /**
     * Computes how much of each quote item has already been invoiced across
     * all invoices created from this quote, and the remaining invoicable total.
     */
    async getQuoteInvoicingStatus(quoteId: string) {
        const quote = await prisma.quote.findUnique({
            where: { id: quoteId },
            include: {
                items: {
                    include: {
                        // Soft-deleted invoices (isActive: false) must not count towards
                        // the invoiced quantity, otherwise deleting an invoice never
                        // frees up the quote items it was created from.
                        invoiceItems: { where: { invoice: { isActive: true } }, select: { quantity: true } },
                    },
                },
            },
        });

        if (!quote) {
            logger.error('Quote not found when computing invoicing status', { category: 'invoice', details: { quoteId } });
            throw new BadRequestException('Quote not found');
        }

        const discountFactor = 1 - clampDiscountRate(quote.discountRate) / 100;

        const items = quote.items.map(item => {
            const invoicedQuantity = item.invoiceItems.reduce((sum, inv) => sum + inv.quantity, 0);
            const remainingQuantity = Math.max(0, item.quantity - invoicedQuantity);
            const remainingTTC = remainingQuantity * item.unitPrice * discountFactor * (1 + (item.vatRate || 0) / 100);
            return {
                quoteItemId: item.id,
                name: item.name,
                description: item.description,
                quantity: item.quantity,
                invoicedQuantity,
                remainingQuantity,
                remainingTTC,
            };
        });

        const totalTTC = quote.totalTTC;
        const remainingTTC = items.reduce((sum, item) => sum + item.remainingTTC, 0);
        const remainingPercent = totalTTC > 0 ? (remainingTTC / totalTTC) * 100 : 0;

        return {
            items,
            totalTTC,
            remainingTTC,
            remainingPercent,
        };
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

        // Trigger compliance pipeline (sign → transmit → archive → report)
        try {
            const complianceDoc = await prisma.complianceDocument.findFirst({
                where: { invoiceId },
                orderBy: { createdAt: 'desc' },
            });
            if (complianceDoc) {
                const result = await this.complianceService.send(complianceDoc.id);
                logger.info('ComplianceService.send completed', {
                    category: 'invoice',
                    details: { invoiceId, complianceStatus: result.document.status },
                });
            }
        } catch (error) {
            logger.warn('ComplianceService.send failed (non-blocking)', {
                category: 'invoice',
                details: { error: String(error) },
            });
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

    // ──────────────────────────────────────────────────────────────────────
    //  III.4 — Proforma
    // ──────────────────────────────────────────────────────────────────────

    async createProformaInvoice(body: CreateInvoiceDto) {
        const { items, ...data } = body;

        const company = await prisma.company.findFirst({
            include: { partyIdentifiers: true },
        });
        if (!company) throw new BadRequestException('No company found. Please create a company first.');

        const client = await prisma.client.findUnique({
            where: { id: body.clientId },
            include: { partyIdentifiers: true },
        });
        if (!client) throw new BadRequestException('Client not found');

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
            logger.warn('Tax resolution warnings (proforma)', { category: 'invoice', details: { warnings: taxResult.warnings } });
        }

        const invoice = await prisma.invoice.create({
            data: {
                ...data,
                kind: 'PROFORMA',
                status: 'DRAFT',
                currency: body.currency || client.currency || company.currency,
                companyId: company.id,
                clientId: client.id,
                discountRate,
                totalHT: taxResult.totalHT,
                totalHTMinor: taxResult.totalsMinor.netMinor,
                totalVAT: taxResult.totalVAT,
                totalVATMinor: taxResult.totalsMinor.taxMinor,
                totalTTC: taxResult.totalTTC,
                totalTTCMinor: taxResult.totalsMinor.grossMinor,
                items: {
                    create: items.map((item, i) => ({
                        name: item.name,
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

        // Non-blocking: compliance draft (tracking only — proforma is never issued)
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
                    description: (item.description ?? '') as string,
                    quantity: item.quantity,
                    unitNetMinor: toMinor(item.unitPrice, body.currency || client.currency || company.currency),
                    supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
                })),
                issueDate: new Date(),
                currency: body.currency || client.currency || company.currency,
            };
            await this.complianceService.createDraft(complianceCtx, 'PROFORMA', invoice.id);
        } catch (error) {
            logger.warn('ComplianceService.createDraft failed for proforma (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        logger.info('Proforma created', { category: 'invoice', details: { invoiceId: invoice.id } });
        return invoice;
    }

    async convertProformaToInvoice(proformaId: string) {
        const proforma = await prisma.invoice.findUnique({
            where: { id: proformaId },
            include: { items: true },
        });

        if (!proforma) throw new BadRequestException('Invoice not found');
        if (proforma.kind !== 'PROFORMA') throw new BadRequestException('Only PROFORMA invoices can be converted');

        const newInvoice = await this.createInvoice({
            clientId: proforma.clientId,
            items: proforma.items.map(item => ({
                name: item.name,
                description: item.description ?? undefined,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                type: item.type,
                order: item.order,
                discountRate: item.discountRate,
                discountAmount: item.discountAmount ?? undefined,
                chargeAmount: item.chargeAmount ?? undefined,
                chargeDescription: item.chargeDescription ?? undefined,
                unitOfMeasure: item.unitOfMeasure,
            })),
            currency: proforma.currency,
            notes: proforma.notes || '',
            paymentMethodId: proforma.paymentMethodId || undefined,
            paymentMethod: proforma.paymentMethod || undefined,
            paymentDetails: proforma.paymentDetails || undefined,
            discountRate: proforma.discountRate ?? undefined,
            dueDate: proforma.dueDate,
            depositOfInvoiceId: proforma.depositOfInvoiceId || undefined,
        });

        logger.info('Proforma converted to invoice', { category: 'invoice', details: { proformaId, newInvoiceId: newInvoice.id } });
        return newInvoice;
    }

    // ──────────────────────────────────────────────────────────────────────
    //  III.4 — Deposit (standalone)
    // ──────────────────────────────────────────────────────────────────────

    async getUnlinkedDeposits(clientId: string) {
        return prisma.invoice.findMany({
            where: {
                clientId,
                kind: 'DEPOSIT',
                depositOfInvoiceId: null,
                isActive: true,
            },
            include: { items: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async createDepositInvoice(body: CreateInvoiceDto & { amount?: number; percentage?: number }) {
        const { items: _ignoredItems, amount, percentage, ...rest } = body as any;

        const company = await prisma.company.findFirst({
            include: { partyIdentifiers: true },
        });
        if (!company) throw new BadRequestException('No company found. Please create a company first.');

        const client = await prisma.client.findUnique({
            where: { id: body.clientId },
            include: { partyIdentifiers: true },
        });
        if (!client) throw new BadRequestException('Client not found');

        // Compute deposit total TTC from amount or percentage
        let depositTTC: number;
        if (typeof amount === 'number' && amount > 0) {
            depositTTC = amount;
        } else if (typeof percentage === 'number' && percentage > 0 && percentage <= 100) {
            // Standalone deposit: no parent invoice — percentage is of the body's own total (or 0).
            // When linked to a parent at final-creation time, the percentage semantics are:
            // "X% of the parent invoice total". For standalone creation, we require `amount`.
            throw new BadRequestException('Standalone deposit invoices require an explicit amount (percentage is only meaningful when linked to a parent invoice).');
        } else {
            throw new BadRequestException('Provide either amount or a valid percentage (1-100).');
        }

        // Use the compliance engine to resolve VAT on the deposit line.
        // amount is TTC (the user specifies the gross deposit). We derive HT
        // so that HT + VAT === TTC holds by construction.
        const discountRate = 0;
        const vatRate = body.items?.[0]?.vatRate ?? 20;
        const depositHT = depositTTC / (1 + vatRate / 100);
        const depositVAT = depositTTC - depositHT;

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
            items: [{ quantity: 1, unitPrice: depositHT, vatRate, supplyType: 'SERVICES' }],
        });

        const depositItemVatRate = taxResult.itemVatRates[0] ?? vatRate;

        const issueDate = new Date();
        const currency = body.currency || client.currency || company.currency;

        const depositInvoice = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const { counter, rawNumber } = await this.numberingService.nextNumber(tx, company.id, 'invoice', issueDate);

            return tx.invoice.create({
                data: {
                    kind: 'DEPOSIT',
                    status: 'ISSUED',
                    number: counter,
                    rawNumber,
                    issuedAt: issueDate,
                    clientId: client.id,
                    companyId: company.id,
                    currency,
                    dueDate: body.dueDate ? new Date(body.dueDate) : issueDate,
                    notes: body.notes || `Deposit invoice — standalone`,
                    totalHT: depositHT,
                    totalHTMinor: toMinor(depositHT, currency),
                    totalVAT: depositVAT,
                    totalVATMinor: toMinor(depositVAT, currency),
                    totalTTC: depositTTC,
                    totalTTCMinor: toMinor(depositTTC, currency),
                    items: {
                        create: [{
                            name: 'Deposit payment',
                            description: 'Deposit payment',
                            quantity: 1,
                            unitPrice: depositHT,
                            unitPriceMinor: toMinor(depositHT, currency),
                            vatRate: depositItemVatRate,
                            type: 'DEPOSIT',
                            order: 0,
                            unitOfMeasure: 'C62',
                        }],
                    },
                },
                include: {
                    items: true,
                    client: { include: { partyIdentifiers: true } },
                    company: { include: { partyIdentifiers: true } },
                },
            });
        });

        // Non-blocking: ComplianceService createDraft + issue
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
                lines: [{
                    id: 'deposit-line',
                    description: 'Deposit payment',
                    quantity: 1,
                    unitNetMinor: toMinor(depositHT, currency),
                    supplyType: 'SERVICES',
                }],
                issueDate,
                currency,
            };
            const doc = await this.complianceService.createDraft(complianceCtx, 'DEPOSIT', depositInvoice.id);
            await this.complianceService.issue(doc.id);
        } catch (error) {
            logger.warn('ComplianceService wiring for deposit failed (non-blocking)', { category: 'invoice', details: { error: String(error) } });
        }

        logger.info('Deposit invoice created', { category: 'invoice', details: { depositInvoiceId: depositInvoice.id, rawNumber: depositInvoice.rawNumber } });
        return depositInvoice;
    }

    // ──────────────────────────────────────────────────────────────────────
    //  III.4 — Final invoice (with deposit deduction)
    // ──────────────────────────────────────────────────────────────────────

    async createFinalInvoice(body: CreateInvoiceDto & { depositInvoiceIds: string[] }) {
        const { depositInvoiceIds, items, ...data } = body as any;

        if (!depositInvoiceIds?.length) {
            throw new BadRequestException('A final invoice must reference at least one deposit invoice.');
        }

        const company = await prisma.company.findFirst({
            include: { partyIdentifiers: true },
        });
        if (!company) throw new BadRequestException('No company found. Please create a company first.');

        const client = await prisma.client.findUnique({
            where: { id: body.clientId },
            include: { partyIdentifiers: true },
        });
        if (!client) throw new BadRequestException('Client not found');

        // Fetch all deposit invoices and validate
        const deposits = await prisma.invoice.findMany({
            where: { id: { in: depositInvoiceIds } },
            include: { items: true },
        });

        if (deposits.length !== depositInvoiceIds.length) {
            throw new BadRequestException('One or more deposit invoices not found.');
        }
        for (const dep of deposits) {
            if (dep.kind !== 'DEPOSIT') throw new BadRequestException(`Invoice ${dep.id} is not a deposit invoice (kind=${dep.kind}).`);
            if (dep.depositOfInvoiceId) throw new BadRequestException(`Deposit invoice ${dep.id} is already linked to another invoice.`);
            if (dep.clientId !== body.clientId) throw new BadRequestException(`Deposit invoice ${dep.id} belongs to a different client.`);
        }

        const currency = body.currency || client.currency || company.currency;
        const totalDeposited = deposits.reduce((sum, d) => sum + d.totalTTC, 0);

        // Compute VAT on the deduction line — [~] The VAT treatment of deposit deductions
        // is country-specific (FR: the deposit invoice already carried VAT, so the deduction
        // line is a credit of the same VAT). totalDeposited is TTC; derive HT to keep the
        // invariant HT+VAT===TTC.
        const depositVatRate = deposits[0]?.items?.[0]?.vatRate ?? 20;
        const deductionHT = -totalDeposited / (1 + depositVatRate / 100);
        const deductionVAT = -totalDeposited - deductionHT;

        const deductionTaxResult = resolveInvoiceTax({
            supplierCountryCode: company.countryCode ?? guessCountryCode(company.country),
            supplierExemptVat: !!company.exemptVat,
            supplierVatNumber: getIdentifier(company, 'VAT'),
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: getIdentifier(client, 'VAT'),
            currency,
            issueDate: new Date(),
            discountRate: 0,
            items: [{ quantity: 1, unitPrice: deductionHT, vatRate: depositVatRate, supplyType: 'SERVICES' }],
        });

        // Build the deduction line item
        const deductionLine = {
            description: `Deposit deduction (${deposits.length} deposit(s): ${deposits.map(d => d.rawNumber || d.number?.toString() || d.id.slice(0, 8)).join(', ')})`,
            quantity: 1,
            unitPrice: deductionHT,
            unitPriceMinor: toMinor(deductionHT, currency),
            vatRate: deductionTaxResult.itemVatRates[0] ?? depositVatRate,
            type: 'DEPOSIT' as const,
            order: (items?.length ?? 0),
            unitOfMeasure: 'C62',
        };

        const allItems = [
            ...(items ?? []).map((item: any, i: number) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                unitPriceMinor: toMinor(item.unitPrice, currency),
                vatRate: item.vatRate,
                type: item.type,
                order: i,
                discountRate: item.discountRate ?? 0,
                discountAmount: item.discountAmount ?? null,
                discountAmountMinor: item.discountAmount ? toMinor(item.discountAmount, currency) : null,
                chargeAmount: item.chargeAmount ?? null,
                chargeAmountMinor: item.chargeAmount ? toMinor(item.chargeAmount, currency) : null,
                chargeDescription: item.chargeDescription ?? null,
                unitOfMeasure: item.unitOfMeasure ?? 'C62',
            })),
            deductionLine,
        ];

        // Tax resolution for the full set (work items + deduction line)
        const fullTaxResult = resolveInvoiceTax({
            supplierCountryCode: company.countryCode ?? guessCountryCode(company.country),
            supplierExemptVat: !!company.exemptVat,
            supplierVatNumber: getIdentifier(company, 'VAT'),
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: getIdentifier(client, 'VAT'),
            currency,
            issueDate: new Date(),
            discountRate: clampDiscountRate(body.discountRate),
            items: allItems.map(item => ({
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
            })),
        });

        if (fullTaxResult.warnings.length > 0) {
            logger.warn('Tax resolution warnings (final invoice)', { category: 'invoice', details: { warnings: fullTaxResult.warnings } });
        }

        // Create the final invoice + link deposits in one transaction
        // NOTE: DRAFT = no number. The gapless number is assigned at issue() time.
        const finalInvoice = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const created = await tx.invoice.create({
                data: {
                    kind: 'FINAL',
                    status: 'DRAFT',
                    clientId: client.id,
                    companyId: company.id,
                    currency,
                    discountRate: clampDiscountRate(body.discountRate),
                    totalHT: fullTaxResult.totalHT,
                    totalHTMinor: fullTaxResult.totalsMinor.netMinor,
                    totalVAT: fullTaxResult.totalVAT,
                    totalVATMinor: fullTaxResult.totalsMinor.taxMinor,
                    totalTTC: fullTaxResult.totalTTC,
                    totalTTCMinor: fullTaxResult.totalsMinor.grossMinor,
                    dueDate: body.dueDate ? new Date(body.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                    notes: body.notes || '',
                    paymentMethodId: body.paymentMethodId,
                    items: {
                        create: allItems.map((item, i) => ({
                            ...item,
                            order: i,
                        })),
                    },
                },
                include: {
                    items: true,
                    client: { include: { partyIdentifiers: true } },
                    company: { include: { partyIdentifiers: true } },
                },
            });

            // Link deposit invoices to this final invoice
            await tx.invoice.updateMany({
                where: { id: { in: depositInvoiceIds } },
                data: { depositOfInvoiceId: created.id },
            });

            return created;
        });

        logger.info('Final invoice created', { category: 'invoice', details: { finalInvoiceId: finalInvoice.id, depositCount: deposits.length, totalDeposited } });
        return finalInvoice;
    }

    async getAvailableActions(id: string) {
        const invoice = await prisma.invoice.findUnique({ where: { id } });
        if (!invoice) throw new BadRequestException('Invoice not found');

        const complianceDoc = await prisma.complianceDocument.findFirst({
            where: { invoiceId: id },
            orderBy: { createdAt: 'desc' },
        });

        const isDraft = invoice.status === 'DRAFT';
        const isProforma = invoice.kind === 'PROFORMA';
        const isDeposit = invoice.kind === 'DEPOSIT';
        const isPlainInvoice = !invoice.kind || invoice.kind === 'INVOICE';
        const isIssued = invoice.status === 'ISSUED' || invoice.status === 'SENT';

        if (!complianceDoc || !complianceDoc.plan) {
            return {
                invoiceId: id,
                status: invoice.status,
                complianceStatus: complianceDoc?.status ?? null,
                immutableAfter: 'ISSUE',
                correctionModel: 'CREDIT_NOTE',
                cancellation: { allowed: false },
                actions: {
                    edit: isDraft && !isDeposit,
                    issue: isDraft && !isProforma,
                    correct: false,
                    cancel: false,
                    cancelAndReplace: false,
                    send: isIssued,
                    convertToInvoice: isProforma && isDraft,
                    deposit: isPlainInvoice && isIssued,
                },
                correctionKinds: ['CREDIT_NOTE'],
                flow: null,
            };
        }

        const plan = complianceDoc.plan as unknown as CompliancePlan;
        const lifecycle = plan.lifecycle;

        const pctx = phaseContextFromPlan(plan, defaultTransmissionRegistry);
        const graph = assembleLifecycle(plan, pctx);
        const runtime = new LifecycleRuntime(graph, complianceDoc.status as ComplianceStatus);
        const manualActions = new Set(
            runtime.availableActions()
                .map((t) => t.trigger.kind === 'MANUAL' ? t.trigger.action : null)
                .filter((a): a is string => a !== null),
        );

        let correctionKinds: string[];
        switch (lifecycle.correctionModel) {
            case 'CORRECTIVE_INVOICE': correctionKinds = ['CORRECTIVE_INVOICE']; break;
            case 'CANCEL_AND_REPLACE': correctionKinds = ['INVOICE']; break;
            default: correctionKinds = ['CREDIT_NOTE'];
        }

        let cancelReason: string | undefined;
        if (!lifecycle.cancellation?.allowed) {
            cancelReason = 'Cancellation not allowed by country policy; issue a credit note.';
        } else if (lifecycle.cancellation?.requiresAuthorityAck) {
            cancelReason = 'Requires authority acknowledgement.';
        } else if (lifecycle.cancellation?.requiresBuyerConsent) {
            cancelReason = 'Requires buyer consent.';
        }

        return {
            invoiceId: id,
            status: invoice.status,
            complianceStatus: complianceDoc.status,
            kind: invoice.kind,
            immutableAfter: lifecycle.immutableAfter,
            correctionModel: lifecycle.correctionModel,
            cancellation: {
                allowed: manualActions.has('cancel'),
                reason: cancelReason,
            },
            actions: {
                edit: isDraft && !isDeposit,
                issue: isDraft && !isProforma,
                correct: manualActions.has('correct'),
                cancel: manualActions.has('cancel'),
                cancelAndReplace: manualActions.has('cancel') && lifecycle.correctionModel === 'CANCEL_AND_REPLACE',
                send: isIssued,
                convertToInvoice: isProforma && isDraft,
                deposit: isPlainInvoice && isIssued,
            },
            correctionKinds,
            flow: describeFlow(plan, complianceDoc.status as ComplianceStatus),
        };
    }
}
