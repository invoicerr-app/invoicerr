/**
 * Authentication method for clearance platforms
 */
export type ClearanceAuthMethod =
  | 'oauth2'
  | 'api_key'
  | 'certificate'
  | 'qualified_signature'
  | 'usb_token';

/**
 * Clearance response type
 */
export type ClearanceResponseType =
  | 'sync' // Immediate response
  | 'async_poll' // Must poll for result
  | 'async_webhook'; // Result sent via webhook

/**
 * Clearance model configuration (for countries with pre-clearance)
 */
export interface ClearanceConfig {
  /** Is clearance enabled for this country */
  enabled: boolean;
  /** Platform name */
  platform: string;
  /** Authentication method */
  authMethod: ClearanceAuthMethod;
  /** OAuth/API auth endpoint */
  authEndpoint?: string;
  /** Invoice submission endpoint */
  submitEndpoint?: string;
  /** Response type */
  responseType: ClearanceResponseType;
  /** Polling endpoint (for async_poll) */
  pollingEndpoint?: string;
  /** Does platform assign the invoice number */
  assignsInvoiceNumber: boolean;
  /** Field name for returned invoice ID */
  returnedIdField?: string;
  /** Format/pattern of returned ID */
  returnedIdFormat?: string;
  /** Does platform return a QR code */
  returnsQRCode?: boolean;
  /** Does platform return a validation URL */
  returnsValidationUrl?: boolean;
  /** Does buyer need to accept (B2B) */
  buyerAcceptance?: boolean;
  /** Timeout for auto-acceptance (days) */
  acceptanceTimeout?: number;
  /** Auto-accept if no response */
  autoAccept?: boolean;
  /** Requires middleware/GSP (India) */
  requiresMiddleware?: boolean;
  /** Known middleware providers */
  middlewareExamples?: string[];
}
