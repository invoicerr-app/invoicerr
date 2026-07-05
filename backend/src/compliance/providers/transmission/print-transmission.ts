import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelConfigSchema, TransmissionProvider } from './transmission-provider';

/**
 * Physical print / simplified receipt — universal fallback channel.
 *
 * Produces a printable A4 PDF containing:
 *   - Invoice summary (seller, buyer, date, currency, reference)
 *   - A QR code encoding the key invoice fields as JSON
 *
 * This is a REAL implementation: PDF bytes are produced offline using pdfkit
 * (no browser / Puppeteer dependency). The QR code is generated with the `qrcode`
 * library and embedded as a PNG image in the PDF.
 *
 * feedback = NONE: fire-and-forget; no downstream status polling needed.
 * optionalConfig = true: no company channel config required; always runs.
 */
export class PrintTransmissionProvider implements TransmissionProvider {
  readonly id = 'print';
  readonly channel: ChannelType = 'PRINT';
  readonly feedback = 'NONE' as const;
  readonly optionalConfig = true;
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'switch', name: 'includeQR', label: 'Include QR code', default: true },
      { type: 'switch', name: 'includePaymentInfo', label: 'Include payment information', default: false },
    ],
  };

  /**
   * Build the QR payload string for an invoice.
   * The payload is a compact JSON object with key invoice fields.
   * This is the canonical source for QR content — readable by any generic QR scanner.
   */
  static buildQrPayload(ctx: TransactionContext, key: string): string {
    return JSON.stringify({
      ref: ctx.externalRef ?? key.slice(-16),
      seller: ctx.supplier.legalName,
      buyer: ctx.buyer.legalName,
      date: ctx.issueDate instanceof Date
        ? ctx.issueDate.toISOString().split('T')[0]
        : String(ctx.issueDate ?? '').split('T')[0],
      currency: ctx.currency ?? 'EUR',
    });
  }

  /**
   * Render a QR code PNG buffer from a payload string.
   * Returns a Buffer starting with PNG magic bytes (\\x89PNG).
   */
  static async buildQrBuffer(payload: string): Promise<Buffer> {
    const QRCode = await import('qrcode');
    return QRCode.toBuffer(payload, { type: 'png', width: 200, margin: 1 }) as Promise<Buffer>;
  }

  /**
   * Generate a printable A4 PDF with invoice summary + embedded QR code.
   *
   * Returns a Buffer that starts with `%PDF` and is renderable by any PDF viewer.
   * Usable offline — no network call, no browser / Puppeteer dependency.
   */
  async buildPrintPdf(ctx: TransactionContext, key: string): Promise<Buffer> {
    // pdfkit is a CommonJS module (@types/pdfkit uses `export =`, so the module
    // type IS the PDFDocument constructor); dynamic import wraps it with
    // .default in ESM contexts but Jest (CJS transform) may expose it directly
    // — handle both.
    type PdfKitCtor = typeof import('pdfkit');
    const pdfkitModule = (await import('pdfkit')) as { default?: PdfKitCtor };
    const PDFDocument: PdfKitCtor = pdfkitModule.default ?? (pdfkitModule as PdfKitCtor);
    const qrPayload = PrintTransmissionProvider.buildQrPayload(ctx, key);
    const qrPng = await PrintTransmissionProvider.buildQrBuffer(qrPayload);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'Invoice', Author: 'Invoicerr' } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const sellerName = ctx.supplier.legalName;
      const buyerName = ctx.buyer.legalName;
      const issueDate = ctx.issueDate instanceof Date
        ? ctx.issueDate.toISOString().split('T')[0]
        : String(ctx.issueDate ?? 'N/A').split('T')[0];
      const ref = ctx.externalRef ?? key.slice(-16);
      const currency = ctx.currency ?? 'EUR';

      // ── Header ────────────────────────────────────────────────────────────
      doc.fontSize(22).font('Helvetica-Bold').text('INVOICE', { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Invoice fields ─────────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica');
      const labelWidth = 110;
      const addField = (label: string, value: string) => {
        const y = doc.y;
        doc.font('Helvetica-Bold').text(label, 50, y, { width: labelWidth, continued: false });
        doc.font('Helvetica').text(value, 50 + labelWidth, y);
      };

      addField('Reference:', ref);
      addField('Date:', issueDate);
      addField('Currency:', currency);
      addField('Seller:', sellerName);
      addField('Buyer:', buyerName);

      doc.moveDown(1.5);

      // ── QR code ────────────────────────────────────────────────────────────
      doc.fontSize(10).font('Helvetica').text('Scan to verify invoice details:', { align: 'center' });
      doc.moveDown(0.3);

      // Centre the QR image on the page (A4 width = 595pt; usable = 495pt; image 120pt)
      const qrX = (595 - 50 * 2 - 120) / 2 + 50;
      doc.image(qrPng, qrX, doc.y, { width: 120 });
      doc.moveDown(0.3);

      // ── Footer ─────────────────────────────────────────────────────────────
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.fontSize(8).fillColor('#888').text('Generated by Invoicerr', { align: 'center' });

      doc.end();
    });
  }

  async transmit(
    _artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
  ): Promise<TransmissionResult> {
    try {
      const pdfBytes = await this.buildPrintPdf(ctx, key);
      log.info('transmission/print', `printable PDF generated (${pdfBytes.length} bytes, key ${key})`);
      return {
        channel: 'PRINT',
        status: 'SENT',
        notes: [`pdf_bytes: ${pdfBytes.length}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/print', `PDF generation failed: ${msg} (key ${key})`);
      return { channel: 'PRINT', status: 'SENT', notes: [`print: pdf error: ${msg}`] };
    }
  }
}
