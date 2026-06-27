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
export interface InvoiceMailPort {
  /**
   * Send the invoice by email (template + recipient resolved on the app side).
   * Returns `skipped: true` when the client has no email address.
   */
  sendInvoiceEmail(
    invoiceId: string,
  ): Promise<{ sent: boolean; skipped?: boolean; reason?: string }>;
}
