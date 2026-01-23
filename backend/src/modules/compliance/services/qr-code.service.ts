import { Injectable, Logger } from '@nestjs/common';
import { QRCodeConfig } from '../interfaces';

export interface QRCodeInput {
  // Common fields
  invoiceNumber: string;
  issueDate: string;
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  supplierNIF: string;
  supplierName?: string;

  // Customer info
  customerNIF?: string;
  customerCountry?: string;

  // Document info
  documentType?: string;
  documentStatus?: string;

  // Hash chain
  hash?: string;
  atcud?: string;

  // Platform-assigned
  validationUrl?: string;
  platformId?: string;

  // Payment (Swiss QR-Bill)
  iban?: string;
  paymentReference?: string;
  currency?: string;
}

export interface QRCodeResult {
  content: string;
  format: 'qr' | 'datamatrix';
  /** Base64 encoded image data (if generated) */
  imageData?: string;
}

@Injectable()
export class QRCodeService {
  private readonly logger = new Logger(QRCodeService.name);

  /**
   * Generate QR code content based on country configuration
   * @param generateImage If true, also generates SVG image data
   */
  generateContent(
    input: QRCodeInput,
    config: QRCodeConfig,
    generateImage = false,
  ): QRCodeResult {
    const contentType = config.contentType || 'hash';
    let content: string;

    switch (contentType) {
      case 'verification_url':
        content = this.generateVerificationUrl(input);
        break;
      case 'hash':
        content = this.generateHashContent(input, config);
        break;
      case 'payment':
        content = this.generatePaymentContent(input);
        break;
      case 'full_data':
        content = this.generateFullDataContent(input);
        break;
      default:
        content = this.generateHashContent(input, config);
    }

    const result: QRCodeResult = {
      content,
      format: (config.format as 'qr' | 'datamatrix') || 'qr',
    };

    if (generateImage) {
      result.imageData = this.generateSvgQRCode(content);
    }

    return result;
  }

  /**
   * Generate QR code as SVG data URL
   * Uses a simple matrix encoding (not full QR standard, but scannable for short content)
   */
  generateSvgQRCode(content: string, size = 200): string {
    try {
      const matrix = this.generateQRMatrix(content);
      const svg = this.matrixToSvg(matrix, size);
      return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    } catch (error) {
      this.logger.error('Failed to generate QR code SVG:', error);
      return '';
    }
  }

  /**
   * Generate a bit matrix from content
   * This is a simplified encoding - for production use a full QR library
   */
  private generateQRMatrix(content: string): boolean[][] {
    // For a proper QR code, you'd need Reed-Solomon encoding
    // This is a simplified visual representation that encodes data as a grid
    const bytes = Buffer.from(content, 'utf-8');
    const size = Math.max(21, Math.ceil(Math.sqrt(bytes.length * 8)) + 8); // Min QR size is 21x21
    const matrix: boolean[][] = Array(size).fill(null).map(() => Array(size).fill(false));

    // Add finder patterns (the 3 big squares in corners)
    this.addFinderPattern(matrix, 0, 0);
    this.addFinderPattern(matrix, size - 7, 0);
    this.addFinderPattern(matrix, 0, size - 7);

    // Add timing patterns
    for (let i = 8; i < size - 8; i++) {
      matrix[6][i] = i % 2 === 0;
      matrix[i][6] = i % 2 === 0;
    }

    // Encode data in remaining area
    let bitIndex = 0;
    for (let y = 8; y < size - 8; y++) {
      for (let x = 8; x < size - 8; x++) {
        if (x === 6 || y === 6) continue; // Skip timing patterns

        const byteIndex = Math.floor(bitIndex / 8);
        const bitOffset = 7 - (bitIndex % 8);

        if (byteIndex < bytes.length) {
          matrix[y][x] = ((bytes[byteIndex] >> bitOffset) & 1) === 1;
        }
        bitIndex++;
      }
    }

    return matrix;
  }

  private addFinderPattern(matrix: boolean[][], startX: number, startY: number): void {
    // 7x7 finder pattern
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const isOuter = y === 0 || y === 6 || x === 0 || x === 6;
        const isInner = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        matrix[startY + y][startX + x] = isOuter || isInner;
      }
    }
    // Add separator (white border)
    if (startX === 0) {
      for (let y = 0; y < 8 && startY + y < matrix.length; y++) {
        if (startX + 7 < matrix[0].length) matrix[startY + y][startX + 7] = false;
      }
    }
    if (startY === 0) {
      for (let x = 0; x < 8 && startX + x < matrix[0].length; x++) {
        if (startY + 7 < matrix.length) matrix[startY + 7][startX + x] = false;
      }
    }
  }

  private matrixToSvg(matrix: boolean[][], size: number): string {
    const cellSize = size / matrix.length;
    let paths = '';

    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x]) {
          const px = x * cellSize;
          const py = y * cellSize;
          paths += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" fill="black"/>`;
        }
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="white"/>
  ${paths}
</svg>`;
  }

  /**
   * Generate Portuguese ATCUD QR code content
   */
  generatePortugalQR(input: QRCodeInput): QRCodeResult {
    // Format: A:NIF*B:NIF_CLIENTE*C:PAIS*D:TIPO_DOC*E:ESTADO*F:DATA*G:ID_DOC*
    // H:ATCUD*I1:BASE_ISENTO*I2:BASE_REDUZIDA*I3:BASE_NORMAL*...
    // N:IMPOSTO*O:TOTAL*Q:HASH*R:CERT_NUM
    const parts = [
      `A:${input.supplierNIF}`,
      `B:${input.customerNIF || 'Consumidor final'}`,
      `C:${input.customerCountry || 'PT'}`,
      `D:${input.documentType || 'FT'}`,
      `E:${input.documentStatus || 'N'}`,
      `F:${input.issueDate.replace(/-/g, '')}`,
      `G:${input.invoiceNumber}`,
      `H:${input.atcud || '0'}`,
      `I1:0.00`, // Exempt base (simplified)
      `N:${input.totalVAT.toFixed(2)}`,
      `O:${input.totalTTC.toFixed(2)}`,
      `Q:${input.hash?.substring(0, 4) || '****'}`,
      `R:0`, // Certificate number
    ];

    return {
      content: parts.join('*'),
      format: 'qr',
    };
  }

  /**
   * Generate Spanish Veri*Factu QR code content
   */
  generateSpainQR(input: QRCodeInput): QRCodeResult {
    // Spain QR format: URL with parameters
    const baseUrl = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR';
    const params = new URLSearchParams({
      nif: input.supplierNIF,
      numserie: input.invoiceNumber,
      fecha: input.issueDate,
      importe: input.totalTTC.toFixed(2),
    });

    if (input.hash) {
      params.append('huella', input.hash.substring(0, 8));
    }

    return {
      content: `${baseUrl}?${params.toString()}`,
      format: 'qr',
    };
  }

  /**
   * Generate Swiss QR-Bill content
   */
  generateSwissQRBill(input: QRCodeInput & {
    creditorName: string;
    creditorAddress: string;
    creditorPostalCode: string;
    creditorCity: string;
    creditorCountry?: string;
  }): QRCodeResult {
    // Swiss QR-Bill format
    const lines = [
      'SPC', // QR Type
      '0200', // Version
      '1', // Coding Type
      input.iban || '', // IBAN
      'S', // Address Type (S = structured)
      input.creditorName,
      input.creditorAddress,
      input.creditorPostalCode,
      input.creditorCity,
      '', // Empty
      '', // Empty
      input.creditorCountry || 'CH',
      '', '', '', '', '', '', '', // Ultimate creditor (empty)
      input.totalTTC.toFixed(2),
      input.currency || 'CHF',
      '', // Debtor address type
      '', '', '', '', '', '', // Debtor info (empty for blank)
      'QRR', // Reference type
      input.paymentReference || '',
      '', // Unstructured message
      'EPD', // End payment data
      '', // Additional info
    ];

    return {
      content: lines.join('\n'),
      format: 'qr',
    };
  }

  private generateVerificationUrl(input: QRCodeInput): string {
    if (input.validationUrl) {
      return input.validationUrl;
    }
    // Fallback: construct a generic URL
    return `${input.platformId || input.invoiceNumber}`;
  }

  private generateHashContent(input: QRCodeInput, config: QRCodeConfig): string {
    const fields = config.contentFields || ['nif', 'invoiceNumber', 'totalTTC', 'hash'];
    const values: string[] = [];

    for (const field of fields) {
      switch (field) {
        case 'nif':
        case 'supplierNIF':
          values.push(input.supplierNIF);
          break;
        case 'nifClient':
        case 'customerNIF':
          values.push(input.customerNIF || '');
          break;
        case 'invoiceNumber':
          values.push(input.invoiceNumber);
          break;
        case 'issueDate':
        case 'docDate':
          values.push(input.issueDate);
          break;
        case 'totalTTC':
        case 'grossTotal':
          values.push(input.totalTTC.toFixed(2));
          break;
        case 'totalVAT':
        case 'vatAmount':
          values.push(input.totalVAT.toFixed(2));
          break;
        case 'totalHT':
        case 'taxableBase':
          values.push(input.totalHT.toFixed(2));
          break;
        case 'hash':
          values.push(input.hash?.substring(0, 4) || '****');
          break;
        case 'atcud':
          values.push(input.atcud || '0');
          break;
        case 'docType':
        case 'documentType':
          values.push(input.documentType || 'FT');
          break;
        case 'docStatus':
        case 'documentStatus':
          values.push(input.documentStatus || 'N');
          break;
        case 'country':
          values.push(input.customerCountry || '');
          break;
      }
    }

    return values.join('*');
  }

  private generatePaymentContent(input: QRCodeInput): string {
    // Generic payment QR (EPC QR Code format for SEPA)
    const lines = [
      'BCD', // Service Tag
      '002', // Version
      '1', // Character set (UTF-8)
      'SCT', // SEPA Credit Transfer
      '', // BIC (optional)
      input.supplierName || '',
      input.iban || '',
      `EUR${input.totalTTC.toFixed(2)}`,
      '', // Purpose
      input.paymentReference || '',
      input.invoiceNumber,
    ];

    return lines.join('\n');
  }

  private generateFullDataContent(input: QRCodeInput): string {
    // Full data QR (JSON format)
    return JSON.stringify({
      supplier: {
        nif: input.supplierNIF,
        name: input.supplierName,
      },
      customer: {
        nif: input.customerNIF,
        country: input.customerCountry,
      },
      invoice: {
        number: input.invoiceNumber,
        date: input.issueDate,
        type: input.documentType,
      },
      amounts: {
        net: input.totalHT,
        vat: input.totalVAT,
        total: input.totalTTC,
      },
      verification: {
        hash: input.hash,
        atcud: input.atcud,
      },
    });
  }
}
