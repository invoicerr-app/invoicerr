import * as nodemailer from 'nodemailer';

import { Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';

interface MailOptions {
    to?: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: nodemailer.Attachment[];
}

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter;

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

    async sendMail(options: MailOptions) {
        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            ...options,
        };

        try {
            await this.transporter.sendMail(mailOptions);
        } catch (error) {
            logger.error('Failed to send email. Please check your SMTP configuration.', { category: 'mail', details: { error } });
            throw new Error('Failed to send email. Please check your SMTP configuration.');
        }

        return { message: 'Email sent successfully' };
    }
}