/**
 * India GST IRP (Invoice Registration Portal) client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   1. Register as a GSP (GST Suvidha Provider) or use a licensed GSP.
 *   2. Auth: POST /auth with GSTIN + app_key (AES-256 encrypted OTP flow) → AuthToken + SekKey.
 *   3. Generate IRN: POST /Invoice/generate with signed INV-01 JSON payload.
 *      IRP returns: irn (SHA-256 of gstin|fy|docType|docNo), AckNo, AckDt, signedInvoice, signedQRCode.
 *   4. Cancel: POST /Invoice/cancel (within 24h; time-restricted).
 *
 * IRN hash formula (IRP spec §3.2):
 *   SHA-256 ( gstin | financial_year | doc_type | doc_no )
 *   where financial_year = "2024-25", doc_type = "INV"|"CRN"|"DBN"
 *
 * Endpoints (NIC sandbox):
 *   Base: https://einvoice1-sandbox.nic.in
 * Endpoints (production — via GSP):
 *   Base: https://einvoice1.gst.gov.in  (direct NIC)
 *   Or GSP-specific base URL.
 *
 * The signed QR code is a base64-encoded JSON payload signed by IRP's RSA key.
 * The buyer can decode it offline to verify the invoice without internet.
 *
 * No public sandbox credentials available — live proof deferred.
 */

export type InIrpEnvironment = 'sandbox' | 'prod';

const IRP_BASE_URLS: Record<InIrpEnvironment, string> = {
  sandbox: 'https://einvoice1-sandbox.nic.in',
  prod: 'https://einvoice1.gst.gov.in',
};

// ---------------------------------------------------------------------------
// Types (aligned to NIC IRP API v1.03 / GST Council specification)
// ---------------------------------------------------------------------------

export interface InIrpAuthRequest {
  /** GSTIN of the company (15-char alphanumeric). */
  gstin: string;
  /** AES-256-ECB encrypted app_key (TODO: real encryption). */
  appKey: string;
  /** Authentication token from GSP (for GSP-mode auth). */
  authToken?: string;
}

export interface InIrpAuthResponse {
  /** Session authentication token (expires in 6h). */
  authToken: string;
  /** AES-256 session encryption key (base64). */
  sek: string;
  /** Token expiry in seconds. */
  tokenExpiry: number;
}

export interface InIrpInvoicePayload {
  /**
   * Version of the e-invoice schema ("1.1" for INV-01 schema).
   * TODO: full INV-01 JSON payload per GST e-invoice schema.
   */
  version: string;
  /** Transaction details. */
  TranDtls: {
    TaxSch: 'GST';
    SupTyp: 'B2B' | 'B2C' | 'EXPWOP' | 'EXPWP';
    RegRev?: 'Y' | 'N';
    EcmGstin?: string;
    IgstOnIntra?: 'Y' | 'N';
  };
  /** Document details (the invoice header). */
  DocDtls: {
    Typ: 'INV' | 'CRN' | 'DBN';
    No: string;
    Dt: string; // DD/MM/YYYY
  };
  /** Seller details. */
  SellerDtls: {
    Gstin: string;
    LglNm: string;
    Addr1: string;
    Loc: string;
    Pin: number;
    Stcd: string; // State code
    Em?: string;
    Ph?: string;
  };
  /** Buyer details. */
  BuyerDtls: {
    Gstin: string;
    LglNm: string;
    Addr1: string;
    Loc: string;
    Pin: number;
    Stcd: string;
    Pos: string; // Place of supply
  };
  /** Invoice line items. */
  ItemList: Array<{
    SlNo: string;
    PrdDesc: string;
    IsServc: 'Y' | 'N';
    HsnCd: string; // TODO: real HSN/SAC code
    Qty: number;
    Unit: string;
    UnitPrice: number;
    TotAmt: number;
    AssAmt: number;
    GstRt: number;
    IgstAmt: number;
    CgstAmt: number;
    SgstAmt: number;
    TotItemVal: number;
  }>;
  /** Invoice value summary. */
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    TotInvVal: number;
  };
}

export interface InIrpIrnResponse {
  /** Invoice Reference Number — SHA-256 of {gstin}|{fy}|{docType}|{docNo} (hex, 64 chars). */
  Irn: string;
  /** Acknowledgement number (numeric sequence from IRP). */
  AckNo: string;
  /** Acknowledgement date-time (epoch ms). */
  AckDt: string;
  /** IRP-signed invoice JSON (base64). Includes IRP digital signature. */
  SignedInvoice: string;
  /** IRP-signed QR code data (base64). Offline-verifiable by the buyer. */
  SignedQRCode: string;
  /** Status: "1" = success. */
  Status: string;
  /** Info/warning messages from IRP. */
  InfoDtls?: Array<{ InfCd: string; Desc: string }>;
  EwbNo?: string;   // E-way bill number (when e-way bill is bundled)
  EwbDt?: string;
  EwbValidTill?: string;
}

export interface InIrpCancelRequest {
  /** IRN to cancel. */
  Irn: string;
  /** Cancel reason code: 1=Duplicate, 2=Data Entry Mistake, 3=Order Cancelled, 4=Others. */
  CnlRsn: '1' | '2' | '3' | '4';
  /** Cancel remarks (max 100 chars). */
  CnlRem: string;
}

export interface InIrpCancelResponse {
  /** IRN that was cancelled. */
  Irn: string;
  /** Cancellation date-time. */
  CancelDate: string;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface InIrpHttpPort {
  /** Authenticate with IRP and return auth token + session encryption key. */
  authenticate(baseUrl: string, req: InIrpAuthRequest): Promise<InIrpAuthResponse>;
  /** Generate an IRN for the given invoice payload. */
  generateIrn(baseUrl: string, authToken: string, payload: InIrpInvoicePayload): Promise<InIrpIrnResponse>;
  /** Cancel an existing IRN (within 24h). */
  cancelIrn(baseUrl: string, authToken: string, req: InIrpCancelRequest): Promise<InIrpCancelResponse>;
  /** Health-check endpoint (unauthenticated). */
  ping(baseUrl: string): Promise<{ status: string }>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface InIrpClientConfig {
  environment: InIrpEnvironment;
  /** GSTIN of the company (15-char). */
  gstin: string;
  /**
   * App key for AES auth (base64). In production: provided by GSP on registration.
   * TODO: wire to SigningCredentialsPort for encrypted key storage.
   */
  appKey?: string;
  /** GSP client_id (when going through a GSP rather than NIC direct). */
  clientId?: string;
  /** GSP client_secret. */
  clientSecret?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Computes the India e-invoice IRN (Invoice Reference Number).
 *
 * Formula (NIC IRP spec §3.2):
 *   SHA-256 hex( "{gstin}|{financialYear}|{docType}|{docNo}" )
 *
 * SCAFFOLD: uses Node's crypto — real IRP also verifies uniqueness server-side.
 * The actual IRN returned by the IRP overrides this client-side value.
 */
export function computeIrn(gstin: string, docDate: Date, docType: 'INV' | 'CRN' | 'DBN', docNo: string): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  const month = docDate.getMonth() + 1; // 1-based
  const year = docDate.getFullYear();
  // Financial year in India runs Apr–Mar; so Jan–Mar belong to "prevYear-currYear"
  const fyStart = month >= 4 ? year : year - 1;
  const fy = `${fyStart}-${String(fyStart + 1).slice(-2)}`; // e.g. "2025-26"
  const raw = `${gstin}|${fy}|${docType}|${docNo}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Client for the India IRP (Invoice Registration Portal).
 *
 * SCAFFOLD — mocked HTTP port used in tests; real network calls deferred.
 * Missing for real integration:
 *   - AES-256-ECB encryption of the app_key (NIC auth flow)
 *   - HSN/SAC code lookup per line item
 *   - E-way bill bundling (mandatory when value > ₹50,000 for certain goods)
 *   - State code (Stcd) mapping from address
 *   - Full INV-01 payload per GST schema (many mandatory fields stubbed with TODO)
 */
export class InIrpClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: InIrpHttpPort,
    private readonly config: InIrpClientConfig,
  ) {
    this.baseUrl = IRP_BASE_URLS[config.environment];
  }

  /** Authenticate with IRP and return a session auth token. */
  async authenticate(): Promise<InIrpAuthResponse> {
    // TODO (real): encrypt this.config.appKey with AES-256-ECB (NIC key);
    //              use client_id+secret for GSP-mode auth.
    const appKey = this.config.appKey ?? '<!-- TODO: IRP AES app_key -->';
    return this.http.authenticate(this.baseUrl, {
      gstin: this.config.gstin,
      appKey,
    });
  }

  /**
   * Generate an IRN for a new invoice.
   *
   * In production: sign the payload with the company's registered digital certificate
   * (Class 3 DSC), then send to IRP. IRP returns the IRN + signed QR code.
   *
   * LIVE PROOF: DEFERRED — real GSTIN + DSC + GSP credentials required.
   */
  async generateIrn(authToken: string, payload: InIrpInvoicePayload): Promise<InIrpIrnResponse> {
    return this.http.generateIrn(this.baseUrl, authToken, payload);
  }

  /** Cancel an existing IRN. Only possible within 24h of issue. */
  async cancelIrn(authToken: string, irn: string, reason: '1' | '2' | '3' | '4', remarks: string): Promise<InIrpCancelResponse> {
    return this.http.cancelIrn(this.baseUrl, authToken, { Irn: irn, CnlRsn: reason, CnlRem: remarks });
  }

  /** Full flow: authenticate → generate IRN. */
  async submitInvoice(payload: InIrpInvoicePayload): Promise<InIrpIrnResponse> {
    const auth = await this.authenticate();
    return this.generateIrn(auth.authToken, payload);
  }

  /** Health check (unauthenticated ping). */
  async ping(): Promise<{ status: string }> {
    return this.http.ping(this.baseUrl);
  }
}
