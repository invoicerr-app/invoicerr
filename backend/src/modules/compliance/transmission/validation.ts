import { BadRequestException } from '@nestjs/common';
import { TransmissionPayload } from './transmission.interface';

/**
 * Validation error with field and message
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate SIRET format (French)
 */
export function isValidSiret(siret: string): boolean {
  return /^[0-9]{14}$/.test(siret);
}

/**
 * Validate VAT number format (EU format)
 */
export function isValidVATNumber(vatNumber: string): boolean {
  // EU VAT format: 2-letter country code + 2-15 alphanumeric chars
  return /^[A-Z]{2}[A-Z0-9]{2,15}$/i.test(vatNumber);
}

/**
 * Validate Italian Codice Destinatario (7 chars alphanumeric)
 */
export function isValidCodiceDestinatario(codice: string): boolean {
  return /^[A-Z0-9]{7}$/i.test(codice);
}

/**
 * Validate Italian PEC email
 */
export function isValidPEC(pec: string): boolean {
  return isValidEmail(pec) && pec.toLowerCase().endsWith('.pec.it') || pec.includes('@pec.');
}

/**
 * Validate Peppol participant ID format
 * Format: {scheme}:{identifier} e.g., 0009:12345678901234
 */
export function isValidPeppolId(peppolId: string): boolean {
  return /^[0-9]{4}:[A-Z0-9]+$/i.test(peppolId);
}

/**
 * Validate ISO 3166-1 alpha-2 country code
 */
export function isValidCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code.toUpperCase());
}

/**
 * Validate base transmission payload (common fields)
 */
export function validateBasePayload(payload: TransmissionPayload): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!payload.invoiceId) {
    errors.push({ field: 'invoiceId', message: 'Invoice ID is required' });
  }

  if (!payload.invoiceNumber) {
    errors.push({ field: 'invoiceNumber', message: 'Invoice number is required' });
  }

  if (!payload.pdfBuffer || payload.pdfBuffer.length === 0) {
    errors.push({ field: 'pdfBuffer', message: 'PDF buffer is required and must not be empty' });
  }

  // Recipient validation
  if (!payload.recipient) {
    errors.push({ field: 'recipient', message: 'Recipient information is required' });
  } else {
    if (!payload.recipient.name) {
      errors.push({ field: 'recipient.name', message: 'Recipient name is required' });
    }

    if (payload.recipient.email && !isValidEmail(payload.recipient.email)) {
      errors.push({ field: 'recipient.email', message: 'Invalid recipient email format' });
    }

    if (payload.recipient.country && !isValidCountryCode(payload.recipient.country)) {
      errors.push({ field: 'recipient.country', message: 'Invalid country code format (must be ISO 3166-1 alpha-2)' });
    }
  }

  // Sender validation
  if (!payload.sender) {
    errors.push({ field: 'sender', message: 'Sender information is required' });
  } else {
    if (!payload.sender.name) {
      errors.push({ field: 'sender.name', message: 'Sender name is required' });
    }

    if (payload.sender.email && !isValidEmail(payload.sender.email)) {
      errors.push({ field: 'sender.email', message: 'Invalid sender email format' });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate payload for email transmission
 */
export function validateEmailPayload(payload: TransmissionPayload): ValidationResult {
  const baseResult = validateBasePayload(payload);
  const errors = [...baseResult.errors];

  if (!payload.recipient?.email) {
    errors.push({ field: 'recipient.email', message: 'Recipient email is required for email transmission' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate payload for Chorus Pro (France B2G)
 */
export function validateChorusPayload(payload: TransmissionPayload): ValidationResult {
  const baseResult = validateBasePayload(payload);
  const errors = [...baseResult.errors];

  if (!payload.recipient?.siret) {
    errors.push({ field: 'recipient.siret', message: 'Recipient SIRET is required for Chorus Pro' });
  } else if (!isValidSiret(payload.recipient.siret)) {
    errors.push({ field: 'recipient.siret', message: 'Invalid SIRET format (must be 14 digits)' });
  }

  if (!payload.sender?.siret) {
    errors.push({ field: 'sender.siret', message: 'Sender SIRET is required for Chorus Pro' });
  } else if (!isValidSiret(payload.sender.siret)) {
    errors.push({ field: 'sender.siret', message: 'Invalid SIRET format (must be 14 digits)' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate payload for SdI (Italy)
 */
export function validateSdIPayload(payload: TransmissionPayload): ValidationResult {
  const baseResult = validateBasePayload(payload);
  const errors = [...baseResult.errors];

  // Need either Codice Destinatario or PEC
  if (!payload.recipient?.codiceDestinatario && !payload.recipient?.pec) {
    errors.push({
      field: 'recipient.codiceDestinatario',
      message: 'Either Codice Destinatario or PEC is required for SdI',
    });
  }

  if (payload.recipient?.codiceDestinatario && !isValidCodiceDestinatario(payload.recipient.codiceDestinatario)) {
    errors.push({
      field: 'recipient.codiceDestinatario',
      message: 'Invalid Codice Destinatario format (must be 7 alphanumeric characters)',
    });
  }

  // Sender must have VAT number
  if (!payload.sender?.vatNumber) {
    errors.push({ field: 'sender.vatNumber', message: 'Sender VAT number is required for SdI' });
  }

  // XML content is required for SdI
  if (!payload.xmlContent) {
    errors.push({ field: 'xmlContent', message: 'FatturaPA XML content is required for SdI' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate payload for Peppol
 */
export function validatePeppolPayload(payload: TransmissionPayload): ValidationResult {
  const baseResult = validateBasePayload(payload);
  const errors = [...baseResult.errors];

  // Need Peppol ID or enough info to lookup
  if (!payload.recipient?.peppolId && !payload.recipient?.vatNumber) {
    errors.push({
      field: 'recipient.peppolId',
      message: 'Either Peppol ID or VAT number is required for Peppol transmission',
    });
  }

  if (payload.recipient?.peppolId && !isValidPeppolId(payload.recipient.peppolId)) {
    errors.push({
      field: 'recipient.peppolId',
      message: 'Invalid Peppol ID format (must be {scheme}:{identifier})',
    });
  }

  // XML content is required for Peppol
  if (!payload.xmlContent) {
    errors.push({ field: 'xmlContent', message: 'UBL XML content is required for Peppol' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate payload for PDP (France B2B)
 */
export function validatePDPPayload(payload: TransmissionPayload): ValidationResult {
  const baseResult = validateBasePayload(payload);
  const errors = [...baseResult.errors];

  // Need VAT number or SIRET
  if (!payload.recipient?.vatNumber && !payload.recipient?.siret) {
    errors.push({
      field: 'recipient.vatNumber',
      message: 'Either VAT number or SIRET is required for PDP transmission',
    });
  }

  if (!payload.sender?.vatNumber && !payload.sender?.siret) {
    errors.push({
      field: 'sender.vatNumber',
      message: 'Either VAT number or SIRET is required for PDP transmission',
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Polish NIP (tax identification number)
 * Format: 10 digits with checksum validation
 */
export function isValidNIP(nip: string): boolean {
  // Remove any dashes or spaces
  const cleanNip = nip.replace(/[-\s]/g, '');

  if (!/^[0-9]{10}$/.test(cleanNip)) {
    return false;
  }

  // NIP checksum validation
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanNip[i], 10) * weights[i];
  }

  const checkDigit = sum % 11;
  return checkDigit === parseInt(cleanNip[9], 10);
}

/**
 * Validate payload for KSeF (Poland)
 */
export function validateKSeFPayload(payload: TransmissionPayload): ValidationResult {
  const baseResult = validateBasePayload(payload);
  const errors = [...baseResult.errors];

  // Sender must have VAT number (NIP)
  if (!payload.sender?.vatNumber) {
    errors.push({ field: 'sender.vatNumber', message: 'Sender VAT number (NIP) is required for KSeF' });
  } else {
    // Validate NIP format (Polish VAT starts with PL)
    const nip = payload.sender.vatNumber.replace(/^PL/i, '');
    if (!isValidNIP(nip)) {
      errors.push({ field: 'sender.vatNumber', message: 'Invalid Polish NIP format' });
    }
  }

  // Recipient must have VAT number or KSeF number
  if (!payload.recipient?.vatNumber && !payload.recipient?.ksefNumber) {
    errors.push({
      field: 'recipient.vatNumber',
      message: 'Either VAT number or KSeF number is required for KSeF transmission',
    });
  }

  // XML content is required for KSeF
  if (!payload.xmlContent) {
    errors.push({ field: 'xmlContent', message: 'FA XML content is required for KSeF' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate and throw if invalid
 */
export function assertValid(result: ValidationResult, context: string): void {
  if (!result.valid) {
    const errorMessages = result.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new BadRequestException(`Validation failed for ${context}: ${errorMessages}`);
  }
}
