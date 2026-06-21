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
 * Common contract for every mail transport (SMTP, Brevo, ...).
 * Implementations read their own credentials from the environment and
 * are selected at runtime by `MailService` based on `MAIL_PROVIDER`.
 */
export interface IMailProvider {
    /** Human-readable identifier, used for logging. */
    readonly id: string;
    sendMail(options: MailOptions): Promise<void>;
}
