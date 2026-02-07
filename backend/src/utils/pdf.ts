import "dotenv/config";

import { BadRequestException } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import * as puppeteer from "puppeteer";
import { PrismaClient } from "../../prisma/generated/prisma/client";

type PatternType = "receipt" | "invoice" | "quote";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("DATABASE_URL environment variable is required");
}

export async function formatPattern(
	type: PatternType,
	number: number,
	date: Date = new Date(),
): Promise<string> {
	const adapter = new PrismaPg({ connectionString: databaseUrl });
	const prisma = new PrismaClient({ adapter });
	const company = await prisma.company.findFirst();
	if (!company) {
		throw new BadRequestException(
			"No company found. Please create a company first.",
		);
	}
	prisma.$disconnect();
	let pattern = "";
	let startingNumber = 1;
	switch (type) {
		case "receipt":
			pattern = company.receiptNumberFormat;
			startingNumber = company.receiptStartingNumber;
			break;
		case "invoice":
			pattern = company.invoiceNumberFormat;
			startingNumber = company.invoiceStartingNumber;
			break;
		case "quote":
			pattern = company.quoteNumberFormat;
			startingNumber = company.quoteStartingNumber;
			break;
	}
	return pattern.replace(/\{(\w+)(?::(\d+))?\}/g, (_, key, padding) => {
		let value: number | string;

		switch (key) {
			case "year":
				value = date.getFullYear();
				break;
			case "month":
				value = date.getMonth() + 1;
				break;
			case "day":
				value = date.getDate();
				break;
			case "number":
				value = number + startingNumber - 1; // Use the starting number from the company
				break;
			default:
				return key;
		}

		const padLength =
			padding !== undefined ? parseInt(padding, 10) : key === "number" ? 4 : 0;

		return value.toString().padStart(padLength, "0");
	});
}

export function getInvertColor(hex: string): string {
	let cleanHex = hex.replace(/^#/, "");
	if (cleanHex.length === 3) {
		cleanHex = cleanHex
			.split("")
			.map((c) => c + c)
			.join("");
	}

	const r = parseInt(cleanHex.slice(0, 2), 16);
	const g = parseInt(cleanHex.slice(2, 4), 16);
	const b = parseInt(cleanHex.slice(4, 6), 16);

	const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

	return luminance > 186 ? "#000000" : "#ffffff";
}

export const getPDF = async (html: string) => {
	let browser: puppeteer.Browser;
	if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
		browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
	} else {
		browser = await puppeteer.launch({
			headless: true,
			executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
	}
	const page = await browser.newPage();
	await page.setContent(html, { waitUntil: "networkidle0" });

	const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

	await browser.close();

	return pdfBuffer;
};
