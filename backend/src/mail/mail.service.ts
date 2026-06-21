import { IMailProvider, MailOptions } from '@/mail/types';

import { BrevoMailProvider } from '@/mail/providers/brevo.provider';
import { Injectable } from '@nestjs/common';
import { SmtpMailProvider } from '@/mail/providers/smtp.provider';
import { logger } from '@/logger/logger.service';

export type { MailOptions, MailAttachment } from '@/mail/types';

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
                break;
            default:
                throw new Error(
                    `Unknown MAIL_PROVIDER "${selected}". Supported values: "smtp", "brevo".`,
                );
        }
    }

    async sendMail(options: MailOptions) {
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
