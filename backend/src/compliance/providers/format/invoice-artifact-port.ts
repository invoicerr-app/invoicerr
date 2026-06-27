import { ExportFormat } from '@fin.cx/einvoice';

/** Reuse the app's real rendering (moved to InvoiceRenderingService) by invoice id. */
export interface InvoiceArtifactPort {
  renderPdf(invoiceId: string): Promise<Uint8Array>;
  renderPdfFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array>;
}
