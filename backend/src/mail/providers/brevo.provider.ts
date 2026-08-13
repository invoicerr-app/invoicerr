import { BrevoClient } from '@getbrevo/brevo';
import { IMailProvider, MailOptions } from '@/mail/types';

/**
 * Brevo (ex-Sendinblue) transactional email transport, using the official
 * `@getbrevo/brevo` SDK. Selected when `MAIL_PROVIDER=brevo`.
 *
 * Reads `BREVO_API_KEY` for authentication. The sender address falls back to
 * MAIL_FROM, then the historical SMTP_FROM / SMTP_USER so existing setups keep
 * a valid "from" without extra configuration. The reply-to address falls back
 * to MAIL_REPLY_TO and is omitted entirely when unset.
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
        const sender = this.parseAddress(fromRaw);
        if (!sender.email) {
            throw new Error(
                'Missing sender email address. Set MAIL_FROM (or SMTP_FROM/SMTP_USER) or pass options.from.',
            );
        }

        // Brevo rejects a replyTo without an email, so only build the object
        // once an address is actually configured.
        const replyToRaw = options.replyTo || process.env.MAIL_REPLY_TO;
        const replyTo = replyToRaw ? this.parseAddress(replyToRaw) : undefined;

        await this.client.transactionalEmails.sendTransacEmail({
            sender,
            replyTo: replyTo?.email ? replyTo : undefined,
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

    /** Accepts "email@host" or "Name <email@host>" and returns Brevo's address shape (used for both sender and replyTo). */
    private parseAddress(address?: string): { email: string; name?: string } {
        if (!address) return { email: '' };
        const match = address.match(/^\s*(.*?)\s*<\s*(.+?)\s*>\s*$/);
        if (match) {
            return { name: match[1] || undefined, email: match[2] };
        }
        return { email: address.trim() };
    }
}
