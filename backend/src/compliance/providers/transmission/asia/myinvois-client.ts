/**
 * Malaysia MyInvois (LHDNM) client — scaffold, live-deferred.
 *
 * MyInvois is Malaysia's national e-invoice platform operated by LHDNM (Lembaga Hasil Dalam Negeri Malaysia).
 * It accepts UBL 2.1 (and JSON-LD) invoices and performs clearance before sharing with the buyer.
 *
 * Real integration requires:
 *   1. Register via the MyInvois portal (myinvois.hasil.gov.my); obtain client_id + client_secret.
 *   2. Auth: POST /connect/token (OAuth2 client_credentials) → access_token (1h).
 *   3. Submit: POST /api/v1.0/documentsubmissions
 *      Body: { documents: [{ format: "XML", documentHash: "<sha256-hex>", codeNumber: "<tin>",
 *              document: "<base64-UBL-2.1>" }] }
 *   4. Poll: GET /api/v1.0/documents/<uuid>/details → status (Valid / Invalid / Cancelled / Submitted)
 *   5. After "Valid": the platform shares the document with the buyer; the validation "UIN" is
 *      embedded in the document by the platform (a platform-generated UUID stamped on the XML).
 *
 * The submitted UBL 2.1 document must include:
 *   - cac:InvoiceTypeCode = "01" (invoice) or "02" (credit note)
 *   - cbc:ProfileID = "reporting:1.0"  (B2C) or "billing:1.0" (B2B/B2G)
 *   - cac:AccountingSupplierParty + cac:AccountingCustomerParty
 *   - SHA-256 hash of the document in the submission envelope
 *
 * Endpoints (pre-production / sandbox):
 *   Auth: https://preprod.myinvois.hasil.gov.my/connect/token
 *   API:  https://preprod.myinvois.hasil.gov.my/api/v1.0/
 * Endpoints (production):
 *   Auth: https://myinvois.hasil.gov.my/connect/token
 *   API:  https://api.myinvois.hasil.gov.my/api/v1.0/
 *
 * No public sandbox credentials available — live proof deferred.
 */

export type MyInvoisEnvironment = 'preprod' | 'prod';

const AUTH_URLS: Record<MyInvoisEnvironment, string> = {
  preprod: 'https://preprod.myinvois.hasil.gov.my/connect/token',
  prod: 'https://myinvois.hasil.gov.my/connect/token',
};

const API_URLS: Record<MyInvoisEnvironment, string> = {
  preprod: 'https://preprod.myinvois.hasil.gov.my/api/v1.0',
  prod: 'https://api.myinvois.hasil.gov.my/api/v1.0',
};

// ---------------------------------------------------------------------------
// Types (aligned to MyInvois Developer Portal documentation v1.0)
// ---------------------------------------------------------------------------

export interface MyInvoisTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  /** Scope granted (e.g. "InvoicingAPI"). */
  scope: string;
}

export interface MyInvoisDocument {
  /** "XML" (UBL 2.1) or "JSON". */
  format: 'XML' | 'JSON';
  /** SHA-256 hex hash of the raw document bytes. */
  documentHash: string;
  /** Seller TIN (Tax Identification Number, 12-14 chars). */
  codeNumber: string;
  /** Base64-encoded UBL 2.1 / JSON document. */
  document: string;
}

export interface MyInvoisSubmissionRequest {
  documents: MyInvoisDocument[];
}

export interface MyInvoisSubmissionResponse {
  submissionUID: string;
  acceptedDocuments: Array<{
    uuid: string;
    invoiceCodeNumber: string;
  }>;
  rejectedDocuments: Array<{
    invoiceCodeNumber: string;
    error: { code: string; message: string; details?: string };
  }>;
}

export type MyInvoisDocStatus = 'Submitted' | 'Valid' | 'Invalid' | 'Cancelled';

export interface MyInvoisDocumentDetails {
  uuid: string;
  submissionUID: string;
  longId: string;
  internalId: string;
  typeName: string;
  typeVersionName: string;
  issuerTin: string;
  receiverId: string;
  receiverName: string;
  dateTimeIssued: string;
  dateTimeReceived: string;
  dateTimeValidated?: string;
  totalSales: number;
  totalDiscount: number;
  netAmount: number;
  total: number;
  status: MyInvoisDocStatus;
  cancelDateTime?: string;
  rejectRequestDateTime?: string;
  documentStatusReason?: string;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface MyInvoisHttpPort {
  /**
   * OAuth2 client_credentials grant — returns bearer token.
   * POST /connect/token with application/x-www-form-urlencoded.
   */
  getToken(authUrl: string, clientId: string, clientSecret: string, scope: string): Promise<MyInvoisTokenResponse>;

  /**
   * Submit documents for validation and clearance.
   * POST /api/v1.0/documentsubmissions
   */
  submitDocuments(apiBase: string, token: string, req: MyInvoisSubmissionRequest): Promise<MyInvoisSubmissionResponse>;

  /**
   * Poll document validation status by UUID.
   * GET /api/v1.0/documents/{uuid}/details
   */
  getDocumentDetails(apiBase: string, token: string, uuid: string): Promise<MyInvoisDocumentDetails>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface MyInvoisClientConfig {
  environment: MyInvoisEnvironment;
  /** OAuth2 client_id (obtained from MyInvois portal). */
  clientId: string;
  /** OAuth2 client_secret (store encrypted at rest). */
  clientSecret: string;
  /** Seller TIN (e.g. "C12345678900"). */
  tin: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Client for Malaysia MyInvois (LHDNM) e-invoice platform.
 *
 * SCAFFOLD — mocked HTTP port used in tests; real network calls deferred.
 * Missing for real integration:
 *   - SHA-256 computation of the submitted UBL document (documentHash)
 *   - UBL 2.1 namespace + mandatory LHDNM extensions (cbc:ProfileID, cac:Signature)
 *   - Webhook / SSE for real-time status push (alternative to polling)
 *   - Long ID (QR link) embedding in the final PDF/XML after clearance
 *   - Cancellation flow (buyer-side rejection and seller-side recall within 72h)
 */
export class MyInvoisClient {
  private readonly authUrl: string;
  private readonly apiBase: string;
  private cachedToken?: { token: string; expiresAt: number };

  constructor(
    private readonly http: MyInvoisHttpPort,
    private readonly config: MyInvoisClientConfig,
  ) {
    this.authUrl = AUTH_URLS[config.environment];
    this.apiBase = API_URLS[config.environment];
  }

  /**
   * Obtain an OAuth2 access token (client_credentials).
   * Caches the token for its lifetime (~1h) to avoid redundant auth calls.
   */
  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }
    const resp = await this.http.getToken(
      this.authUrl,
      this.config.clientId,
      this.config.clientSecret,
      'InvoicingAPI',
    );
    this.cachedToken = {
      token: resp.access_token,
      expiresAt: now + (resp.expires_in - 60) * 1000, // 1-min grace period
    };
    return resp.access_token;
  }

  /**
   * Compute the SHA-256 hex hash of a UBL document for the submission envelope.
   *
   * SCAFFOLD: uses Node's crypto. The hash covers the raw bytes of the document
   * BEFORE base64-encoding — consistent with MyInvois spec §3.1.
   */
  static computeDocumentHash(documentBytes: Uint8Array): string {
    const { createHash } = require('crypto') as typeof import('crypto');
    return createHash('sha256').update(Buffer.from(documentBytes)).digest('hex');
  }

  /**
   * Submit one or more UBL 2.1 documents for clearance.
   *
   * LIVE PROOF: DEFERRED — real client_id + client_secret + valid TIN required.
   */
  async submit(documents: MyInvoisDocument[]): Promise<MyInvoisSubmissionResponse> {
    const token = await this.getToken();
    return this.http.submitDocuments(this.apiBase, token, { documents });
  }

  /**
   * Poll a document's clearance status by UUID.
   * Returns "Valid" once LHDNM has validated the document.
   */
  async getStatus(uuid: string): Promise<MyInvoisDocumentDetails> {
    const token = await this.getToken();
    return this.http.getDocumentDetails(this.apiBase, token, uuid);
  }

  /**
   * Full flow: authenticate → submit → return submission result.
   * Caller should then poll getStatus(uuid) until status === "Valid".
   */
  async submitInvoice(
    ublBytes: Uint8Array,
    invoiceNumber: string,
  ): Promise<MyInvoisSubmissionResponse> {
    const docHash = MyInvoisClient.computeDocumentHash(ublBytes);
    const docBase64 = Buffer.from(ublBytes).toString('base64');
    return this.submit([
      {
        format: 'XML',
        documentHash: docHash,
        codeNumber: invoiceNumber,
        document: docBase64,
      },
    ]);
  }
}
