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

    /**
     * Dispatches a payment webhook event. The new PAYMENT_* event is emitted first,
     * then the deprecated RECEIPT_* alias is emitted for backward compatibility with
     * existing webhook subscriptions. The payload exposes both `payment` and the
     * deprecated `receipt` key so old and new formatters keep working.
     */
    private async dispatchPaymentEvent(
        current: WebhookEvent,
        deprecated: WebhookEvent,
        payload: { payment: any; invoice: any; client: any; company: any },
    ) {
        const fullPayload = { ...payload, receipt: payload.payment };
        for (const event of [current, deprecated]) {
            try {
                await this.webhookDispatcher.dispatch(event, fullPayload);
            } catch (error) {
                this.logger.error(`Failed to dispatch ${event} webhook`, error);
            }
        }
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

        const payments = await prisma.payment.findMany({
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

        const totalPayments = await prisma.payment.count();

        const paymentsWithPM = await Promise.all(payments.map(async (r: any) => {
            if (r.paymentMethodId) {
                const pm = await prisma.paymentMethod.findUnique({ where: { id: r.paymentMethodId } });
                return { ...r, paymentMethod: pm ?? r.paymentMethod };
            }
            return r;
        }));

        return { pageCount: Math.ceil(totalPayments / pageSize), payments: paymentsWithPM };
    }

    async searchPayments(query: string) {
        if (!query) {
            const results = await prisma.payment.findMany({
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

        const results = await prisma.payment.findMany({
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

    private async checkInvoiceAfterPayment(invoiceId: string) {
        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId }
        });

        if (!invoice) {
            logger.error('Invoice not found', { category: 'payment', details: { invoiceId } });
            throw new BadRequestException('Invoice not found');
        }

        if (invoice.status !== 'ARCHIVED') {
            const payments = await prisma.payment.findMany({
                where: { invoiceId },
                select: { totalPaid: true },
            });

            const totalPaid = payments.reduce((sum, payment) => sum + payment.totalPaid, 0);
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

        const payment = await prisma.payment.create({
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

        await this.checkInvoiceAfterPayment(invoice.id);

        await this.dispatchPaymentEvent(WebhookEvent.PAYMENT_CREATED, WebhookEvent.RECEIPT_CREATED, {
            payment,
            invoice,
            client: invoice.client,
            company: invoice.company,
        });

        logger.info('Payment created', { category: 'payment', details: { paymentId: payment.id, companyId: invoice.company?.id } });

        return payment;
    }

    async createPaymentFromInvoice(invoiceId: string, amount?: number) {
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
        const targetAmount = amount ?? invoice.totalTTC;
        const ratio = invoice.totalTTC > 0 ? targetAmount / invoice.totalTTC : 0;
        const newPayment = await this.createPayment({
            invoiceId: invoice.id,
            items: invoice.items.map(item => {
                const vatMultiplier = 1 + (item.vatRate || 0) / 100;
                const discountedBase = item.quantity * item.unitPrice * discountFactor;
                const amountPaid = discountedBase * vatMultiplier * ratio;
                return {
                    invoiceItemId: item.id,
                    amountPaid: amountPaid.toFixed(2),
                };
            }),
            paymentMethodId: invoice.paymentMethodId || undefined,
            paymentMethod: invoice.paymentMethod || '',
            paymentDetails: invoice.paymentDetails || '',
        });

        await this.dispatchPaymentEvent(WebhookEvent.PAYMENT_CREATED_FROM_INVOICE, WebhookEvent.RECEIPT_CREATED_FROM_INVOICE, {
            payment: newPayment,
            invoice,
            client: invoice.client,
            company: invoice.company,
        });

        logger.info('Payment created from invoice', { category: 'payment', details: { paymentId: newPayment.id, invoiceId } });

        return newPayment;
    }

    async editPayment(body: EditPaymentDto) {
        const existingPayment = await prisma.payment.findUnique({
            where: { id: body.id },
            include: {
                items: true,
            },
        });

        if (!existingPayment) {
            logger.error('Payment not found', { category: 'payment', details: { paymentId: body.id } });
            throw new BadRequestException('Payment not found');
        }

        const updatedPayment = await prisma.payment.update({
            where: { id: existingPayment.id },
            data: {
                items: {
                    deleteMany: { paymentId: existingPayment.id },
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

        await this.checkInvoiceAfterPayment(existingPayment.invoiceId);

        await this.dispatchPaymentEvent(WebhookEvent.PAYMENT_UPDATED, WebhookEvent.RECEIPT_UPDATED, {
            payment: updatedPayment,
            invoice: updatedPayment.invoice,
            client: updatedPayment.invoice.client,
            company: updatedPayment.invoice.company,
        });

        logger.info('Payment updated', { category: 'payment', details: { paymentId: updatedPayment.id } });

        return updatedPayment;
    }

    async deletePayment(id: string) {
        const existingPayment = await prisma.payment.findUnique({
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

        if (!existingPayment) {
            logger.error('Payment not found', { category: 'payment', details: { paymentId: id } });
            throw new BadRequestException('Payment not found');
        }

        await prisma.paymentItem.deleteMany({
            where: { paymentId: id },
        });

        await prisma.payment.delete({
            where: { id },
        });

        await this.checkInvoiceAfterPayment(existingPayment.invoiceId);

        await this.dispatchPaymentEvent(WebhookEvent.PAYMENT_DELETED, WebhookEvent.RECEIPT_DELETED, {
            payment: existingPayment,
            invoice: existingPayment.invoice,
            client: existingPayment.invoice.client,
            company: existingPayment.invoice.company,
        });

        logger.info('Payment deleted', { category: 'payment', details: { paymentId: id } });

        return { message: 'Payment deleted successfully' };
    }

    async getPaymentPdf(paymentId: string): Promise<Uint8Array> {
        const payment = await prisma.payment.findUnique({
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

        if (!payment) {
            logger.error('Payment not found', { category: 'payment', details: { paymentId } });
            throw new BadRequestException('Payment not found');
        }

        const { pdfConfig } = payment.invoice.company;
        const template = Handlebars.compile(baseTemplate);

        if (payment.invoice.client.name.length == 0) {
            payment.invoice.client.name = payment.invoice.client.contactFirstname + " " + payment.invoice.client.contactLastname
        }

        const paymentMethodLabels: Record<string, string> = {
            BANK_TRANSFER: pdfConfig.paymentMethodBankTransfer,
            PAYPAL: pdfConfig.paymentMethodPayPal,
            CASH: pdfConfig.paymentMethodCash,
            CHECK: pdfConfig.paymentMethodCheck,
            OTHER: pdfConfig.paymentMethodOther,
        };

        let paymentMethodName = payment.paymentMethod;
        let paymentDetails = payment.paymentDetails;

        if (payment.paymentMethodId) {
            const pm = await prisma.paymentMethod.findUnique({ where: { id: payment.paymentMethodId } });
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

        const normalizedDiscountRate = clampDiscountRate(payment.invoice.discountRate);
        const discountFactor = 1 - normalizedDiscountRate / 100;
        let totalBeforeDiscount = payment.totalPaid;
        if (discountFactor > 0 && discountFactor < 1 && payment.items.length > 0) {
            totalBeforeDiscount = payment.items.reduce((sum, item) => sum + (item.amountPaid / discountFactor), 0);
        }
        const discountAmountValue = Math.max(0, totalBeforeDiscount - payment.totalPaid);
        const hasDiscount = normalizedDiscountRate > 0 && discountAmountValue > 0;

        const html = template({
            number: payment.rawNumber || payment.number.toString(),
            paymentDate: formatDate(payment.invoice.company, new Date()),
            invoiceNumber: payment.invoice?.rawNumber || payment.invoice?.number?.toString() || '',
            client: payment.invoice.client,
            company: payment.invoice.company,
            currency: payment.invoice.currency,
            paymentMethod: paymentMethodName,
            totalAmount: payment.totalPaid.toFixed(2),
            totalBeforeDiscount: totalBeforeDiscount.toFixed(2),
            discountAmount: discountAmountValue.toFixed(2),
            discountRate: Number(normalizedDiscountRate.toFixed(2)),
            hasDiscount,

            items: payment.items.map(item => {
                const invoiceItem = payment.invoice.items.find(i => i.id === item.invoiceItemId);
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
                payment: pdfConfig.payment,
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

            vatExemptText: payment.invoice.company.exemptVat && (payment.invoice.company.country || '').toUpperCase() === 'FRANCE' ? 'TVA non applicable, art. 293 B du CGI' : null,
        });

        const pdfBuffer = await getPDF(html);
        return pdfBuffer;
    }


    async sendPaymentByEmail(id: string) {
        const payment = await prisma.payment.findUnique({
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

        if (!payment || !payment.invoice || !payment.invoice.client) {
            logger.error('Payment or associated invoice/client not found', { category: 'payment', details: { id } });
            throw new BadRequestException('Payment or associated invoice/client not found');
        }

        const pdfBuffer = await this.getPaymentPdf(id);

        const mailTemplate = await prisma.mailTemplate.findFirst({
            where: { type: 'PAYMENT' },
            select: { subject: true, body: true }
        });

        if (!mailTemplate) {
            logger.error('Email template for payment not found.', { category: 'payment' });
            throw new BadRequestException('Email template for payment not found.');
        }

        const paymentNumber = payment.rawNumber || payment.number.toString();
        const envVariables = {
            APP_URL: process.env.APP_URL,
            PAYMENT_NUMBER: paymentNumber,
            // Deprecated alias kept so legacy templates using {{RECEIPT_NUMBER}} keep working
            RECEIPT_NUMBER: paymentNumber,
            COMPANY_NAME: payment.invoice.company.name,
            CLIENT_NAME: payment.invoice.client.name,
        };

        if (!payment.invoice.client.contactEmail) {
            logger.error('Client has no email configured; payment not sent', { category: 'payment', details: { id } });
            throw new BadRequestException('Client has no email configured; payment not sent');
        }

        const mailOptions = {
            to: payment.invoice.client.contactEmail,
            subject: mailTemplate.subject.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
            html: mailTemplate.body.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
            attachments: [{
                filename: `payment-${payment.rawNumber || payment.number}.pdf`,
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
