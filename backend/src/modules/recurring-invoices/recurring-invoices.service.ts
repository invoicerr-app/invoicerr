import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Currency, WebhookEvent } from '../../../prisma/generated/prisma/client'

import { UpsertInvoicesDto } from '@/modules/recurring-invoices/dto/invoices.dto';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { resolveInvoiceTax } from '@/compliance/integration/invoice-tax';
import { toMinor } from '@/utils/financial';
import type { SupplyType } from '@/compliance/types';
import { getIdentifier } from '@/utils/entity-identifiers';
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
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                items: true,
                _count: { select: { generatedInvoices: true } },
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
        const company = await prisma.company.findFirst({
            include: { partyIdentifiers: true },
        });

        const client = await prisma.client.findUnique({
            where: { id: data.clientId },
            include: { partyIdentifiers: true },
        });
        if (!client) {
            logger.error('Client not found', { category: 'recurring-invoice' });
            throw new BadRequestException('Client not found');
        }

        const taxResult = resolveInvoiceTax({
            supplierCountryCode: company?.countryCode ?? guessCountryCode(company?.country),
            supplierExemptVat: !!company?.exemptVat,
            supplierVatNumber: getIdentifier(company, 'VAT'),
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: getIdentifier(client, 'VAT'),
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
        today.setHours(0, 0, 0, 0);

        // First occurrence is the next cycle from today (no force-to-Monday)
        const nextInvoiceDate = this.calculateNextInvoiceDate(today, data.frequency);

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
                autoIssue: data.autoIssue || false,
                autoSend: data.autoSend || false,
                nextInvoiceDate,
                currency: (data.currency as Currency) || Currency.USD,
                totalHT: taxResult.totalHT,
                totalHTMinor: taxResult.totalsMinor.netMinor,
                totalVAT: taxResult.totalVAT,
                totalVATMinor: taxResult.totalsMinor.taxMinor,
                totalTTC: taxResult.totalTTC,
                totalTTCMinor: taxResult.totalsMinor.grossMinor,
                items: {
                    create: data.items.map((item, index) => ({
                        name: item.name,
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        unitPriceMinor: toMinor(item.unitPrice, (data.currency as string) || client.currency || company?.currency || 'EUR'),
                        vatRate: taxResult.itemVatRates[index],
                        type: item.type,
                        order: item.order || index,
                    })),
                },
            },
            include: {
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
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
        const company = await prisma.company.findFirst({
            include: { partyIdentifiers: true },
        });

        const client = await prisma.client.findUnique({
            where: { id: data.clientId },
            include: { partyIdentifiers: true },
        });
        if (!client) {
            logger.error('Client not found', { category: 'recurring-invoice' });
            throw new BadRequestException('Client not found');
        }

        const taxResult = resolveInvoiceTax({
            supplierCountryCode: company?.countryCode ?? guessCountryCode(company?.country),
            supplierExemptVat: !!company?.exemptVat,
            supplierVatNumber: getIdentifier(company, 'VAT'),
            buyerCountryCode: client.countryCode ?? guessCountryCode(client.country),
            buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B',
            buyerVatNumber: getIdentifier(client, 'VAT'),
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

        // Only recalculate nextInvoiceDate if frequency actually changed
        const existing = await prisma.recurringInvoice.findUnique({ where: { id } });
        const frequencyChanged = existing && existing.frequency !== data.frequency;

        // Update recurring invoice
        const recurringInvoice = await prisma.recurringInvoice.update({
            where: { id },
            data: {
                notes: data.notes,
                paymentMethod: data.paymentMethod,
                paymentMethodId: data.paymentMethodId,
                paymentDetails: data.paymentDetails,
                ...(frequencyChanged ? { nextInvoiceDate: this.calculateNextInvoiceDate(new Date(), data.frequency) } : {}),
                frequency: data.frequency,
                count: data.count,
                until: data.until,
                autoIssue: data.autoIssue || false,
                autoSend: data.autoSend || false,
                currency: (data.currency as Currency) || Currency.USD,
                totalHT: taxResult.totalHT,
                totalHTMinor: taxResult.totalsMinor.netMinor,
                totalVAT: taxResult.totalVAT,
                totalVATMinor: taxResult.totalsMinor.taxMinor,
                totalTTC: taxResult.totalTTC,
                totalTTCMinor: taxResult.totalsMinor.grossMinor,
                items: {
                    deleteMany: {},
                    create: data.items.map((item, index) => ({
                        name: item.name,
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        unitPriceMinor: toMinor(item.unitPrice, (data.currency as string) || client.currency || company?.currency || 'EUR'),
                        vatRate: taxResult.itemVatRates[index],
                        type: item.type,
                        order: item.order || index,
                    })),
                },
            },
            include: {
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
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
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                items: true,
                generatedInvoices: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    select: {
                        id: true,
                        number: true,
                        rawNumber: true,
                        status: true,
                        totalTTC: true,
                        currency: true,
                        createdAt: true,
                        issuedAt: true,
                    },
                },
                _count: { select: { generatedInvoices: true } },
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
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
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

    async pauseRecurringInvoice(id: string) {
        const existing = await prisma.recurringInvoice.findUnique({ where: { id } });
        if (!existing) {
            throw new BadRequestException('Recurring invoice not found');
        }

        const updated = await prisma.recurringInvoice.update({
            where: { id },
            data: { paused: true },
            include: {
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                items: true,
            },
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECURRING_INVOICE_UPDATED, {
                recurringInvoice: updated,
                client: updated.client,
                company: updated.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECURRING_INVOICE_UPDATED webhook', error);
        }

        logger.info('Recurring invoice paused', { category: 'recurring-invoice', details: { invoiceId: id } });
        return updated;
    }

    async resumeRecurringInvoice(id: string) {
        const existing = await prisma.recurringInvoice.findUnique({ where: { id } });
        if (!existing) {
            throw new BadRequestException('Recurring invoice not found');
        }

        const updated = await prisma.recurringInvoice.update({
            where: { id },
            data: { paused: false },
            include: {
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                items: true,
            },
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECURRING_INVOICE_UPDATED, {
                recurringInvoice: updated,
                client: updated.client,
                company: updated.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECURRING_INVOICE_UPDATED webhook', error);
        }

        logger.info('Recurring invoice resumed', { category: 'recurring-invoice', details: { invoiceId: id } });
        return updated;
    }

    async skipNextRecurringInvoice(id: string) {
        const existing = await prisma.recurringInvoice.findUnique({ where: { id } });
        if (!existing) {
            throw new BadRequestException('Recurring invoice not found');
        }

        const updated = await prisma.recurringInvoice.update({
            where: { id },
            data: { skipNext: true },
            include: {
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                items: true,
            },
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECURRING_INVOICE_UPDATED, {
                recurringInvoice: updated,
                client: updated.client,
                company: updated.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECURRING_INVOICE_UPDATED webhook', error);
        }

        logger.info('Recurring invoice skip-next set', { category: 'recurring-invoice', details: { invoiceId: id } });
        return updated;
    }

    async endNowRecurringInvoice(id: string) {
        const existing = await prisma.recurringInvoice.findUnique({ where: { id } });
        if (!existing) {
            throw new BadRequestException('Recurring invoice not found');
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Set until = yesterday so the cron won't pick it up anymore
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const updated = await prisma.recurringInvoice.update({
            where: { id },
            data: {
                paused: true,
                until: yesterday,
            },
            include: {
                client: { include: { partyIdentifiers: true } },
                company: { include: { partyIdentifiers: true } },
                items: true,
            },
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECURRING_INVOICE_UPDATED, {
                recurringInvoice: updated,
                client: updated.client,
                company: updated.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECURRING_INVOICE_UPDATED webhook', error);
        }

        logger.info('Recurring invoice ended now', { category: 'recurring-invoice', details: { invoiceId: id } });
        return updated;
    }

    /**
     * Compute a deterministic period key from a planned date + frequency.
     * Exported for testing and consistency with cron.service.ts.
     */
    computePeriodKey(date: Date, frequency: string): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');

        switch (frequency) {
            case 'WEEKLY':
            case 'BIWEEKLY': {
                const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
                const dayNum = d.getUTCDay() || 7;
                d.setUTCDate(d.getUTCDate() + 4 - dayNum);
                const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
                return `${y}-W${String(weekNum).padStart(2, '0')}`;
            }
            case 'MONTHLY':
                return `${y}-${m}`;
            case 'BIMONTHLY':
                return `${y}-${m}`;
            case 'QUARTERLY': {
                const quarter = Math.floor(date.getMonth() / 3) + 1;
                return `${y}-Q${quarter}`;
            }
            case 'QUADMONTHLY':
                return `${y}-${m}`;
            case 'SEMIANNUALLY': {
                const half = date.getMonth() < 6 ? 'H1' : 'H2';
                return `${y}-${half}`;
            }
            case 'ANNUALLY':
                return `${y}`;
            default:
                return `${y}-${m}`;
        }
    }

    /**
     * Calculate the next invoice date from a given date + frequency.
     * Anchors on the day of month (monthly+) or day of week (weekly/biweekly).
     * Handles month overflow (e.g., Jan 31 → Feb gives Feb 28/29).
     */
    private calculateNextInvoiceDate(from: Date, frequency: string): Date {
        const nextDate = new Date(from);

        switch (frequency) {
            case 'WEEKLY':
                nextDate.setDate(nextDate.getDate() + 7);
                break;
            case 'BIWEEKLY':
                nextDate.setDate(nextDate.getDate() + 14);
                break;
            case 'MONTHLY': {
                const targetDay = from.getDate();
                nextDate.setMonth(nextDate.getMonth() + 1);
                if (nextDate.getDate() !== targetDay) {
                    nextDate.setDate(0); // last day of previous month
                }
                break;
            }
            case 'BIMONTHLY': {
                const targetDay = from.getDate();
                nextDate.setMonth(nextDate.getMonth() + 2);
                if (nextDate.getDate() !== targetDay) {
                    nextDate.setDate(0);
                }
                break;
            }
            case 'QUARTERLY': {
                const targetDay = from.getDate();
                nextDate.setMonth(nextDate.getMonth() + 3);
                if (nextDate.getDate() !== targetDay) {
                    nextDate.setDate(0);
                }
                break;
            }
            case 'QUADMONTHLY': {
                const targetDay = from.getDate();
                nextDate.setMonth(nextDate.getMonth() + 4);
                if (nextDate.getDate() !== targetDay) {
                    nextDate.setDate(0);
                }
                break;
            }
            case 'SEMIANNUALLY': {
                const targetDay = from.getDate();
                nextDate.setMonth(nextDate.getMonth() + 6);
                if (nextDate.getDate() !== targetDay) {
                    nextDate.setDate(0);
                }
                break;
            }
            case 'ANNUALLY': {
                const targetDay = from.getDate();
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                if (nextDate.getDate() !== targetDay) {
                    nextDate.setDate(0);
                }
                break;
            }
            default:
                nextDate.setMonth(nextDate.getMonth() + 1);
        }

        return nextDate;
    }
}
