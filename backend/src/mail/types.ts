export interface MailAttachment {
    filename: string;
    content: Buffer | Uint8Array;
    contentType?: string;
}

export interface MailOptions {
    to?: string;
    from?: string;
    /**
     * Address recipients reply to, when it should differ from `from` (typical
     * for a no-reply sender). Callers pass the company's configured address;
     * when omitted, providers fall back to the MAIL_REPLY_TO environment
     * variable, and when that is unset no Reply-To header is sent at all.
     */
    replyTo?: string;
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
