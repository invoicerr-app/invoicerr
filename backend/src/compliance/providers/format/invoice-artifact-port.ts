/** Hybrid PDF/A-3 + pure-XML export formats supported by BuiltEInvoice. */
export type ExportFormat = 'ubl' | 'cii' | 'xrechnung' | 'facturx' | 'zugferd';

/** Pure-XML export formats (no PDF embedding). */
export type XmlExportFormat = 'ubl' | 'cii' | 'xrechnung';

/** National XML export formats — each builds XML from InvoiceRenderData (DB-free). */
export type NationalXmlFormat = 'fatturapa' | 'cfdi' | 'facturae' | 'ksa-ubl' | 'fa-vat' | 'cl-dte' | 'ar-fe' | 'ec-fe' | 'br-nfe' | 'in-irp' | 'tr-efatura' | 'cn-efapiao' | 'eg-eta' | 'gr-mydata' | 'hu-szamla';

/** Reuse the app's real rendering (moved to InvoiceRenderingService) by invoice id. */
export interface InvoiceArtifactPort {
  renderPdf(invoiceId: string): Promise<Uint8Array>;
  renderPdfFormat(invoiceId: string, format: '' | 'pdf' | ExportFormat): Promise<Uint8Array>;
  renderXmlFormat(invoiceId: string, format: XmlExportFormat): Promise<string>;

  /** National XML — fetches InvoiceRenderData internally, then builds XML. */
  renderFatturaPa(invoiceId: string): Promise<string>;
  renderCfdi(invoiceId: string): Promise<string>;
  renderFacturae(invoiceId: string): Promise<string>;
  renderKsaUbl(invoiceId: string): Promise<string>;
  renderFaVat(invoiceId: string): Promise<string>;
  /** Generic national XML — routes by countryCode. */
  renderNationalXml(invoiceId: string, countryCode: string): Promise<string>;
}
