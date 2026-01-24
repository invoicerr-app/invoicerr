/**
 * Document Renderers Index
 */

export { PDFRenderer } from './pdf.renderer';
export { HybridRenderer } from './hybrid.renderer';
export { XMLRenderer } from './xml.renderer';

import { OutputFormat } from '../document.types';
import { PDFRenderer } from './pdf.renderer';
import { HybridRenderer } from './hybrid.renderer';
import { XMLRenderer } from './xml.renderer';

/**
 * Get appropriate renderer for output format
 */
export function getRenderer(format: OutputFormat) {
  switch (format) {
    case 'pdf':
      return new PDFRenderer();
    case 'facturx':
    case 'zugferd':
    case 'xrechnung':
      return new HybridRenderer();
    case 'ubl':
    case 'cii':
    case 'fatturapa':
      return new XMLRenderer();
    default:
      return new PDFRenderer();
  }
}

/**
 * Get MIME type for output format
 */
export function getMimeType(format: OutputFormat): string {
  switch (format) {
    case 'pdf':
    case 'facturx':
    case 'zugferd':
    case 'xrechnung':
      return 'application/pdf';
    case 'ubl':
    case 'cii':
    case 'fatturapa':
      return 'application/xml';
    default:
      return 'application/pdf';
  }
}

/**
 * Get file extension for output format
 */
export function getFileExtension(format: OutputFormat): string {
  switch (format) {
    case 'pdf':
    case 'facturx':
    case 'zugferd':
    case 'xrechnung':
      return 'pdf';
    case 'ubl':
    case 'cii':
    case 'fatturapa':
      return 'xml';
    default:
      return 'pdf';
  }
}
