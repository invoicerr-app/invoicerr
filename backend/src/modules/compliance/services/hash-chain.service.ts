import { Injectable, Logger } from '@nestjs/common';
import { createHash, createSign, createVerify } from 'node:crypto';
import { NumberingConfig } from '../interfaces';

export interface HashInput {
  invoiceNumber: string;
  issueDate: string;
  systemEntryDate?: string;
  totalHT: number;
  totalTTC: number;
  supplierNIF: string;
  customerNIF?: string;
  previousHash: string;
}

export interface HashResult {
  hash: string;
  signature?: string;
  inputString: string;
}

export interface ChainValidationResult {
  valid: boolean;
  brokenAt?: number;
  message?: string;
}

@Injectable()
export class HashChainService {
  private readonly logger = new Logger(HashChainService.name);

  /**
   * Generate hash for invoice (Spain Veri*Factu style)
   */
  generateHashSpain(input: HashInput, config: NumberingConfig): HashResult {
    // Spain hash input format:
    // NIF emisor + Número factura + Fecha expedición + Importe total + NIF destinatario + Hash anterior
    const inputString = [
      input.supplierNIF,
      input.invoiceNumber,
      input.issueDate,
      input.totalTTC.toFixed(2),
      input.customerNIF || '',
      input.previousHash || '0',
    ].join('|');

    const algorithm = config.hashAlgorithm || 'SHA-256';
    const hash = this.computeHash(inputString, algorithm);

    return {
      hash,
      inputString,
    };
  }

  /**
   * Generate hash for invoice (Portugal SAF-T style)
   */
  generateHashPortugal(input: HashInput, privateKeyPem?: string): HashResult {
    // Portugal hash input format:
    // Data factura + Data sistema + Identificador documento + Total bruto + Hash anterior
    const inputString = [
      input.issueDate,
      input.systemEntryDate || input.issueDate,
      input.invoiceNumber,
      input.totalTTC.toFixed(2),
      input.previousHash || '',
    ].join(';');

    // Portugal uses RSA-SHA1 signature
    const hash = this.computeHash(inputString, 'SHA-1');

    let signature: string | undefined;
    if (privateKeyPem) {
      signature = this.signData(inputString, privateKeyPem, 'RSA-SHA1');
    }

    return {
      hash,
      signature,
      inputString,
    };
  }

  /**
   * Generic hash generation based on config
   */
  generateHash(input: HashInput, config: NumberingConfig): HashResult {
    const fields = config.hashFields || [
      'invoiceNumber',
      'issueDate',
      'totalTTC',
      'previousHash',
    ];

    const values: string[] = [];
    for (const field of fields) {
      switch (field) {
        case 'invoiceNumber':
          values.push(input.invoiceNumber);
          break;
        case 'issueDate':
          values.push(input.issueDate);
          break;
        case 'systemEntryDate':
          values.push(input.systemEntryDate || input.issueDate);
          break;
        case 'totalHT':
          values.push(input.totalHT.toFixed(2));
          break;
        case 'totalTTC':
        case 'grossTotal':
          values.push(input.totalTTC.toFixed(2));
          break;
        case 'nif':
        case 'supplierNIF':
          values.push(input.supplierNIF);
          break;
        case 'customerNIF':
        case 'nifClient':
          values.push(input.customerNIF || '');
          break;
        case 'previousHash':
          values.push(input.previousHash || '0');
          break;
      }
    }

    const inputString = values.join(';');
    const algorithm = config.hashAlgorithm || 'SHA-256';
    const hash = this.computeHash(inputString, algorithm);

    return {
      hash,
      inputString,
    };
  }

  /**
   * Validate hash chain integrity (link validation only)
   */
  async validateChainLinks(
    invoices: Array<{
      hash: string;
      previousHash: string;
      sequence: number;
    }>,
  ): Promise<ChainValidationResult> {
    // Sort by sequence
    const sorted = [...invoices].sort((a, b) => a.sequence - b.sequence);

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const previous = sorted[i - 1];

      if (current.previousHash !== previous.hash) {
        return {
          valid: false,
          brokenAt: current.sequence,
          message: `Chain broken at sequence ${current.sequence}: expected previousHash ${previous.hash}, got ${current.previousHash}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Full chain validation - verifies both links and hash computation
   */
  async validateChain(
    invoices: Array<HashInput & { hash: string; sequence: number }>,
    config: NumberingConfig,
  ): Promise<ChainValidationResult> {
    // Sort by sequence
    const sorted = [...invoices].sort((a, b) => a.sequence - b.sequence);

    for (let i = 0; i < sorted.length; i++) {
      const invoice = sorted[i];

      // For first invoice, previousHash should be initial hash
      const expectedPreviousHash = i === 0
        ? this.getInitialHash()
        : sorted[i - 1].hash;

      // Verify link to previous
      if (invoice.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          brokenAt: invoice.sequence,
          message: `Chain broken at sequence ${invoice.sequence}: previousHash mismatch. Expected "${expectedPreviousHash}", got "${invoice.previousHash}"`,
        };
      }

      // Recompute hash and verify
      const recomputed = this.generateHash(invoice, config);

      if (recomputed.hash !== invoice.hash) {
        return {
          valid: false,
          brokenAt: invoice.sequence,
          message: `Hash mismatch at sequence ${invoice.sequence}: computed "${recomputed.hash}", stored "${invoice.hash}". Data may have been tampered.`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate a single invoice hash
   */
  validateSingleHash(
    invoice: HashInput & { hash: string },
    config: NumberingConfig,
  ): { valid: boolean; message?: string } {
    const recomputed = this.generateHash(invoice, config);

    if (recomputed.hash !== invoice.hash) {
      return {
        valid: false,
        message: `Hash mismatch: computed "${recomputed.hash}", stored "${invoice.hash}"`,
      };
    }

    return { valid: true };
  }

  /**
   * Get initial hash for first invoice in chain
   */
  getInitialHash(): string {
    return '0';
  }

  /**
   * Extract hash for QR code (typically first/last N characters)
   */
  extractHashForQR(hash: string, length: number = 4): string {
    return hash.substring(0, length);
  }

  private computeHash(data: string, algorithm: string): string {
    const normalizedAlgorithm = algorithm.toUpperCase().replace('-', '');

    switch (normalizedAlgorithm) {
      case 'SHA256':
        return createHash('sha256').update(data, 'utf8').digest('base64');
      case 'SHA1':
        return createHash('sha1').update(data, 'utf8').digest('base64');
      case 'SHA512':
        return createHash('sha512').update(data, 'utf8').digest('base64');
      case 'SHA3512':
        return createHash('sha3-512').update(data, 'utf8').digest('base64');
      default:
        this.logger.warn(`Unknown algorithm ${algorithm}, falling back to SHA-256`);
        return createHash('sha256').update(data, 'utf8').digest('base64');
    }
  }

  private signData(data: string, privateKeyPem: string, algorithm: string): string {
    try {
      const sign = createSign(algorithm);
      sign.update(data, 'utf8');
      return sign.sign(privateKeyPem, 'base64');
    } catch (error) {
      this.logger.error('Failed to sign data:', error);
      throw error;
    }
  }

  /**
   * Verify signature
   */
  verifySignature(
    data: string,
    signature: string,
    publicKeyPem: string,
    algorithm: string = 'RSA-SHA1',
  ): boolean {
    try {
      const verify = createVerify(algorithm);
      verify.update(data, 'utf8');
      return verify.verify(publicKeyPem, signature, 'base64');
    } catch (error) {
      this.logger.error('Failed to verify signature:', error);
      return false;
    }
  }
}
