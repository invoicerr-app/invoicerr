import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';
import { CurrentUser } from '@/types/user';
import { BadRequestException, Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';


@Injectable()
export class DangerService {

    private readonly otpExpirationMinutes = 10;

    private OTP: string | null = null; // Store the OTP in memory for the session, as it is not persisted in the database
    private otpExpirationTime: Date | null = null; // Store the expiration time of the OTP

    constructor(private readonly mailService: MailService) {
    }

    async requestOtp(user: CurrentUser) {
        const otp = Math.floor(10000000 + Math.random() * 90000000).toString();

        this.OTP = otp;
        this.otpExpirationTime = new Date(new Date().getTime() + this.otpExpirationMinutes * 60000);

        try {
            await this.mailService.sendMail({
                to: process.env.SMTP_FROM || process.env.SMTP_USER,
                subject: 'OTP Code Sent',
                text: `An OTP code was sent to ${user.email}. The code is: ${otp}. It is valid for ${this.otpExpirationMinutes} minutes.`,
            })
        } catch (error) {
            logger.error('Failed to send OTP email', { category: 'danger', details: { error } });
            throw new BadRequestException('Failed to send OTP email. Please check your SMTP configuration.');
        }

        logger.info('OTP sent', { category: 'danger', details: { userId: user.id } });
        return { message: 'OTP sent successfully' };
    }

    private isOtpValid(otp: string): boolean {
        otp = otp.replace(/-/g, '');
        if (!this.OTP || !this.otpExpirationTime) {
            return false;
        }

        const isValid = this.OTP === otp && new Date() < this.otpExpirationTime;
        return isValid;
    }

    async resetApp(user: CurrentUser, companyId: string, otp: string) {
        if (!this.isOtpValid(otp)) {
            logger.warn('Invalid or expired OTP for resetApp', { category: 'danger', details: { userId: user.id } });
            throw new BadRequestException('Invalid or expired OTP');
        }

        // Reset everything for this company only, but the user data
        await prisma.company.deleteMany({ where: { id: companyId } });
        await prisma.pDFConfig.deleteMany({ where: { Company: { id: companyId } } });
        await prisma.mailTemplate.deleteMany({ where: { companyId } });
        await prisma.client.deleteMany({ where: { companyId } });
        await prisma.quoteItem.deleteMany({ where: { quote: { companyId } } });
        await prisma.quote.deleteMany({ where: { companyId } });
        await prisma.invoiceItem.deleteMany({ where: { invoice: { companyId } } });
        await prisma.invoice.deleteMany({ where: { companyId } });
        await prisma.signature.deleteMany({ where: { quote: { companyId } } });

        logger.info('Application reset successfully', { category: 'danger', details: { userId: user.id, companyId } });
        return { message: 'Application reset successfully' };
    }

    async resetAll(user: CurrentUser, companyId: string, otp: string) {
        if (!this.isOtpValid(otp)) {
            logger.warn('Invalid or expired OTP for resetAll', { category: 'danger', details: { userId: user.id } });
            throw new BadRequestException('Invalid or expired OTP');
        }

        // Reset all data logic here
        // For example, clear all user data, reset application state, etc.

        this.OTP = null; // Clear OTP after use
        this.otpExpirationTime = null; // Clear expiration time

        logger.info('All data reset successfully', { category: 'danger', details: { userId: user.id } });
        return { message: 'All data reset successfully' };
    }
}
