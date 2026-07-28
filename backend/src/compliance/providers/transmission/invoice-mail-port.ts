/**
 * Port for sending invoice emails — mirrors InvoiceArtifactPort on the format side.
 *
 * The implementation lives in the `invoice-rendering` module (cycle-safe: it does not import
 * compliance). The compliance layer depends only on this port.
 *
 * NOTE: The gateway re-renders the PDF via InvoiceRenderingService.renderPdfFormat using
 * the company's invoicePDFFormat preference. We intentionally do NOT reuse artifacts[].bytes
 * from the executor because a default-country plan produces PLAIN_PDF which would diverge
 * from the company preference. Optimization (share rendered bytes) is possible later.
 */

/**
 * Per-company SMTP overrides forwarded from the channel-credentials store.
 * When provided, the gateway sends via a one-shot nodemailer transport built from these
 * values instead of the global MAIL_PROVIDER. Decrypted upstream; NEVER log `password`.
 */
export interface SmtpOverrides {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** NEVER log this field. */
  password: string;
  fromAddress: string;
}

export interface InvoiceMailPort {
  /**
   * Send the invoice by email (template + recipient resolved on the app side).
   * Pass `smtpOverrides` to use per-company SMTP instead of the global mail provider.
   * Returns `skipped: true` when the client has no email address.
   */
  sendInvoiceEmail(
    invoiceId: string,
    smtpOverrides?: SmtpOverrides,
  ): Promise<{ sent: boolean; skipped?: boolean; reason?: string }>;
}
