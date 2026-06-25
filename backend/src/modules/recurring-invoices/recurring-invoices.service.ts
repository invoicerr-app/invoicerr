import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Currency, WebhookEvent } from '../../../prisma/generated/prisma/client'

import { UpsertInvoicesDto } from '@/modules/recurring-invoices/dto/invoices.dto';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { resolveInvoiceTax } from '@/compliance/integration/invoice-tax';
import type { SupplyType } from '@/compliance/types';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

@Injectable()
export class RecurringInvoicesService {
    private readonly logger: Logger;

    constructor(private readonly webhookDispatcher: WebhookDispatcherService) {
        this.logger = new Logger(RecurringInvoicesService.name);
    }

    async getRecurringInvoices(page: string = "1") {
        const pageNumber = parseInt(page, 10) || 1;
        const pageSize = 10;
        const skip = (pageNumber - 1) * pageSize;

        const recurringInvoices = await prisma.recurringInvoice.findMany({
            skip,
            take: pageSize,
            include: {
                client: true,
                company: true,
                items: true,
            },
        });

        const totalCount = await prisma.recurringInvoice.count();

        // Attach payment method object if available so frontend can consume recurringInvoice.paymentMethod as an object
        const recurringInvoicesWithPM = await Promise.all(recurringInvoices.map(async (ri: any) => {
            if (ri.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: ri.paymentMethodId } });
                return { ...ri, paymentMethod: pm ?? ri.paymentMethod };
            }
            return ri;
        }));

        return {
            pageCount: Math.ceil(totalCount / pageSize),
            recurringInvoices: recurringInvoicesWithPM,
        };
    }

    async createRecurringInvoice(data: UpsertInvoicesDto) {
        const company = await prisma.company.findFirst();

        const client = await prisma.client.findUnique({
            where: { id: data.clientId },
        });
        if (!client) {
            logger.error('Client not found', { category: 'recurring-invoice' });
            throw new BadRequestException('Client not found');
        }

        const taxResult = resolveInvoiceTax({
            supplierCountryCode: company?.countryCode ?? guessCountryCode(company?.country),
            supplierExemptVat: !!company?.exemptVat,
            supplierVatNumber: company?.VAT,
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: client.VAT,
            currency: (data.currency as string) || client.currency || company?.currency || 'EUR',
            issueDate: new Date(),
            discountRate: 0,
            items: data.items.map(item => ({
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
            })),
        });

        if (taxResult.warnings.length > 0) {
            logger.warn('Tax resolution warnings', { category: 'recurring-invoice', details: { warnings: taxResult.warnings } });
        }

        const today = new Date();
        const nextMonday = new Date(today);
        const dayOfWeek = today.getDay();
        const daysUntilNextMonday = (dayOfWeek === 0 ? 1 : 8) - dayOfWeek;
        nextMonday.setDate(today.getDate() + daysUntilNextMonday);

        const nextInvoiceDate = this.calculateNextInvoiceDate(nextMonday, data.frequency);

        const recurringInvoice = await prisma.recurringInvoice.create({
            data: {
                clientId: data.clientId,
                companyId: company?.id || "1",
                notes: data.notes,
                paymentMethod: data.paymentMethod,
                paymentMethodId: data.paymentMethodId,
                paymentDetails: data.paymentDetails,
                frequency: data.frequency,
                count: data.count,
                until: data.until,
                autoSend: data.autoSend || false,
                nextInvoiceDate,
                currency: (data.currency as Currency) || Currency.USD,
                totalHT: taxResult.totalHT,
                totalVAT: taxResult.totalVAT,
                totalTTC: taxResult.totalTTC,
                items: {
                    create: data.items.map((item, index) => ({
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        vatRate: taxResult.itemVatRates[index],
                        type: item.type,
                        order: item.order || index,
                    })),
                },
            },
            include: {
                client: true,
                company: true,
                items: true,
            },
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECURRING_INVOICE_CREATED, {
                recurringInvoice,
                client: recurringInvoice.client,
                company: recurringInvoice.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECURRING_INVOICE_CREATED webhook', error);
        }

        logger.info('Recurring invoice created', { category: 'recurring-invoice', details: { invoiceId: recurringInvoice.id, companyId: company?.id } });

        return recurringInvoice;
    }

    async updateRecurringInvoice(id: string, data: UpsertInvoicesDto) {
        const company = await prisma.company.findFirst();

        const client = await prisma.client.findUnique({
            where: { id: data.clientId },
        });
        if (!client) {
            logger.error('Client not found', { category: 'recurring-invoice' });
            throw new BadRequestException('Client not found');
        }

        const taxResult = resolveInvoiceTax({
            supplierCountryCode: company?.countryCode ?? guessCountryCode(company?.country),
            supplierExemptVat: !!company?.exemptVat,
            supplierVatNumber: company?.VAT,
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: client.VAT,
            currency: (data.currency as string) || client.currency || company?.currency || 'EUR',
            issueDate: new Date(),
            discountRate: 0,
            items: data.items.map(item => ({
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
            })),
        });

        if (taxResult.warnings.length > 0) {
            logger.warn('Tax resolution warnings', { category: 'recurring-invoice', details: { warnings: taxResult.warnings } });
        }

        // Update recurring invoice
        const recurringInvoice = await prisma.recurringInvoice.update({
            where: { id },
            data: {
                notes: data.notes,
                paymentMethod: data.paymentMethod,
                paymentMethodId: data.paymentMethodId,
                paymentDetails: data.paymentDetails,
                nextInvoiceDate: this.calculateNextInvoiceDate(new Date(), data.frequency),
                frequency: data.frequency,
                count: data.count,
                until: data.until,
                autoSend: data.autoSend || false,
                currency: (data.currency as Currency) || Currency.USD,
                totalHT: taxResult.totalHT,
                totalVAT: taxResult.totalVAT,
                totalTTC: taxResult.totalTTC,
                items: {
                    deleteMany: {},
                    create: data.items.map((item, index) => ({
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        vatRate: taxResult.itemVatRates[index],
                        type: item.type,
                        order: item.order || index,
                    })),
                },
            },
            include: {
                client: true,
                company: true,
                items: true,
            },
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECURRING_INVOICE_UPDATED, {
                recurringInvoice,
                client: recurringInvoice.client,
                company: recurringInvoice.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECURRING_INVOICE_UPDATED webhook', error);
        }

        logger.info('Recurring invoice updated', { category: 'recurring-invoice', details: { invoiceId: recurringInvoice.id, companyId: company?.id } });

        return recurringInvoice;
    }

    async getRecurringInvoice(id: string) {
        const recurringInvoice = await prisma.recurringInvoice.findUnique({
            where: { id },
            include: {
                client: true,
                company: true,
                items: true,
            },
        });

        if (!recurringInvoice) {
            logger.error('Recurring invoice not found', { category: 'recurring-invoice' });
            throw new BadRequestException('Recurring invoice not found');
        }

        if (recurringInvoice.paymentMethodId) {
            const pm = await prisma.paymentMethod.findUnique({ where: { id: recurringInvoice.paymentMethodId } });
            if (pm) {
                (recurringInvoice as any).paymentMethod = pm;
            }
        }

        return recurringInvoice;
    }

    async deleteRecurringInvoice(id: string) {
        const existingRecurringInvoice = await prisma.recurringInvoice.findUnique({
            where: { id },
            include: {
                client: true,
                company: true,
                items: true,
            }
        });

        if (!existingRecurringInvoice) {
            logger.error('Recurring invoice not found', { category: 'recurring-invoice' });
            throw new BadRequestException('Recurring invoice not found');
        }

        await prisma.recurringInvoiceItem.deleteMany({
            where: { recurringInvoiceId: id }
        });

        const deletedRecurringInvoice = await prisma.recurringInvoice.delete({
            where: { id }
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECURRING_INVOICE_DELETED, {
                recurringInvoice: existingRecurringInvoice,
                client: existingRecurringInvoice.client,
                company: existingRecurringInvoice.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECURRING_INVOICE_DELETED webhook', error);
        }

        logger.info('Recurring invoice deleted', { category: 'recurring-invoice', details: { invoiceId: id } });

        return deletedRecurringInvoice;
    }

    private calculateNextInvoiceDate(from: Date, frequency: string): Date {
        const nextDate = new Date(from);

        switch (frequency) {
            case 'WEEKLY':
                nextDate.setDate(nextDate.getDate() + 7);
                break;
            case 'BIWEEKLY':
                nextDate.setDate(nextDate.getDate() + 14);
                break;
            case 'MONTHLY':
                nextDate.setMonth(nextDate.getMonth() + 1);
                break;
            case 'BIMONTHLY':
                nextDate.setMonth(nextDate.getMonth() + 2);
                break;
            case 'QUARTERLY':
                nextDate.setMonth(nextDate.getMonth() + 3);
                break;
            case 'QUADMONTHLY':
                nextDate.setMonth(nextDate.getMonth() + 4);
                break;
            case 'SEMIANNUALLY':
                nextDate.setMonth(nextDate.getMonth() + 6);
                break;
            case 'ANNUALLY':
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                break;
            default:
                nextDate.setMonth(nextDate.getMonth() + 1); // Default to monthly
        }

        return nextDate;
    }
}
