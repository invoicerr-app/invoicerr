import { BadRequestException, Injectable } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { toMinor, fromMinor } from '@/utils/financial';

type MonthStat = { month: number; invoiced: number; revenue: number; deposits: number; };
type YearStat = { year: number; invoiced: number; revenue: number; deposits: number; };

@Injectable()
export class StatsService {
    async getMonthlyStats(year: number) {
        const company = await prisma.company.findFirst();
        if (!company) {
            logger.error('No company found. Please create a company first.', { category: 'stats' });
            throw new BadRequestException('No company found. Please create a company first.');
        }

        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

        const invoicesInYear = await prisma.invoice.findMany({
            where: {
                isActive: true,
                createdAt: {
                    gte: startOfYear,
                    lte: endOfYear,
                },
            },
            include: { payments: true },
        });

        const paymentsInYear = await prisma.payment.findMany({
            where: {
                createdAt: {
                    gte: startOfYear,
                    lte: endOfYear,
                },
            },
            include: {
                items: true,
                invoice: { include: { items: true } },
            },
        });

        const invoicesWithPayments = await prisma.invoice.findMany({
            where: { isActive: true, payments: { some: {} } },
            include: { payments: { orderBy: { createdAt: 'asc' } } },
        });

        // Determine the payment moment for invoices that became fully paid
        const paidInvoices: { invoice: any; paidDate: Date }[] = [];
        for (const inv of invoicesWithPayments) {
            let cumulativeMinor = 0;
            const invCurrency = inv.currency;
            const invTotalTTCMinor = inv.totalTTCMinor ?? toMinor(inv.totalTTC, invCurrency);
            for (const r of inv.payments) {
                cumulativeMinor += r.totalPaidMinor ?? toMinor(r.totalPaid, invCurrency);
                if (cumulativeMinor >= invTotalTTCMinor) {
                    paidInvoices.push({ invoice: inv, paidDate: r.createdAt });
                    break;
                }
            }
        }

        type CurrencyMonthsMap = Map<string, { months: MonthStat[] }>;
        const monthsByCurrency: CurrencyMonthsMap = new Map();

        function ensureCurrency(currency: string) {
            if (!monthsByCurrency.has(currency)) {
                const months: MonthStat[] = Array.from({ length: 12 }).map((_, i) => ({
                    month: i + 1,
                    invoiced: 0,
                    revenue: 0,
                    deposits: 0,
                }));
                monthsByCurrency.set(currency, { months });
            }
        }

        // Invoiced (with VAT) grouped by invoice.createdAt month and invoice.currency
        for (const inv of invoicesInYear) {
            const currency = inv.currency;
            ensureCurrency(currency);
            const monthIndex = inv.createdAt.getMonth();
            const m = monthsByCurrency.get(currency)!.months[monthIndex];
            const invMinor = inv.totalTTCMinor ?? toMinor(inv.totalTTC, currency);
            m.invoiced += fromMinor(invMinor, currency);
        }

        // Revenue (without VAT) - calculated from payments created in the period.
        // For each payment item, compute net = amountPaid / (1 + vatRate/100)
        for (const r of paymentsInYear) {
            const currency = r.invoice?.currency;
            if (!currency) continue;
            ensureCurrency(currency);
            const netMinor = r.items.reduce((sum: number, item: any) => {
                const invItem = r.invoice.items.find((ii: any) => ii.id === item.invoiceItemId);
                const vat = invItem?.vatRate || 0;
                const amountMinor = item.amountPaidMinor ?? toMinor(item.amountPaid, currency);
                const netMinor = Math.round(amountMinor / (1 + vat / 100));
                return sum + netMinor;
            }, 0);
            const monthIndex = r.createdAt.getMonth();
            const m = monthsByCurrency.get(currency)!.months[monthIndex];
            m.revenue += fromMinor(netMinor, currency);
        }

        // Deposits (invoice paid) - attribute invoice total to the month when cumulative payments reached the invoice total
        for (const p of paidInvoices) {
            const paidDate = new Date(p.paidDate);
            if (paidDate.getFullYear() !== year) continue;
            const currency = p.invoice.currency;
            ensureCurrency(currency);
            const m = monthsByCurrency.get(currency)!.months[paidDate.getMonth()];
            const invMinor = p.invoice.totalTTCMinor ?? toMinor(p.invoice.totalTTC, currency);
            m.deposits += fromMinor(invMinor, currency);
        }

        // Round values
        for (const [, obj] of monthsByCurrency.entries()) {
            obj.months.forEach(m => {
                m.invoiced = Number(m.invoiced.toFixed(2));
                m.revenue = Number(m.revenue.toFixed(2));
                m.deposits = Number(m.deposits.toFixed(2));
            });
        }

        const currencies = Array.from(monthsByCurrency.entries()).map(([currency, obj]) => ({ currency, months: obj.months }));

        return { currencies };
    }

    async getYearlyStats(startYear: number, endYear: number) {
        const company = await prisma.company.findFirst();
        if (!company) {
            logger.error('No company found. Please create a company first.', { category: 'stats' });
            throw new BadRequestException('No company found. Please create a company first.');
        }

        const startDate = new Date(startYear, 0, 1);
        const endDate = new Date(endYear, 11, 31, 23, 59, 59, 999);

        const invoicesInRange = await prisma.invoice.findMany({
            where: {
                isActive: true,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
        });

        const paymentsInRange = await prisma.payment.findMany({
            where: {
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            include: {
                items: true,
                invoice: { include: { items: true } },
            },
        });

        const invoicesWithPayments = await prisma.invoice.findMany({
            where: { isActive: true, payments: { some: {} } },
            include: { payments: { orderBy: { createdAt: 'asc' } } },
        });

        const paidInvoices: { invoice: any; paidDate: Date }[] = [];
        for (const inv of invoicesWithPayments) {
            let cumulativeMinor = 0;
            const invCurrency = inv.currency;
            const invTotalTTCMinor = inv.totalTTCMinor ?? toMinor(inv.totalTTC, invCurrency);
            for (const r of inv.payments) {
                cumulativeMinor += r.totalPaidMinor ?? toMinor(r.totalPaid, invCurrency);
                if (cumulativeMinor >= invTotalTTCMinor) {
                    paidInvoices.push({ invoice: inv, paidDate: r.createdAt });
                    break;
                }
            }
        }

        type CurrencyYearsMap = Map<string, { years: YearStat[] }>;
        const yearsByCurrency: CurrencyYearsMap = new Map();

        function ensureCurrencyYears(currency: string) {
            if (!yearsByCurrency.has(currency)) {
                const yearsArray: YearStat[] = [];
                for (let y = startYear; y <= endYear; y++) {
                    yearsArray.push({ year: y, invoiced: 0, revenue: 0, deposits: 0 });
                }
                yearsByCurrency.set(currency, { years: yearsArray });
            }
        }

        // Invoiced
        for (const inv of invoicesInRange) {
            const currency = inv.currency;
            ensureCurrencyYears(currency);
            const entry = yearsByCurrency.get(currency)!.years.find(e => e.year === inv.createdAt.getFullYear())!;
            const invMinor = inv.totalTTCMinor ?? toMinor(inv.totalTTC, currency);
            entry.invoiced += fromMinor(invMinor, currency);
        }

        // Revenue
        for (const r of paymentsInRange) {
            const currency = r.invoice?.currency;
            if (!currency) continue;
            ensureCurrencyYears(currency);
            const netMinor = r.items.reduce((sum: number, item: any) => {
                const invItem = r.invoice.items.find((ii: any) => ii.id === item.invoiceItemId);
                const vat = invItem?.vatRate || 0;
                const amountMinor = item.amountPaidMinor ?? toMinor(item.amountPaid, currency);
                const netItem = Math.round(amountMinor / (1 + vat / 100));
                return sum + netItem;
            }, 0);
            const entry = yearsByCurrency.get(currency)!.years.find(e => e.year === r.createdAt.getFullYear())!;
            entry.revenue += fromMinor(netMinor, currency);
        }

        // Deposits
        for (const p of paidInvoices) {
            const py = new Date(p.paidDate).getFullYear();
            if (py < startYear || py > endYear) continue;
            const currency = p.invoice.currency;
            ensureCurrencyYears(currency);
            const entry = yearsByCurrency.get(currency)!.years.find(e => e.year === py)!;
            const invMinor = p.invoice.totalTTCMinor ?? toMinor(p.invoice.totalTTC, currency);
            entry.deposits += fromMinor(invMinor, currency);
        }

        for (const [, obj] of yearsByCurrency.entries()) {
            obj.years.forEach(y => {
                y.invoiced = Number(y.invoiced.toFixed(2));
                y.revenue = Number(y.revenue.toFixed(2));
                y.deposits = Number(y.deposits.toFixed(2));
            });
        }

        const currencies = Array.from(yearsByCurrency.entries()).map(([currency, obj]) => ({ currency, years: obj.years }));
        return { currencies };
    }
}