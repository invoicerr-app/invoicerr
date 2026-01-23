/**
 * Transmission model type
 */
export type TransmissionModel =
  | 'email' // Direct email
  | 'peppol' // Peppol network
  | 'clearance' // Pre-clearance (Italy SdI, Saudi ZATCA, India IRP)
  | 'pdp' // Platform de dématérialisation partenaire (France)
  | 'rttr' // Real-time transmission reporting (Hungary NAV, Greece myDATA)
  | 'hash_chain'; // Hash chain reporting (Spain Veri*Factu, Portugal)

/**
 * Transmission status
 */
export type TransmissionStatus =
  | 'pending' // Not yet submitted
  | 'submitted' // Submitted to platform
  | 'validated' // Format validated
  | 'accepted' // Accepted by recipient/platform
  | 'rejected' // Rejected
  | 'delivered'; // Successfully delivered

/**
 * Transmission configuration for a transaction type
 */
export interface TransmissionConfig {
  /** Transmission model */
  model: TransmissionModel;
  /** Platform identifier (e.g., 'chorus', 'sdi', 'ksef', 'superpdp', 'nav') */
  platform?: string;
  /** i18n label key */
  labelKey: string;
  /** Icon name */
  icon: string;
  /** Is e-invoicing mandatory */
  mandatory: boolean;
  /** Date from which e-invoicing becomes mandatory (ISO string) */
  mandatoryFrom?: string;
  /** Is the transmission asynchronous */
  async: boolean;
  /** Deadline in days after invoice date */
  deadlineDays?: number;
}

/**
 * Payload for transmission
 */
export interface TransmissionPayload {
  /** Company ID (for loading platform-specific settings) */
  companyId: string;
  /** Internal invoice ID */
  invoiceId: string;
  /** Invoice number */
  invoiceNumber: string;
  /** PDF buffer */
  pdfBuffer: Buffer;
  /** XML content (e-invoice format) */
  xmlContent?: string;
  /** E-invoice format used */
  format?: string;
  /** Recipient information */
  recipient: {
    email: string;
    name: string;
    /** ISO 3166-1 alpha-2 country code */
    country?: string;
    siret?: string;
    vatNumber?: string;
    /** Peppol participant ID */
    peppolId?: string;
    /** Italy: Codice Destinatario or PEC */
    codiceDestinatario?: string;
    pec?: string;
    /** Poland: KSeF recipient number */
    ksefNumber?: string;
  };
  /** Sender information */
  sender: {
    email: string;
    name: string;
    siret?: string;
    vatNumber?: string;
    /** Peppol participant ID */
    peppolId?: string;
  };
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Result of a transmission
 */
export interface TransmissionResult {
  /** Was transmission successful */
  success: boolean;
  /** External ID assigned by platform (KSeF ID, IRN, MARK, etc.) */
  externalId?: string;
  /** Status of the transmission */
  status?: TransmissionStatus;
  /** URL to view/validate the invoice on the platform */
  validationUrl?: string;
  /** QR code data returned by platform */
  qrCodeData?: string;
  /** Error code if failed */
  errorCode?: string;
  /** Human-readable message */
  message?: string;
  /** Additional platform-specific metadata (e.g., hash chain data, signatures) */
  metadata?: Record<string, unknown>;
}

/**
 * Interface for transmission strategies
 */
export interface TransmissionStrategy {
  /** Strategy name */
  readonly name: string;
  /** Supported platforms */
  readonly supportedPlatforms: string[];

  /** Check if this strategy supports a platform */
  supports(platform: string): boolean;

  /** Send the invoice */
  send(payload: TransmissionPayload): Promise<TransmissionResult>;

  /** Check transmission status (optional, for async platforms) */
  checkStatus?(externalId: string): Promise<TransmissionStatus>;

  /** Cancel a transmission (optional, if supported by platform) */
  cancel?(externalId: string): Promise<boolean>;
}
