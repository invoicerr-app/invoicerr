import { InvoicesService } from '@/modules/invoices/invoices.service';
import prisma from '@/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';

import { Cron } from '@nestjs/schedule';

@Injectable()
export class RecurringInvoicesCronService {
    private readonly logger = new Logger(RecurringInvoicesCronService.name);

    constructor(
        private readonly invoicesService: InvoicesService,
    ) { }

    // Every day at 9:00 AM
    @Cron('0 9 * * *', {
        name: 'process-recurring-invoices',
        timeZone: 'Europe/Paris',
    })
    async processRecurringInvoices() {
        this.logger.log('Starting recurring invoices processing...');

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const recurringInvoices = await prisma.recurringInvoice.findMany({
                where: {
                    paused: false,
                    nextInvoiceDate: {
                        lte: today,
                    },
                    OR: [
                        { until: null },
                        { until: { gte: today } },
                    ],
                },
                include: {
                    client: true,
                    company: true,
                    items: true,
                },
            });

            this.logger.log(`Found ${recurringInvoices.length} recurring invoices to process`);

            for (const recurringInvoice of recurringInvoices) {
                try {
                    // Check count limit before entering the catch-up loop
                    if (recurringInvoice.count) {
                        const generatedCount = await prisma.invoice.count({
                            where: {
                                recurringInvoiceId: recurringInvoice.id,
                            },
                        });

                        if (generatedCount >= recurringInvoice.count) {
                            this.logger.log(`Recurring invoice ${recurringInvoice.id} has reached its count limit`);
                            continue;
                        }
                    }

                    // Catch-up: generate each missed cycle individually with its own planned date
                    let cycleDate = new Date(recurringInvoice.nextInvoiceDate!);
                    cycleDate.setHours(0, 0, 0, 0);

                    // Handle skipNext: advance past the first cycle and reset the flag
                    if (recurringInvoice.skipNext) {
                        const skippedDate = new Date(cycleDate);
                        cycleDate = this.calculateNextInvoiceDate(cycleDate, recurringInvoice.frequency);
                        await prisma.recurringInvoice.update({
                            where: { id: recurringInvoice.id },
                            data: { skipNext: false, nextInvoiceDate: cycleDate },
                        });
                        this.logger.log(`Skipped next cycle (${skippedDate.toISOString()}) for recurring ${recurringInvoice.id}`);
                    }

                    while (cycleDate <= today) {
                        // Stop if count limit reached
                        if (recurringInvoice.count) {
                            const generatedCount = await prisma.invoice.count({
                                where: { recurringInvoiceId: recurringInvoice.id },
                            });
                            if (generatedCount >= recurringInvoice.count) {
                                break;
                            }
                        }

                        // Compute deterministic period key for this cycle
                        const periodKey = this.computePeriodKey(cycleDate, recurringInvoice.frequency);

                        // Idempotence: try to create; unique constraint catches duplicates
                        try {
                            const invoice = await this.invoicesService.createInvoice({
                                clientId: recurringInvoice.clientId,
                                recurringInvoiceId: recurringInvoice.id,
                                recurringPeriodKey: periodKey,
                                currency: recurringInvoice.currency,
                                notes: recurringInvoice.notes || '',
                                paymentMethodId: recurringInvoice.paymentMethodId || undefined,
                                paymentMethod: recurringInvoice.paymentMethod || undefined,
                                paymentDetails: recurringInvoice.paymentDetails || undefined,
                                dueDate: new Date(cycleDate.getTime() + 14 * 24 * 60 * 60 * 1000),
                                items: recurringInvoice.items.map(item => ({
                                    name: item.name,
                                    description: item.description ?? undefined,
                                    quantity: item.quantity,
                                    unitPrice: item.unitPrice,
                                    vatRate: item.vatRate,
                                    type: (item as any).type,
                                    order: item.order,
                                })),
                            });

                            // autoIssue: assign number + transition to ISSUED
                            let issuedInvoice = invoice;
                            if (recurringInvoice.autoIssue) {
                                try {
                                    issuedInvoice = await this.invoicesService.issueInvoice(invoice.id);
                                } catch (issueError) {
                                    this.logger.error(`Failed to auto-issue invoice ${invoice.id} for period ${periodKey}:`, issueError);
                                    // Invoice stays DRAFT — will be retried next cron run
                                    // Do NOT advance nextInvoiceDate past this cycle
                                    break;
                                }
                            }

                            // autoSend: send email (only if issued)
                            if (recurringInvoice.autoSend && issuedInvoice.status === 'ISSUED') {
                                try {
                                    await this.invoicesService.sendInvoiceByEmail(issuedInvoice.id);
                                } catch (emailError) {
                                    this.logger.error(`Failed to auto-send invoice ${invoice.id}:`, emailError);
                                    // Invoice stays ISSUED — send should be retried via outbox (PART IX)
                                    // Do NOT advance nextInvoiceDate past this cycle
                                    break;
                                }
                            }

                            this.logger.log(`Generated invoice ${invoice.id} for recurring ${recurringInvoice.id} (period: ${periodKey}, planned: ${cycleDate.toISOString()})`);
                        } catch (error: any) {
                            // P2002 = Prisma unique constraint violation = cycle already generated
                            if (error?.code === 'P2002') {
                                this.logger.log(`Period ${periodKey} already generated for recurring ${recurringInvoice.id}, skipping`);
                            } else {
                                this.logger.error(`Error generating invoice for recurring ${recurringInvoice.id} (period: ${periodKey}):`, error);
                                break; // Stop catch-up on unexpected error
                            }
                        }

                        // Advance to next cycle
                        const nextCycleDate = this.calculateNextInvoiceDate(cycleDate, recurringInvoice.frequency);

                        // If we generated successfully OR the period was a duplicate, advance
                        cycleDate = nextCycleDate;
                    }

                    // Update the template: set nextInvoiceDate and lastInvoiceDate
                    // Only advance if cycleDate moved past original nextInvoiceDate
                    const originalNext = new Date(recurringInvoice.nextInvoiceDate!);
                    originalNext.setHours(0, 0, 0, 0);
                    if (cycleDate > originalNext) {
                        await prisma.recurringInvoice.update({
                            where: { id: recurringInvoice.id },
                            data: {
                                nextInvoiceDate: cycleDate,
                                lastInvoiceDate: today,
                            },
                        });
                    }
                } catch (error) {
                    this.logger.error(`Error processing recurring invoice ${recurringInvoice.id}:`, error);
                }
            }

            this.logger.log('Recurring invoices processing completed');

        } catch (error) {
            this.logger.error('Error in recurring invoices cron job:', error);
        }
    }

    /**
     * Compute a deterministic period key from a planned date + frequency.
     * Used as the unique idempotency key for invoice generation.
     *
     * Examples:
     *   WEEKLY     → "2026-W26"       (ISO week)
     *   BIWEEKLY   → "2026-W26"       (anchor = template start, so key is the anchor week)
     *   MONTHLY    → "2026-06"
     *   BIMONTHLY  → "2026-06"
     *   QUARTERLY  → "2026-Q2"
     *   QUADMONTHLY → "2026-06"
     *   SEMIANNUALLY → "2026-H1"
     *   ANNUALLY   → "2026"
     */
    computePeriodKey(date: Date, frequency: string): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');

        switch (frequency) {
            case 'WEEKLY':
            case 'BIWEEKLY': {
                // ISO week number
                const weekNum = this.getISOWeekNumber(date);
                return `${y}-W${String(weekNum).padStart(2, '0')}`;
            }
            case 'MONTHLY':
                return `${y}-${m}`;
            case 'BIMONTHLY': {
                const half = Math.ceil(date.getMonth() + 1 / 6); // 1-2
                return `${y}-${m}`;
            }
            case 'QUARTERLY': {
                const quarter = Math.floor(date.getMonth() / 3) + 1;
                return `${y}-Q${quarter}`;
            }
            case 'QUADMONTHLY': {
                const quad = Math.floor(date.getMonth() / 4) + 1;
                return `${y}-${m}`;
            }
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
     * No force-to-Monday — preserves the template's start day.
     */
    calculateNextInvoiceDate(from: Date, frequency: string): Date {
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
                // Handle month overflow (e.g., Jan 31 → Feb should give Feb 28/29)
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

    /**
     * ISO 8601 week number calculation.
     */
    private getISOWeekNumber(date: Date): number {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7; // Sunday = 7
        d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Set to Thursday
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    }
}
