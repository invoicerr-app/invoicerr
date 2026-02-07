import { BadRequestException, Injectable } from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import { MailService } from "@/mail/mail.service";
import prisma from "@/prisma/prisma.service";
import { CurrentUser } from "@/types/user";

@Injectable()
export class DangerService {
	private readonly otpExpirationMinutes = 10;

	private OTP: string | null = null;
	private otpExpirationTime: Date | null = null;

	constructor(private readonly mailService: MailService) {}

	async requestOtp(user: CurrentUser, companyId: string | null) {
		const otp = Math.floor(10000000 + Math.random() * 90000000).toString();

		this.OTP = otp;
		this.otpExpirationTime = new Date(
			Date.now() + this.otpExpirationMinutes * 60000,
		);

		try {
			await this.mailService.sendMail({
				to: process.env.SMTP_FROM || process.env.SMTP_USER,
				subject: "OTP Code Sent",
				text: `An OTP code was sent to ${user.email}. The code is: ${otp}. It is valid for ${this.otpExpirationMinutes} minutes.`,
			});
		} catch (error) {
			logger.error("Failed to send OTP email", {
				category: "danger",
				details: { error },
			});
			throw new BadRequestException(
				"Failed to send OTP email. Please check your SMTP configuration.",
			);
		}

		logger.info("OTP sent", {
			category: "danger",
			details: { userId: user.id, companyId },
		});
		return { message: "OTP sent successfully" };
	}

	private isOtpValid(otp: string): boolean {
		otp = otp.replace(/-/g, "");
		if (!this.OTP || !this.otpExpirationTime) {
			return false;
		}

		const isValid = this.OTP === otp && new Date() < this.otpExpirationTime;
		return isValid;
	}

	async resetApp(user: CurrentUser, companyId: string | null, otp: string) {
		if (!this.isOtpValid(otp)) {
			logger.warn("Invalid or expired OTP for resetApp", {
				category: "danger",
				details: { userId: user.id, companyId },
			});
			throw new BadRequestException("Invalid or expired OTP");
		}

		if (!companyId) {
			throw new BadRequestException("Company context required");
		}

		// Delete related data through invoice for Receipt and Signature
		const invoices = await prisma.invoice.findMany({
			where: { companyId },
			select: { id: true },
		});
		const invoiceIds = invoices.map((inv) => inv.id);

		const quotes = await prisma.quote.findMany({
			where: { companyId },
			select: { id: true },
		});
		const quoteIds = quotes.map((q) => q.id);

		// Reset company data only
		await prisma.client.deleteMany({
			where: { companyId },
		});
		await prisma.quoteItem.deleteMany({
			where: { quote: { companyId } },
		});
		await prisma.quote.deleteMany({
			where: { companyId },
		});
		await prisma.invoiceItem.deleteMany({
			where: { invoice: { companyId } },
		});
		await prisma.invoice.deleteMany({
			where: { companyId },
		});
		await prisma.receipt.deleteMany({
			where: { invoice: { id: { in: invoiceIds } } },
		});
		await prisma.signature.deleteMany({
			where: { quote: { id: { in: quoteIds } } },
		});
		await prisma.paymentMethod.deleteMany({
			where: { companyId },
		});

		logger.info("Company data reset successfully", {
			category: "danger",
			details: { userId: user.id, companyId },
		});
		return { message: "Company data reset successfully" };
	}

	async resetAll(user: CurrentUser, companyId: string | null, otp: string) {
		if (!this.isOtpValid(otp)) {
			logger.warn("Invalid or expired OTP for resetAll", {
				category: "danger",
				details: { userId: user.id, companyId },
			});
			throw new BadRequestException("Invalid or expired OTP");
		}

		if (!companyId) {
			throw new BadRequestException("Company context required");
		}

		// Get related data before deletion
		const invoices = await prisma.invoice.findMany({
			where: { companyId },
			select: { id: true },
		});
		const invoiceIds = invoices.map((inv) => inv.id);

		const quotes = await prisma.quote.findMany({
			where: { companyId },
			select: { id: true },
		});
		const quoteIds = quotes.map((q) => q.id);

		// Delete company and all related data
		await prisma.userCompany.deleteMany({
			where: { companyId },
		});
		await prisma.client.deleteMany({
			where: { companyId },
		});
		await prisma.quoteItem.deleteMany({
			where: { quote: { companyId } },
		});
		await prisma.quote.deleteMany({
			where: { companyId },
		});
		await prisma.invoiceItem.deleteMany({
			where: { invoice: { companyId } },
		});
		await prisma.invoice.deleteMany({
			where: { companyId },
		});
		await prisma.receipt.deleteMany({
			where: { invoice: { id: { in: invoiceIds } } },
		});
		await prisma.signature.deleteMany({
			where: { quote: { id: { in: quoteIds } } },
		});
		await prisma.paymentMethod.deleteMany({
			where: { companyId },
		});
		await prisma.mailTemplate.deleteMany({
			where: { companyId },
		});
		await prisma.pDFConfig.deleteMany({
			where: { Company: { id: companyId } },
		});
		await prisma.company.delete({
			where: { id: companyId },
		});

		this.OTP = null;
		this.otpExpirationTime = null;

		logger.info("Company and all data deleted successfully", {
			category: "danger",
			details: { userId: user.id, companyId },
		});
		return { message: "Company deleted successfully" };
	}
}
