import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';
import { CurrentUser } from '@/types/user';
import { BadRequestException, Injectable, NotImplementedException } from '@nestjs/common';
import { logger } from '@/logger/logger.service';

@Injectable()
export class DangerService {
  private readonly otpExpirationMinutes = 10;

  // F-012: still in-process memory, so an OTP issued by one replica is unknown to the others and a
  // restart invalidates it. Making this durable and per-user is a separate change; what is fixed
  // here is that the code now reaches the requester and is single-use.
  private OTP: string | null = null;
  private otpExpirationTime: Date | null = null; // Store the expiration time of the OTP

  constructor(private readonly mailService: MailService) {}

  async requestOtp(user: CurrentUser) {
    const otp = Math.floor(10000000 + Math.random() * 90000000).toString();

    this.OTP = otp;
    this.otpExpirationTime = new Date(new Date().getTime() + this.otpExpirationMinutes * 60000);

    try {
      await this.mailService.sendMail({
        // F-012: this used to send to SMTP_FROM/SMTP_USER — the instance's own technical mailbox,
        // not the person authorising the destructive action. Anyone able to read that mailbox could
        // authorise; the requester could not.
        to: user.email,
        subject: 'OTP Code Sent',
        text: `Your confirmation code for a destructive action on Invoicerr is: ${otp}. It is valid for ${this.otpExpirationMinutes} minutes. If you did not request this, ignore this message.`,
      });
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
      logger.warn('Invalid or expired OTP for resetApp', {
        category: 'danger',
        details: { userId: user.id },
      });
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

    // F-012: resetApp did not clear the OTP (only resetAll did), leaving it replayable for the rest
    // of its ten-minute window. A confirmation code authorises one action.
    this.OTP = null;
    this.otpExpirationTime = null;

    logger.info('Application reset successfully', {
      category: 'danger',
      details: { userId: user.id, companyId },
    });
    return { message: 'Application reset successfully' };
  }

  async resetAll(user: CurrentUser, companyId: string, otp: string) {
    if (!this.isOtpValid(otp)) {
      logger.warn('Invalid or expired OTP for resetAll', {
        category: 'danger',
        details: { userId: user.id },
      });
      throw new BadRequestException('Invalid or expired OTP');
    }

    // F-011: this method never deleted anything — it cleared the OTP and returned
    // "All data reset successfully". A destructive operation the user explicitly confirmed must
    // not report success it did not perform: they would believe their data gone. Until the reset is
    // actually implemented, fail loudly rather than lie.
    this.OTP = null;
    this.otpExpirationTime = null;

    logger.error('resetAll called but not implemented — refusing to report success', {
      category: 'danger',
      details: { userId: user.id, companyId },
    });
    throw new NotImplementedException(
      'Full reset is not implemented yet. Nothing was deleted. Use "Reset app data" to clear documents for this company.',
    );
  }
}
