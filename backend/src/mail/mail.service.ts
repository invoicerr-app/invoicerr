import * as nodemailer from 'nodemailer';

import { IMailProvider, MailOptions, SmtpOverrides } from '@/mail/types';

import { BrevoMailProvider } from '@/mail/providers/brevo.provider';
import { Injectable } from '@nestjs/common';
import { SmtpMailProvider } from '@/mail/providers/smtp.provider';
import { logger } from '@/logger/logger.service';
import { toTransportAttachments } from '@/mail/attachments';

export type { MailOptions, MailAttachment, SmtpOverrides } from '@/mail/types';

@Injectable()
export class MailService {
  private readonly provider: IMailProvider;

  constructor() {
    const selected = (process.env.MAIL_PROVIDER || 'smtp').toLowerCase();
    switch (selected) {
      case 'brevo':
        this.provider = new BrevoMailProvider();
        break;
      case 'smtp':
        this.provider = new SmtpMailProvider();
        // An empty SMTP_HOST is NOT a construction-time failure: nodemailer builds the transport
        // regardless (see providers/smtp.provider.ts) and only fails once sendMail() actually tries
        // to connect — Node resolves an empty host to 127.0.0.1, so that failure is a plain
        // ECONNREFUSED, indistinguishable from "a real SMTP server that happens to be down" to
        // anyone not already reading logs. Without this line, a deployment that never sets
        // SMTP_HOST boots clean, answers 200 on every route, and only reveals the gap the first time
        // someone sends a document and either watches the response or goes looking for why a client
        // never got their invoice — the exact silent-failure shape this warning exists to close.
        if (!process.env.SMTP_HOST?.trim()) {
          logger.warn(
            'MAIL_PROVIDER is "smtp" but SMTP_HOST is empty — every outgoing email will fail until it is set.',
            { category: 'mail' },
          );
        }
        break;
      default:
        throw new Error(`Unknown MAIL_PROVIDER "${selected}". Supported values: "smtp", "brevo".`);
    }
  }

  async sendMail(options: MailOptions, smtpOverrides?: SmtpOverrides) {
    // Per-company SMTP: build a one-shot transport from the decrypted company config.
    // The password is intentionally excluded from all log calls below.
    if (smtpOverrides) {
      const transporter = nodemailer.createTransport({
        host: smtpOverrides.host,
        port: smtpOverrides.port,
        secure: smtpOverrides.secure,
        auth: {
          user: smtpOverrides.username,
          pass: smtpOverrides.password,
        },
      });
      try {
        await transporter.sendMail({
          from: smtpOverrides.fromAddress,
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
          attachments: toTransportAttachments(options.attachments),
        });
      } catch (error) {
        // Log host+user only — never the password.
        logger.error('Failed to send email via per-company SMTP.', {
          category: 'mail',
          details: { host: smtpOverrides.host, user: smtpOverrides.username, error },
        });
        throw new Error(
          'Failed to send email via per-company SMTP. Check the channel credentials configuration.',
        );
      }
      return { message: 'Email sent successfully' };
    }

    // Global provider path (SMTP_* env vars / Brevo).
    try {
      await this.provider.sendMail(options);
    } catch (error) {
      logger.error('Failed to send email. Please check your mail provider configuration.', {
        category: 'mail',
        details: { provider: this.provider.id, error },
      });
      throw new Error('Failed to send email. Please check your mail provider configuration.');
    }

    return { message: 'Email sent successfully' };
  }
}
