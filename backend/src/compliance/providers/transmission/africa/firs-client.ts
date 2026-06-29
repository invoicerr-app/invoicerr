/**
 * Nigeria FIRS e-invoice (MBS — Multi-Billing System) client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   1. Register as a FIRS-accredited e-invoice solution provider.
 *   2. Auth: POST /api/v1/auth/token with clientId + clientSecret → Bearer token.
 *   3. Generate IRN: POST /api/v1/invoice/irn with invoice payload.
 *      FIRS returns: irn (Invoice Reference Number), qrCode, timestamp.
 *   4. Sign: the invoice is signed by the taxpayer's certificate before submission.
 *   5. Submit: POST /api/v1/invoice/submit with signed payload + IRN.
 *   6. Poll: GET /api/v1/invoice/status/{irn} for clearance status.
 *
 * IRN formula (FIRS MBS spec §4.1):
 *   SHA-256 hex( tinSupplier | invoiceNumber | serviceId | issueDateYYYY-MM-DD )
 *
 * Endpoints (FIRS MBS sandbox):
 *   Base: https://eivc-k6z6d.ondigitalocean.app
 *
 * No public sandbox credentials — live proof deferred.
 */

export type FirsEnvironment = 'sandbox' | 'prod';

const FIRS_BASE_URLS: Record<FirsEnvironment, string> = {
  sandbox: 'https://eivc-k6z6d.ondigitalocean.app',
  prod: 'https://einvoice.firs.gov.ng',
};

// ---------------------------------------------------------------------------
// Types (aligned to FIRS MBS e-invoice API v1)
// ---------------------------------------------------------------------------

export interface FirsAuthRequest {
  /** Taxpayer TIN (12 digits). */
  clientId: string;
  /** API client secret from FIRS MBS registration. */
  clientSecret: string;
}

export interface FirsAuthResponse {
  /** Bearer token for subsequent calls. */
  accessToken: string;
  /** Token type: "Bearer" */
  tokenType: string;
  /** Expiry in seconds. */
  expiresIn: number;
}

export interface FirsInvoiceLine {
  lineId: number;
  productDescription: string;
  quantity: number;
  unitPrice: number;
  taxableAmount: number;
  /** VAT rate as percentage (e.g. 7.5 for 7.5%). */
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
}

export interface FirsInvoicePayload {
  /** Supplier TIN (12 digits). */
  businessName: string;
  tinSupplier: string;
  /** Buyer TIN (12 digits, or "0000000000000" for individuals). */
  tinBuyer: string;
  buyerName: string;
  buyerAddress: string;
  /** Invoice number from the issuing system. */
  invoiceNumber: string;
  /** ISO 8601 date: YYYY-MM-DD. */
  invoiceDate: string;
  /** ISO 4217 currency code (usually "NGN"). */
  currency: string;
  /** Service ID from FIRS MBS activity type list. */
  serviceId: string;
  lines: FirsInvoiceLine[];
  /** Totals. */
  taxableAmount: number;
  totalVat: number;
  totalAmount: number;
  /**
   * Pre-computed IRN (client-side SHA-256).
   * The FIRS server validates and re-issues the authoritative IRN.
   * TODO: do not send this — let the server generate the IRN.
   */
  irn?: string;
}

export interface FirsIrnResponse {
  /** Invoice Reference Number (SHA-256 hex, 64 chars). */
  irn: string;
  /** Base64-encoded QR code image (PNG). */
  qrCode: string;
  /** ISO 8601 timestamp of IRN issuance. */
  timestamp: string;
  /** Status: "GENERATED" | "CLEARED" */
  status: string;
}

export interface FirsSubmitResponse {
  /** IRN (same as the one sent). */
  irn: string;
  /** Status after submission. */
  status: string;
  /** Human-readable message. */
  message: string;
  /** Authority timestamp. */
  processedAt?: string;
}

export interface FirsStatusResponse {
  irn: string;
  status: 'CLEARED' | 'REJECTED' | 'PENDING' | 'SUBMITTED';
  message?: string;
  /** Authority clearance date. */
  clearedAt?: string;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface FirsHttpPort {
  /** Authenticate and return Bearer token. */
  authenticate(baseUrl: string, req: FirsAuthRequest): Promise<FirsAuthResponse>;
  /** Generate IRN for the invoice. Returns irn + QR code. */
  generateIrn(baseUrl: string, accessToken: string, payload: FirsInvoicePayload): Promise<FirsIrnResponse>;
  /** Submit the signed invoice payload to FIRS. */
  submitInvoice(baseUrl: string, accessToken: string, payload: FirsInvoicePayload & { irn: string }): Promise<FirsSubmitResponse>;
  /** Poll for the invoice status by IRN. */
  getStatus(baseUrl: string, accessToken: string, irn: string): Promise<FirsStatusResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface FirsClientConfig {
  environment: FirsEnvironment;
  /** FIRS MBS client ID (TIN-based). */
  clientId: string;
  /** FIRS MBS client secret. */
  clientSecret?: string;
  /** Service ID (activity type from FIRS MBS list). */
  serviceId?: string;
}

// ---------------------------------------------------------------------------
// IRN computation (client-side pre-check)
// ---------------------------------------------------------------------------

/**
 * Computes the FIRS Invoice Reference Number (client-side).
 *
 * Formula (FIRS MBS spec §4.1):
 *   SHA-256 hex( tinSupplier | invoiceNumber | serviceId | invoiceDate )
 *
 * SCAFFOLD: The FIRS server generates the authoritative IRN.
 * This client-side value is informational only.
 */
export function computeFirsIrn(
  tinSupplier: string,
  invoiceNumber: string,
  serviceId: string,
  invoiceDate: string,
): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  const raw = `${tinSupplier}|${invoiceNumber}|${serviceId}|${invoiceDate}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * FIRS MBS e-invoice client (Nigeria).
 *
 * SCAFFOLD — mocked HTTP port used in tests; real network calls deferred.
 * Missing for real integration:
 *   - XAdES/PKCS#7 signing of the invoice payload (FIRS-certified certificate)
 *   - Service ID (activity type) lookup from FIRS MBS catalogue
 *   - Buyer TIN validation (FIRS TIN lookup endpoint)
 *   - Multi-currency handling (NGN is the primary; FX rate from CBN required)
 *   - IRN QR code embedding in the invoice PDF
 *   - Cancellation flow (FIRS IRN cancellation within 24h)
 *
 * LIVE PROOF: DEFERRED — FIRS MBS clientId + clientSecret required.
 */
export class FirsClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: FirsHttpPort,
    private readonly config: FirsClientConfig,
  ) {
    this.baseUrl = FIRS_BASE_URLS[config.environment];
  }

  /** Authenticate with FIRS MBS and return a session token. */
  async authenticate(): Promise<FirsAuthResponse> {
    return this.http.authenticate(this.baseUrl, {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret ?? '',
    });
  }

  /**
   * Generate an IRN for a new invoice.
   * LIVE PROOF: DEFERRED — FIRS MBS credentials required.
   */
  async generateIrn(accessToken: string, payload: FirsInvoicePayload): Promise<FirsIrnResponse> {
    return this.http.generateIrn(this.baseUrl, accessToken, payload);
  }

  /**
   * Submit a signed invoice to FIRS (after IRN generation).
   * LIVE PROOF: DEFERRED.
   */
  async submitInvoice(
    accessToken: string,
    payload: FirsInvoicePayload,
    irn: string,
  ): Promise<FirsSubmitResponse> {
    return this.http.submitInvoice(this.baseUrl, accessToken, { ...payload, irn });
  }

  /**
   * Poll the invoice status by IRN.
   */
  async getStatus(accessToken: string, irn: string): Promise<FirsStatusResponse> {
    return this.http.getStatus(this.baseUrl, accessToken, irn);
  }

  /** Full flow: authenticate → generate IRN → submit. Returns IRN + QR. */
  async submitNew(payload: FirsInvoicePayload): Promise<{ irn: string; qrCode: string; status: string }> {
    const auth = await this.authenticate();
    const irnResp = await this.generateIrn(auth.accessToken, payload);
    const submit = await this.submitInvoice(auth.accessToken, payload, irnResp.irn);
    return { irn: irnResp.irn, qrCode: irnResp.qrCode, status: submit.status };
  }
}
