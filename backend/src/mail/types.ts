export interface MailAttachment {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
}

export interface MailOptions {
  to?: string;
  from?: string;
  /**
   * Reply-To header. Resolved ONCE, centrally, by `mail.service.ts`'s own
   * `resolveEffectiveReplyTo` (explicit value here, if a caller ever sets one, wins outright; else
   * the company's own override, then the instance's `MAIL_REPLY_TO`; `undefined` when none apply) —
   * every provider below just forwards whatever ends up here, never re-derives it.
   */
  replyTo?: string;
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
 * Common contract for every mail transport (SMTP, Resend, ...).
 * Implementations read their own credentials from the environment and
 * are selected at runtime by `MailService` based on `MAIL_PROVIDER`.
 */
export interface IMailProvider {
  /** Human-readable identifier, used for logging. */
  readonly id: string;
  sendMail(options: MailOptions): Promise<void>;
}
