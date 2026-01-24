/**
 * Hybrid Renderer
 * Creates PDF/A-3 with embedded XML for Factur-X/ZUGFeRD
 */

import { Injectable, Logger } from '@nestjs/common';
import { IDocumentRenderer, OutputFormat, RenderOptions } from '../document.types';
import { PDFRenderer } from './pdf.renderer';

@Injectable()
export class HybridRenderer implements IDocumentRenderer {
  private readonly logger = new Logger(HybridRenderer.name);
  private readonly pdfRenderer: PDFRenderer;

  constructor() {
    this.pdfRenderer = new PDFRenderer();
  }

  /**
   * Render HTML to PDF/A-3 with embedded XML
   */
  async render(
    html: string,
    format: OutputFormat,
    options?: RenderOptions,
  ): Promise<Buffer> {
    // First, generate the base PDF
    const pdfBuffer = await this.pdfRenderer.render(html, format, {
      ...options,
      pdfACompliant: true,
    });

    // If no XML to embed, return the PDF as-is
    if (!options?.xml || !options?.embedXml) {
      return pdfBuffer;
    }

    // Embed XML into PDF
    try {
      return await this.embedXmlInPdf(pdfBuffer, options.xml, options.xmlSyntax);
    } catch (error) {
      this.logger.warn(
        'Failed to embed XML in PDF, returning plain PDF',
        error,
      );
      return pdfBuffer;
    }
  }

  /**
   * Embed XML attachment into PDF/A-3
   *
   * Note: This is a simplified implementation. For production use,
   * consider using a library like pdf-lib or hummus for proper
   * PDF/A-3 compliance and XML embedding.
   */
  private async embedXmlInPdf(
    pdfBuffer: Buffer,
    xml: string,
    syntax?: 'ubl' | 'cii' | 'fatturapa',
  ): Promise<Buffer> {
    // Dynamic import of pdf-lib
    const { PDFDocument, PDFName, AFRelationship } = await import('pdf-lib');

    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Determine filename based on syntax
    const filename = this.getXmlFilename(syntax);

    // Convert XML to bytes
    const xmlBytes = Buffer.from(xml, 'utf-8');

    // Embed the XML file
    await pdfDoc.attach(xmlBytes, filename, {
      mimeType: 'text/xml',
      description: 'Factur-X XML Invoice Data',
      afRelationship: AFRelationship.Data,
    });

    // Set PDF/A-3 metadata
    pdfDoc.setTitle('Invoice');
    pdfDoc.setSubject('Electronic Invoice');
    pdfDoc.setProducer('Invoicerr');
    pdfDoc.setCreator('Invoicerr Compliance Module');

    // Add XMP metadata for Factur-X conformance
    // Note: Full XMP metadata would require additional handling

    // Save the PDF
    const modifiedPdfBytes = await pdfDoc.save();

    return Buffer.from(modifiedPdfBytes);
  }

  /**
   * Get XML filename based on syntax
   */
  private getXmlFilename(syntax?: 'ubl' | 'cii' | 'fatturapa'): string {
    switch (syntax) {
      case 'cii':
        return 'factur-x.xml';
      case 'ubl':
        return 'invoice.xml';
      case 'fatturapa':
        return 'FatturaPA.xml';
      default:
        return 'invoice.xml';
    }
  }
}
