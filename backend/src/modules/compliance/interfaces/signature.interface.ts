/**
 * Digital signature type
 */
export type SignatureType =
  | 'none' // No signature required
  | 'xades' // XAdES (XML Advanced Electronic Signatures)
  | 'pades' // PAdES (PDF Advanced Electronic Signatures)
  | 'hash_chain' // Hash chain signature (Spain, Portugal)
  | 'platform_sign' // Platform signs the invoice
  | 'national'; // National-specific signature (China SM2)

/**
 * Certificate type
 */
export type CertificateType =
  | 'none'
  | 'qualified' // EU Qualified certificate
  | 'advanced' // EU Advanced certificate
  | 'simple' // Simple certificate
  | 'usb_token' // USB token required (Vietnam, China)
  | 'platform'; // Platform-provided

/**
 * Signature configuration
 */
export interface SignatureConfig {
  /** Is signature required */
  required: boolean;
  /** Signature type */
  type: SignatureType;
  /** Hash algorithm (e.g., 'SHA-256', 'SHA-512', 'SM3') */
  algorithm?: string;
  /** Required certificate type */
  certificateType?: CertificateType;
  /** Is timestamp required */
  timestampRequired?: boolean;
}

/**
 * QR Code content type
 */
export type QRCodeContentType =
  | 'verification_url' // URL returned by platform (India, Malaysia)
  | 'hash' // Hash + verification data (Spain, Portugal)
  | 'payment' // Payment data (Swiss QR-Bill)
  | 'full_data'; // Full invoice data encoded (Greece)

/**
 * QR Code configuration
 */
export interface QRCodeConfig {
  /** Is QR code required */
  required: boolean;
  /** Content type */
  contentType?: QRCodeContentType;
  /** Fields to include in QR (for hash type) */
  contentFields?: string[];
  /** QR code format (e.g., 'qr', 'datamatrix') */
  format?: string;
  /** Position on PDF */
  position?: 'top-right' | 'bottom-right' | 'bottom-left';
}
