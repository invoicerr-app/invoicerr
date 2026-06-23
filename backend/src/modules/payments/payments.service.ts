import * as Handlebars from 'handlebars';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CreatePaymentDto, EditPaymentDto } from '@/modules/payments/dto/payments.dto';
import { getInvertColor, getPDF } from '@/utils/pdf';

import { MailService } from '@/mail/mail.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { WebhookEvent } from '../../../prisma/generated/prisma/client';
import { baseTemplate } from '@/modules/payments/templates/base.template';
import { formatDate } from '@/utils/date';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { randomUUID } from 'crypto';
import { clampDiscountRate } from '@/utils/financial';

@Injectable()
export class PaymentsService {
    private readonly logger: Logger;

    constructor(
        private readonly mailService: MailService,
        private readonly webhookDispatcher: WebhookDispatcherService
    ) {
        this.logger = new Logger(PaymentsService.name);
    }

    async getPayments(page: string) {
        const pageNumber = parseInt(page, 10) || 1;
        const pageSize = 10;
        const skip = (pageNumber - 1) * pageSize;
        const company = await prisma.company.findFirst();

        if (!company) {
            logger.error('No company found. Please create a company first.', { category: 'payment' });
            throw new BadRequestException('No company found. Please create a company first.');
        }

        const receipts = await prisma.receipt.findMany({
            skip,
            take: pageSize,
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                items: true,
                invoice: {
                    include: {
                        items: true,
                        client: true,
                        quote: true,
                    }
                }
            },
        });

        const totalReceipts = await prisma.receipt.count();

        const receiptsWithPM = await Promise.all(receipts.map(async (r: any) => {
            if (r.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: r.paymentMethodId } });
                return { ...r, paymentMethod: pm ?? r.paymentMethod };
            }
            return r;
        }));

        return { pageCount: Math.ceil(totalReceipts / pageSize), payments: receiptsWithPM };
    }

    async searchPayments(query: string) {
        if (!query) {
            const results = await prisma.receipt.findMany({
                take: 10,
                orderBy: {
                    number: 'asc',
                },
                include: {
                    items: true,
                    invoice: {
                        include: {
                            client: true,
                            quote: true,
                        }
                    }
                },
            });

            const resultsWithPM = await Promise.all(results.map(async (r: any) => {
                if (r.paymentMethodId) {
                    const pm = await prisma.paymentMethod.findUnique({ where: { id: r.paymentMethodId } });
                    return { ...r, paymentMethod: pm ?? r.paymentMethod };
                }
                return r;
            }));

            return resultsWithPM;
        }

        const results = await prisma.receipt.findMany({
            where: {
                OR: [
                    { invoice: { quote: { title: { contains: query } } } },
                    { invoice: { client: { name: { contains: query } } } },
                ],
            },
            take: 10,
            orderBy: {
                number: 'asc',
            },
            include: {
                items: true,
                invoice: {
                    include: {
                        client: true,
                        quote: true,
                    }
                }
            },
        });

        const resultsWithPM = await Promise.all(results.map(async (r: any) => {
            if (r.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: r.paymentMethodId } });
                return { ...r, paymentMethod: pm ?? r.paymentMethod };
            }
            return r;
        }));

        return resultsWithPM;
    }

    private async checkInvoiceAfterReceipt(invoiceId: string) {
        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId }
        });

        if (!invoice) {
            logger.error('Invoice not found', { category: 'payment', details: { invoiceId } });
            throw new BadRequestException('Invoice not found');
        }

        if (invoice.status === 'UNPAID') {
            const receipts = await prisma.receipt.findMany({
                where: { invoiceId },
                select: { totalPaid: true },
            });

            const totalPaid = receipts.reduce((sum, receipt) => sum + receipt.totalPaid, 0);
            if (totalPaid >= invoice.totalTTC) {
                await prisma.invoice.update({
                    where: { id: invoiceId },
                    data: { status: 'PAID' },
                });
            } else {
                await prisma.invoice.update({
                    where: { id: invoiceId },
                    data: { status: 'UNPAID' },
                });
            }
        }
    }

    async createPayment(body: CreatePaymentDto) {
        const invoice = await prisma.invoice.findUnique({
            where: { id: body.invoiceId },
            include: {
                company: true,
                client: true,
                items: true,
            },
        });

        if (!invoice) {
            logger.error('Invoice not found', { category: 'payment', details: { invoiceId: body.invoiceId } });
            throw new BadRequestException('Invoice not found');
        }

        const receipt = await prisma.receipt.create({
            data: {
                invoiceId: body.invoiceId,
                items: {
                    create: body.items.map(item => ({
                        invoiceItemId: item.invoiceItemId,
                        amountPaid: +item.amountPaid,
                    })),
                },
                totalPaid: body.items.reduce((sum, item) => sum + +item.amountPaid, 0),
                paymentMethodId: body.paymentMethodId,
                paymentMethod: body.paymentMethod,
                paymentDetails: body.paymentDetails,
            },
            include: {
                items: true,
            },
        });

        await this.checkInvoiceAfterReceipt(invoice.id);

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_CREATED, {
                receipt,
                invoice,
                client: invoice.client,
                company: invoice.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECEIPT_CREATED webhook', error);
        }

        logger.info('Payment created', { category: 'payment', details: { receiptId: receipt.id, companyId: invoice.company?.id } });

        return receipt;
    }

    async createPaymentFromInvoice(invoiceId: string) {
        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: {
                items: true,
                client: true,
                company: true,
            },
        });
        if (!invoice) {
            logger.error('Invoice not found', { category: 'payment', details: { invoiceId } });
            throw new BadRequestException('Invoice not found');
        }

        const discountFactor = 1 - clampDiscountRate(invoice.discountRate) / 100;
        const newReceipt = await this.createPayment({
            invoiceId: invoice.id,
            items: invoice.items.map(item => {
                const vatMultiplier = 1 + (item.vatRate || 0) / 100;
                const discountedBase = item.quantity * item.unitPrice * discountFactor;
                const amountPaid = discountedBase * vatMultiplier;
                return {
                    invoiceItemId: item.id,
                    amountPaid: amountPaid.toFixed(2),
                };
            }),
            paymentMethodId: invoice.paymentMethodId || undefined,
            paymentMethod: invoice.paymentMethod || '',
            paymentDetails: invoice.paymentDetails || '',
        });

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_CREATED_FROM_INVOICE, {
                receipt: newReceipt,
                invoice,
                client: invoice.client,
                company: invoice.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECEIPT_CREATED_FROM_INVOICE webhook', error);
        }

        logger.info('Payment created from invoice', { category: 'payment', details: { receiptId: newReceipt.id, invoiceId } });

        return newReceipt;
    }

    async editPayment(body: EditPaymentDto) {
        const existingReceipt = await prisma.receipt.findUnique({
            where: { id: body.id },
            include: {
                items: true,
            },
        });

        if (!existingReceipt) {
            logger.error('Payment not found', { category: 'payment', details: { receiptId: body.id } });
            throw new BadRequestException('Payment not found');
        }

        const updatedReceipt = await prisma.receipt.update({
            where: { id: existingReceipt.id },
            data: {
                items: {
                    deleteMany: { receiptId: existingReceipt.id },
                    createMany: {
                        data: body.items.map(item => ({
                            id: randomUUID(),
                            invoiceItemId: item.invoiceItemId,
                            amountPaid: +item.amountPaid,
                        })),
                    },
                },
                totalPaid: body.items.reduce((sum, item) => sum + +item.amountPaid, 0),
                paymentMethodId: body.paymentMethodId,
                paymentMethod: body.paymentMethod,
                paymentDetails: body.paymentDetails,
            },
            include: {
                items: true,
                invoice: {
                    include: {
                        client: true,
                        company: true,
                    }
                },
            },
        });

        await this.checkInvoiceAfterReceipt(existingReceipt.invoiceId);

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_UPDATED, {
                receipt: updatedReceipt,
                invoice: updatedReceipt.invoice,
                client: updatedReceipt.invoice.client,
                company: updatedReceipt.invoice.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECEIPT_UPDATED webhook', error);
        }

        logger.info('Payment updated', { category: 'payment', details: { receiptId: updatedReceipt.id } });

        return updatedReceipt;
    }

    async deletePayment(id: string) {
        const existingReceipt = await prisma.receipt.findUnique({
            where: { id },
            include: {
                items: true,
                invoice: {
                    include: {
                        client: true,
                        company: true,
                    }
                }
            }
        });

        if (!existingReceipt) {
            logger.error('Payment not found', { category: 'payment', details: { receiptId: id } });
            throw new BadRequestException('Payment not found');
        }

        await prisma.receiptItem.deleteMany({
            where: { receiptId: id },
        });

        await prisma.receipt.delete({
            where: { id },
        });

        await this.checkInvoiceAfterReceipt(existingReceipt.invoiceId);

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.RECEIPT_DELETED, {
                receipt: existingReceipt,
                invoice: existingReceipt.invoice,
                client: existingReceipt.invoice.client,
                company: existingReceipt.invoice.company,
            });
        } catch (error) {
            this.logger.error('Failed to dispatch RECEIPT_DELETED webhook', error);
        }

        logger.info('Payment deleted', { category: 'payment', details: { receiptId: id } });

        return { message: 'Payment deleted successfully' };
    }

    async getPaymentPdf(paymentId: string): Promise<Uint8Array> {
        const receipt = await prisma.receipt.findUnique({
            where: { id: paymentId },
            include: {
                items: true,
                invoice: {
                    include: {
                        items: true,
                        client: true,
                        company: {
                            include: { pdfConfig: true },
                        },
                    },
                }
            },
        });

        if (!receipt) {
            logger.error('Payment not found', { category: 'payment', details: { paymentId } });
            throw new BadRequestException('Payment not found');
        }

        const { pdfConfig } = receipt.invoice.company;
        const template = Handlebars.compile(baseTemplate);

        if (receipt.invoice.client.name.length == 0) {
            receipt.invoice.client.name = receipt.invoice.client.contactFirstname + " " + receipt.invoice.client.contactLastname
        }

        const paymentMethodLabels: Record<string, string> = {
            BANK_TRANSFER: pdfConfig.paymentMethodBankTransfer,
            PAYPAL: pdfConfig.paymentMethodPayPal,
            CASH: pdfConfig.paymentMethodCash,
            CHECK: pdfConfig.paymentMethodCheck,
            OTHER: pdfConfig.paymentMethodOther,
        };

        let paymentMethodName = receipt.paymentMethod;
        let paymentDetails = receipt.paymentDetails;

        if (receipt.paymentMethodId) {
            const pm = await prisma.paymentMethod.findUnique({ where: { id: receipt.paymentMethodId } });
            if (pm) {
                paymentMethodName = paymentMethodLabels[pm.type as string] || pm.type;
                paymentDetails = pm.details || paymentDetails;
            }
        } else {
            if (paymentMethodName && paymentMethodLabels[paymentMethodName.toUpperCase()]) {
                paymentMethodName = paymentMethodLabels[paymentMethodName.toUpperCase()];
            }
        }

        const itemTypeLabels: Record<string, string> = {
            HOUR: pdfConfig.hour,
            DAY: pdfConfig.day,
            DEPOSIT: pdfConfig.deposit,
            SERVICE: pdfConfig.service,
            PRODUCT: pdfConfig.product,
        };

        const normalizedDiscountRate = clampDiscountRate(receipt.invoice.discountRate);
        const discountFactor = 1 - normalizedDiscountRate / 100;
        let totalBeforeDiscount = receipt.totalPaid;
        if (discountFactor > 0 && discountFactor < 1 && receipt.items.length > 0) {
            totalBeforeDiscount = receipt.items.reduce((sum, item) => sum + (item.amountPaid / discountFactor), 0);
        }
        const discountAmountValue = Math.max(0, totalBeforeDiscount - receipt.totalPaid);
        const hasDiscount = normalizedDiscountRate > 0 && discountAmountValue > 0;

        const html = template({
            number: receipt.rawNumber || receipt.number.toString(),
            paymentDate: formatDate(receipt.invoice.company, new Date()),
            invoiceNumber: receipt.invoice?.rawNumber || receipt.invoice?.number?.toString() || '',
            client: receipt.invoice.client,
            company: receipt.invoice.company,
            currency: receipt.invoice.currency,
            paymentMethod: paymentMethodName,
            totalAmount: receipt.totalPaid.toFixed(2),
            totalBeforeDiscount: totalBeforeDiscount.toFixed(2),
            discountAmount: discountAmountValue.toFixed(2),
            discountRate: Number(normalizedDiscountRate.toFixed(2)),
            hasDiscount,

            items: receipt.items.map(item => {
                const invoiceItem = receipt.invoice.items.find(i => i.id === item.invoiceItemId);
                return {
                    description: invoiceItem?.description || 'N/A',
                    type: itemTypeLabels[invoiceItem?.type as string] || invoiceItem?.type || '',
                    amount: item.amountPaid.toFixed(2),
                };
            }),

            fontFamily: pdfConfig.fontFamily ?? 'Inter',
            primaryColor: pdfConfig.primaryColor ?? '#0ea5e9',
            secondaryColor: pdfConfig.secondaryColor ?? '#f3f4f6',
            tableTextColor: getInvertColor(pdfConfig.secondaryColor),
            includeLogo: !!pdfConfig.logoB64,
            logoB64: pdfConfig.logoB64 ?? '',
            padding: pdfConfig.padding ?? 40,

            labels: {
                receipt: pdfConfig.receipt,
                paymentDate: pdfConfig.paymentDate,
                receivedFrom: pdfConfig.receivedFrom,
                invoiceRefer: pdfConfig.invoiceRefer,
                description: pdfConfig.description,
                type: pdfConfig.type,
                discount: pdfConfig.discount,
                totalReceived: pdfConfig.totalReceived,
                paymentMethod: pdfConfig.paymentMethod,
                paymentDetails: pdfConfig.paymentDetails,
                legalId: pdfConfig.legalId,
                VATId: pdfConfig.VATId,
                hour: pdfConfig.hour,
                day: pdfConfig.day,
                deposit: pdfConfig.deposit,
                service: pdfConfig.service,
                product: pdfConfig.product
            },

            vatExemptText: receipt.invoice.company.exemptVat && (receipt.invoice.company.country || '').toUpperCase() === 'FRANCE' ? 'TVA non applicable, art. 293 B du CGI' : null,
        });

        const pdfBuffer = await getPDF(html);
        return pdfBuffer;
    }


    async sendPaymentByEmail(id: string) {
        const receipt = await prisma.receipt.findUnique({
            where: { id },
            include: {
                invoice: {
                    include: {
                        client: true,
                        company: true,
                    }
                }
            },
        });

        if (!receipt || !receipt.invoice || !receipt.invoice.client) {
            logger.error('Payment or associated invoice/client not found', { category: 'payment', details: { id } });
            throw new BadRequestException('Payment or associated invoice/client not found');
        }

        const pdfBuffer = await this.getPaymentPdf(id);

        const mailTemplate = await prisma.mailTemplate.findFirst({
            where: { type: 'RECEIPT' },
            select: { subject: true, body: true }
        });

        if (!mailTemplate) {
            logger.error('Email template for payment not found.', { category: 'payment' });
            throw new BadRequestException('Email template for payment not found.');
        }

        const envVariables = {
            APP_URL: process.env.APP_URL,
            RECEIPT_NUMBER: receipt.rawNumber || receipt.number.toString(),
            COMPANY_NAME: receipt.invoice.company.name,
            CLIENT_NAME: receipt.invoice.client.name,
        };

        if (!receipt.invoice.client.contactEmail) {
            logger.error('Client has no email configured; payment not sent', { category: 'payment', details: { id } });
            throw new BadRequestException('Client has no email configured; payment not sent');
        }

        const mailOptions = {
            to: receipt.invoice.client.contactEmail,
            subject: mailTemplate.subject.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
            html: mailTemplate.body.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
            attachments: [{
                filename: `payment-${receipt.rawNumber || receipt.number}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
            }],
        };

        try {
            await this.mailService.sendMail(mailOptions);
        } catch (error) {
            logger.error('Failed to send payment email', { category: 'payment', details: { error } });
            throw new BadRequestException('Failed to send payment email. Please check your SMTP configuration.');
        }

        return { message: 'Payment sent successfully' };
    }
}
