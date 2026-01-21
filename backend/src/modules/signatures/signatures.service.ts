import { BadRequestException, Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import type { MailService } from '@/mail/mail.service';
import type { ISigningProvider } from '@/plugins/signing/types';
import prisma from '@/prisma/prisma.service';
import { PluginType, WebhookEvent } from '../../../prisma/generated/prisma/client';
import type { PluginsService } from '../plugins/plugins.service';
import type { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

@Injectable()
export class SignaturesService {
  constructor(
    private readonly mailService: MailService,
    private readonly pluginsService: PluginsService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {}

  async getSignature(signatureId: string) {
    const signature = await prisma.signature.findUnique({
      where: { id: signatureId },
      select: {
        id: true,
        isActive: true,
        quoteId: true,
        signedAt: true,
        expiresAt: true,
        quote: {
          include: {
            client: true,
          },
        },
      },
    });

    return signature;
  }

  async createSignature(quoteId: string) {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        client: {
          select: {
            contactEmail: true,
          },
        },
      },
    });

    if (!quote || !quote.client || !quote.client.contactEmail) {
      logger.error('Quote not found or client information is missing.', {
        category: 'signature',
        details: { quoteId },
      });
      throw new BadRequestException('Quote not found or client information is missing.');
    }

    let signatureId = '';

    try {
      signatureId = await this.sendSignatureEmail(quote.id);
    } catch (error) {
      logger.error('Failed to create signature.', {
        category: 'signature',
        details: { error, quoteId },
      });
      throw error;
    }

    await prisma.quote.update({
      where: { id: quoteId },
      data: {
        status: 'SENT',
      },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.SIGNATURE_CREATED, {
        quoteId: quote.id,
        signatureId,
        client: quote.client,
      });
    } catch (error) {
      logger.error('Failed to dispatch SIGNATURE_CREATED webhook', error);
    }

    logger.info('Signature created', { category: 'signature', details: { signatureId, quoteId } });
    return {
      message: 'Signature successfully created and email sent.',
      signature: { id: signatureId },
    };
  }

  async generateOTPCode(signatureId: string) {
    const signature = await prisma.signature.findFirst({
      where: { id: signatureId, isActive: true },
      select: {
        id: true,
        quoteId: true,
        quote: {
          select: {
            client: {
              select: {
                contactEmail: true,
              },
            },
          },
        },
      },
    });

    if (
      !signature ||
      !signature.quote ||
      !signature.quote.client ||
      !signature.quote.client.contactEmail
    ) {
      logger.error('Quote not found or client information is missing.', {
        category: 'signature',
        details: { signatureId: signature?.id },
      });
      throw new BadRequestException('Quote not found or client information is missing.');
    }

    const otpCode = Math.floor(10000000 + Math.random() * 90000000).toString();

    await prisma.signature.update({
      where: { id: signatureId },
      data: {
        otpCode,
        otpUsed: false,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // OTP valid for 15 minutes
      },
    });

    await this.sendOtpToUser(signature.quote.client.contactEmail, otpCode);

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.SIGNATURE_OTP_GENERATED, {
        signatureId,
        quoteId: signature.quoteId,
        clientEmail: signature.quote.client.contactEmail,
        otpCode,
      });
    } catch (error) {
      logger.error('Failed to dispatch SIGNATURE_OTP_GENERATED webhook', error);
    }

    logger.info('OTP code generated', { category: 'signature', details: { signatureId, otpCode } });
    return { message: 'OTP code generated successfully.' };
  }

  private async sendSignatureEmailWithProvider(
    provider: ISigningProvider,
    quoteId: string,
  ): Promise<string> {
    if (provider && typeof provider.requestSignature === 'function') {
      return provider.requestSignature({
        id: quoteId,
        title: `Signature for Quote ${quoteId}`,
        fileUrl: `https://example.com/quotes/${quoteId}/file.pdf`,
        signers: ['<SIGNER_EMAIL>'],
      });
    }
    return '';
  }

  async sendSignatureEmail(quoteId: string): Promise<string> {
    const provider = await this.pluginsService.getProviderByType<ISigningProvider>(
      PluginType.SIGNING,
    );
    if (provider && typeof provider.requestSignature === 'function') {
      return this.sendSignatureEmailWithProvider(provider, quoteId);
    }
    const signature = await prisma.signature.create({
      data: {
        quoteId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Signature valid for 30 days
      },
      select: {
        id: true,
        quoteId: true,
        quote: {
          select: {
            number: true,
            company: true,
            client: {
              select: {
                contactEmail: true,
              },
            },
          },
        },
      },
    });

    if (
      !signature ||
      !signature.quote ||
      !signature.quote.client ||
      !signature.quote.client.contactEmail
    ) {
      logger.error('Quote not found or client information is missing.', {
        category: 'signature',
        details: { signatureId: signature?.id },
      });
      throw new BadRequestException('Quote not found or client information is missing.');
    }

    await prisma.signature.updateMany({
      where: { quoteId: signature.quoteId, isActive: true, id: { not: signature.id } },
      data: { isActive: false },
    });

    const mailTemplate = await prisma.mailTemplate.findFirst({
      where: { type: 'SIGNATURE_REQUEST', companyId: signature.quote.company.id },
      select: { subject: true, body: true },
    });

    if (!mailTemplate) {
      logger.error('Email template for signature request not found.', { category: 'signature' });
      throw new BadRequestException('Email template for signature request not found.');
    }

    const envVariables = {
      APP_URL: process.env.APP_URL,
      SIGNATURE_URL: `${process.env.APP_URL}/signature/${signature.id}`,
      SIGNATURE_ID: signature.id,
      SIGNATURE_NUMBER: signature.quote.number,
    };

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: signature.quote.client.contactEmail,
      subject: mailTemplate.subject.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
      html: mailTemplate.body.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
    };

    try {
      await this.mailService.sendMail(mailOptions);
    } catch (error) {
      logger.error('Failed to send signature email', { category: 'signature', details: { error } });
      throw new BadRequestException(
        'Failed to send signature email. Please check your SMTP configuration.',
      );
    }

    logger.info('Signature email sent', {
      category: 'signature',
      details: { signatureId: signature.id, email: signature.quote.client.contactEmail },
    });
    return signature.id;
  }

  async sendOtpToUser(email: string, otpCode: string) {
    const signature = await prisma.signature.findFirst({
      where: { otpCode, otpUsed: false, isActive: true },
      select: { id: true, quote: { select: { company: true } } },
    });

    if (!signature) {
      logger.error('Signature not found or OTP code is invalid.', {
        category: 'signature',
        details: { email },
      });
      throw new BadRequestException('Signature not found or OTP code is invalid.');
    }

    const mailTemplate = await prisma.mailTemplate.findFirst({
      where: { type: 'VERIFICATION_CODE', companyId: signature.quote.company.id },
      select: { subject: true, body: true },
    });

    if (!mailTemplate) {
      logger.error('Email template for OTP code not found.', { category: 'signature' });
      throw new BadRequestException('Email template for OTP code not found.');
    }

    const envVariables = {
      OTP_CODE: `${otpCode.slice(0, 4)}-${otpCode.slice(4, 8)}`,
    };

    const mailOptions = {
      to: email,
      subject: mailTemplate.subject.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
      html: mailTemplate.body.replace(/{{(\w+)}}/g, (_, key) => envVariables[key] || ''),
    };

    try {
      await this.mailService.sendMail(mailOptions);
    } catch (error) {
      logger.error('Failed to send OTP email', { category: 'signature', details: { error } });
      throw new BadRequestException(
        'Failed to send OTP email. Please check your SMTP configuration.',
      );
    }

    logger.info('OTP email sent', { category: 'signature', details: { email, otpCode } });
    return true;
  }

  async signQuote(signatureId: string, otpCode: string) {
    const signature = await prisma.signature.findFirst({
      where: {
        id: signatureId,
        otpCode,
        otpUsed: false,
        isActive: true,
        expiresAt: {
          gte: new Date(),
        },
      },
    });

    if (!signature) {
      logger.error('Invalid or expired OTP code.', {
        category: 'signature',
        details: { signatureId, otpCode },
      });
      throw new BadRequestException('Invalid or expired OTP code.');
    }

    await prisma.signature.update({
      where: { id: signature.id },
      data: {
        otpUsed: true,
        signedAt: new Date(),
      },
    });

    await prisma.quote.update({
      where: { id: signature.quoteId },
      data: {
        status: 'SIGNED',
      },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.SIGNATURE_COMPLETED, {
        signatureId,
        quoteId: signature.quoteId,
        signedAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to dispatch SIGNATURE_COMPLETED webhook', error);
    }

    logger.info('Quote signed', {
      category: 'signature',
      details: { signatureId, quoteId: signature.quoteId },
    });
    return { message: 'Quote signed successfully.' };
  }
}
