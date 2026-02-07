import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import prisma from "@/prisma/prisma.service";
import {
	$Enums,
	Company,
	Invoice,
	Quote,
} from "../../../prisma/generated/prisma/client";

export interface DashboardData {
	company: Company | null;
	quotes: {
		total: number;
		draft: number;
		sent: number;
		signed: number;
		expired: number;
		latests: Quote[];
	};
	invoices: {
		total: number;
		unpaid: number;
		sent: number;
		paid: number;
		overdue: number;
		latests: Invoice[];
	};
	clients: {
		total: number;
	};
	revenue: {
		last6Months: { createdAt: Date; total: number }[];
		currentMonth: number;
		previousMonth: number;
		monthlyChange: number;
		monthlyChangePercent: number;
		last6Years: { createdAt: Date; total: number }[];
		currentYear: number;
		previousYear: number;
		yearlyChange: number;
		yearlyChangePercent: number;
	};
}

@Injectable()
export class DashboardService {
	private lastDashboardHashes: Map<string, string> = new Map();

	private computeHash(payload: unknown): string {
		try {
			const hash = createHash("sha1");
			hash.update(JSON.stringify(payload));
			return hash.digest("hex");
		} catch (_e) {
			return String(Date.now());
		}
	}

	async getDashboardData(): Promise<DashboardData> {
		const quotes = await prisma.quote.groupBy({
			where: { isActive: true },
			by: ["status"],
			_count: true,
		});

		const invoices = await prisma.invoice.groupBy({
			where: { isActive: true },
			by: ["status"],
			_count: true,
		});
		const clientsCount = await prisma.client.count({
			where: { isActive: true },
		});
		const company = await prisma.company.findFirst();

		const latestQuotes = await prisma.quote.findMany({
			where: { isActive: true },
			orderBy: { updatedAt: "desc" },
			include: { company: true, client: true },
			take: 5,
		});

		const latestInvoices = await prisma.invoice.findMany({
			where: { isActive: true },
			orderBy: { updatedAt: "desc" },
			include: { company: true, client: true },
			take: 5,
		});

		const last6Months = await Promise.all(
			Array.from({ length: 6 }).map(async (_, i) => {
				const date = new Date();
				date.setMonth(date.getMonth() - i);
				return {
					createdAt: new Date(date.getFullYear(), date.getMonth(), 1),
					total: await this.getMonthlyRevenue(date),
				};
			}),
		);

		const currentMonthRevenue = await this.getMonthlyRevenue(new Date());

		const previousMonthDate = new Date();
		previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
		const previousMonthRevenue =
			await this.getMonthlyRevenue(previousMonthDate);

		const monthlyChange = currentMonthRevenue - previousMonthRevenue;

		const monthlyChangePercent = this.calculateChangePercent(
			currentMonthRevenue,
			previousMonthRevenue,
		);

		const last6Years = await Promise.all(
			Array.from({ length: 6 }).map(async (_, i) => {
				const date = new Date();
				date.setFullYear(date.getFullYear() - i);
				return {
					createdAt: new Date(date.getFullYear(), 0, 1),
					total: await this.getYearlyRevenue(date),
				};
			}),
		);

		const currentYearRevenue = await this.getYearlyRevenue(new Date());

		const previousYearDate = new Date();
		previousYearDate.setFullYear(previousYearDate.getFullYear() - 1);
		const previousYearRevenue = await this.getYearlyRevenue(previousYearDate);

		const yearlyChange = currentYearRevenue - previousYearRevenue;

		const yearlyChangePercent = this.calculateChangePercent(
			currentYearRevenue,
			previousYearRevenue,
		);

		const payload = {
			company,
			quotes: {
				total: quotes.reduce((acc, q) => acc + q._count, 0),
				draft: quotes.find((q) => q.status === "DRAFT")?._count || 0,
				sent: quotes.find((q) => q.status === "SENT")?._count || 0,
				signed: quotes.find((q) => q.status === "SIGNED")?._count || 0,
				expired: quotes.find((q) => q.status === "EXPIRED")?._count || 0,
				latests: latestQuotes,
			},
			invoices: {
				total: invoices.reduce((acc, i) => acc + i._count, 0),
				unpaid: invoices.find((i) => i.status === "UNPAID")?._count || 0,
				sent: invoices.find((i) => i.status === "SENT")?._count || 0,
				paid: invoices.find((i) => i.status === "PAID")?._count || 0,
				overdue: invoices.find((i) => i.status === "OVERDUE")?._count || 0,
				latests: latestInvoices,
			},
			clients: {
				total: clientsCount,
			},
			revenue: {
				last6Months,
				currentMonth: currentMonthRevenue,
				previousMonth: previousMonthRevenue,
				monthlyChange,
				monthlyChangePercent,
				last6Years,
				currentYear: currentYearRevenue,
				previousYear: previousYearRevenue,
				yearlyChange,
				yearlyChangePercent,
			},
		} as DashboardData;

		// Compute hash and log only on init or when data changed
		const key = company?.id || "global";
		const hash = this.computeHash(payload);
		const prevHash = this.lastDashboardHashes.get(key);
		if (!prevHash) {
			this.lastDashboardHashes.set(key, hash);
			logger.info("Dashboard initialized", {
				category: "dashboard",
				details: { hash },
			});
		} else if (prevHash !== hash) {
			this.lastDashboardHashes.set(key, hash);
			logger.info("Dashboard changed", {
				category: "dashboard",
				details: { hash },
			});
		}

		return payload;
	}

	async convertToMainCurrency(
		amount: number,
		fromCurrency: $Enums.Currency,
		toCurrency: $Enums.Currency,
	): Promise<number> {
		if (fromCurrency === toCurrency) {
			return amount;
		}

		const currencyRate = await prisma.currencyConversion.findFirst({
			where: {
				fromCurrency,
				toCurrency,
			},
		});

		if (currencyRate && currencyRate.expiresAt > new Date()) {
			return amount * currencyRate.rate;
		}

		const res = await fetch(
			`https://hexarate.paikama.co/api/rates/latest/${fromCurrency}?target=${toCurrency}`,
		);
		const data = await res.json();
		if (!data || data.status_code !== 200 || !data.data || !data.data.mid) {
			console.error(
				`Failed to fetch currency conversion data for ${fromCurrency} to ${toCurrency}`,
			);
			return 0;
		}
		const rate = data.data.mid;

		await prisma.currencyConversion.upsert({
			where: {
				fromCurrency_toCurrency: {
					fromCurrency,
					toCurrency,
				},
			},
			create: {
				fromCurrency,
				toCurrency,
				rate,
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
			},
			update: {
				rate,
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
			},
		});

		return amount * rate;
	}

	async getMonthlyRevenue(date: Date): Promise<number> {
		const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
		const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

		const invoices = await prisma.invoice.findMany({
			where: {
				createdAt: {
					gte: startOfMonth,
					lte: endOfMonth,
				},
				status: "PAID",
			},
			include: { company: true },
		});

		const convertedAmounts = await Promise.all(
			invoices.map(
				async (invoice) =>
					await this.convertToMainCurrency(
						invoice.totalTTC,
						invoice.currency,
						invoice.company.currency,
					),
			),
		);
		return convertedAmounts.reduce((total, amount) => total + amount, 0);
	}

	async getYearlyRevenue(date: Date): Promise<number> {
		const startOfYear = new Date(date.getFullYear(), 0, 1);
		const endOfYear = new Date(date.getFullYear() + 1, 0, 0);

		const invoices = await prisma.invoice.findMany({
			where: {
				createdAt: {
					gte: startOfYear,
					lte: endOfYear,
				},
				status: "PAID",
			},
			include: { company: true },
		});

		const convertedAmounts = await Promise.all(
			invoices.map(
				async (invoice) =>
					await this.convertToMainCurrency(
						invoice.totalTTC,
						invoice.currency,
						invoice.company.currency,
					),
			),
		);
		return convertedAmounts.reduce((total, amount) => total + amount, 0);
	}

	calculateChangePercent(current: number, previous: number): number {
		if (current === previous) return 0;
		if (previous === 0) return current > 0 ? 100 : -100; // Handle division by zero
		return ((current - previous) / Math.abs(previous)) * 100;
	}
}
