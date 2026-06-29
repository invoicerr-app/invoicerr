export interface MailAttachment {
    filename: string;
    content: Buffer | Uint8Array;
    contentType?: string;
}

export interface MailOptions {
    to?: string;
    from?: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: MailAttachment[];
}

/**
 * Per-company SMTP overrides — when present, MailService builds a one-shot nodemailer
 * transport instead of using the global MAIL_PROVIDER. Decrypted by the channel-credentials
 * layer; never logged.
 */
export interface SmtpOverrides {
    host: string;
    port: number;
    secure: boolean;
    /** SMTP AUTH username (e.g. 'apikey' for SendGrid). */
    username: string;
    /** SMTP AUTH password / API key — NEVER log this field. */
    password: string;
    /** Envelope From address (e.g. 'invoices@company.com'). */
    fromAddress: string;
}

/**
 * Common contract for every mail transport (SMTP, Brevo, ...).
 * Implementations read their own credentials from the environment and
 * are selected at runtime by `MailService` based on `MAIL_PROVIDER`.
 */
export interface IMailProvider {
    /** Human-readable identifier, used for logging. */
    readonly id: string;
    sendMail(options: MailOptions): Promise<void>;
}
