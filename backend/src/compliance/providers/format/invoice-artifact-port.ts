import { ExportFormat } from '@fin.cx/einvoice';

/** Pure-XML export formats supported by @fin.cx/einvoice `exportXml()`. */
export type XmlExportFormat = 'ubl' | 'cii' | 'xrechnung';

/** Reuse the app's real rendering (moved to InvoiceRenderingService) by invoice id. */
export interface InvoiceArtifactPort {
  renderPdf(invoiceId: string): Promise<Uint8Array>;
  renderPdfFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array>;
  renderXmlFormat(invoiceId: string, format: XmlExportFormat): Promise<string>;
}
