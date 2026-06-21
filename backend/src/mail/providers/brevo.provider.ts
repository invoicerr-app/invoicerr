import { BrevoClient } from '@getbrevo/brevo';
import { IMailProvider, MailOptions } from '@/mail/types';

/**
 * Brevo (ex-Sendinblue) transactional email transport, using the official
 * `@getbrevo/brevo` SDK. Selected when `MAIL_PROVIDER=brevo`.
 *
 * Reads `BREVO_API_KEY` for authentication. The sender address falls back to
 * MAIL_FROM, then the historical SMTP_FROM / SMTP_USER so existing setups keep
 * a valid "from" without extra configuration.
 */
export class BrevoMailProvider implements IMailProvider {
    readonly id = 'brevo';

    private readonly client: BrevoClient;

    constructor() {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            throw new Error('MAIL_PROVIDER is "brevo" but BREVO_API_KEY is not set.');
        }
        this.client = new BrevoClient({ apiKey });
    }

    async sendMail(options: MailOptions): Promise<void> {
        const to = options.to?.trim();
        if (!to) {
            throw new Error('Missing recipient email address (options.to).');
        }

        const fromRaw =
            options.from || process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;
        const sender = this.parseSender(fromRaw);
        if (!sender.email) {
            throw new Error(
                'Missing sender email address. Set MAIL_FROM (or SMTP_FROM/SMTP_USER) or pass options.from.',
            );
        }

        await this.client.transactionalEmails.sendTransacEmail({
            sender,
            to: [{ email: to }],
            subject: options.subject,
            htmlContent: options.html,
            textContent: options.text,
            attachment: options.attachments?.length
                ? options.attachments.map((a) => ({
                    name: a.filename,
                    content: Buffer.from(a.content).toString('base64'),
                }))
                : undefined,
        });
    }

    /** Accepts "email@host" or "Name <email@host>" and returns Brevo's sender shape. */
    private parseSender(from?: string): { email: string; name?: string } {
        if (!from) return { email: '' };
        const match = from.match(/^\s*(.*?)\s*<\s*(.+?)\s*>\s*$/);
        if (match) {
            return { name: match[1] || undefined, email: match[2] };
        }
        return { email: from.trim() };
    }
}
