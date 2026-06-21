import * as nodemailer from 'nodemailer';

import { IMailProvider, MailOptions } from '@/mail/types';

/**
 * SMTP transport based on nodemailer. Reads its configuration from the
 * SMTP_* environment variables (unchanged from the historical behaviour).
 */
export class SmtpMailProvider implements IMailProvider {
    readonly id = 'smtp';

    private readonly transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true', // true if port is 465
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD,
            },
        });
    }

    async sendMail(options: MailOptions): Promise<void> {
        await this.transporter.sendMail({
            from: options.from || process.env.SMTP_FROM || process.env.SMTP_USER,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
            attachments: options.attachments,
        });
    }
}
