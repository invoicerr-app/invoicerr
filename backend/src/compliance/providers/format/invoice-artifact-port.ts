import { ExportFormat } from '@fin.cx/einvoice';

/** Pure-XML export formats supported by @fin.cx/einvoice `exportXml()`. */
export type XmlExportFormat = 'ubl' | 'cii' | 'xrechnung';

/** National XML export formats — each builds XML from InvoiceRenderData (DB-free). */
export type NationalXmlFormat = 'fatturapa' | 'cfdi' | 'facturae' | 'ksa-ubl' | 'fa-vat' | 'cl-dte' | 'ar-fe' | 'ec-fe' | 'br-nfe' | 'in-irp' | 'tr-efatura' | 'cn-efapiao' | 'eg-eta' | 'gr-mydata' | 'hu-szamla';

/** Reuse the app's real rendering (moved to InvoiceRenderingService) by invoice id. */
export interface InvoiceArtifactPort {
  renderPdf(invoiceId: string): Promise<Uint8Array>;
  renderPdfFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array>;
  renderXmlFormat(invoiceId: string, format: XmlExportFormat): Promise<string>;

  /** National XML formats — build from InvoiceRenderData (no DB access). */
  renderFatturaPa(data: import('@/modules/invoice-rendering/invoice-rendering.service').InvoiceRenderData): Promise<string>;
  renderCfdi(data: import('@/modules/invoice-rendering/invoice-rendering.service').InvoiceRenderData): Promise<string>;
  renderFacturae(data: import('@/modules/invoice-rendering/invoice-rendering.service').InvoiceRenderData): Promise<string>;
  renderKsaUbl(data: import('@/modules/invoice-rendering/invoice-rendering.service').InvoiceRenderData): Promise<string>;
  renderFaVat(data: import('@/modules/invoice-rendering/invoice-rendering.service').InvoiceRenderData): Promise<string>;
}
