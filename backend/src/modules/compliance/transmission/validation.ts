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
 * Validate and throw if invalid
 */
export function assertValid(result: ValidationResult, context: string): void {
  if (!result.valid) {
    const errorMessages = result.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new BadRequestException(`Validation failed for ${context}: ${errorMessages}`);
  }
}
