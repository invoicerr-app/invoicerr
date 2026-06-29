/**
 * Egypt ETA (Egyptian Tax Authority) e-invoicing client — scaffold, live-deferred.
 *
 * ETA architecture (key facts):
 *  - Document format: JSON (not XML). The invoice is a signed JSON document.
 *  - UUID: deterministic — derived from SHA-256 of the canonical document content.
 *  - Canonicalization: specific ETA rules (lowercase keys, sorted, no nulls).
 *  - Signature: Ed25519 (for resident taxpayers) or RSA-2048 (for non-resident).
 *    The signature covers the canonical bytes; the result is embedded in the document.
 *  - Submission: POST /api/v1/documentsubmissions (batch of up to 100 documents).
 *  - Status: GET /api/v1/documents/{uuid}/details
 *
 * TODO for live integration:
 *  1. Implement ETA canonicalization (lowercase keys, recursive sort, strip nulls).
 *  2. Compute SHA-256 hash → UUID seam.
 *  3. Apply Ed25519 or RSA signing via the signing port.
 *  4. POST to ETA with bearer token (client_credentials OAuth2).
 *  5. Poll GET /api/v1/documents/{uuid}/details for 'Valid'/'Invalid'.
 *
 * Credentials: client_id + client_secret from ETA taxpayer portal.
 * Sandbox: taxpayer.eta.gov.eg/portal (test environment).
 */

export interface EtaClientConfig {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string; // encrypted at rest
  taxRegistrationNumber: string; // seller TIN (RIN) from ETA
}

export interface EtaHttpPort {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
}

export interface EtaSubmitResult {
  /** UUID of the submitted document (derived from content hash by ETA). */
  uuid: string;
  /** ETA submission ID (for the batch). */
  submissionId: string;
  httpStatus: number;
  raw: unknown;
}

export interface EtaDocumentStatus {
  /** e.g. 'Valid', 'Invalid', 'Submitted', 'Cancelled'. */
  status: string;
  uuid: string;
  raw: unknown;
}

/**
 * EtaClient — HTTP layer around the ETA e-invoicing REST API.
 *
 * Document hash / UUID seam: the real implementation must compute the ETA-canonical
 * JSON bytes, hash them with SHA-256, and use that as the UUID. This is NOT a random
 * UUID — it is deterministic from the content (per ETA spec § 5.3).
 */
export class EtaClient {
  private _cachedToken?: { token: string; expiresAt: number };

  constructor(
    private readonly config: EtaClientConfig,
    private readonly http: EtaHttpPort,
  ) {}

  /**
   * Submit a batch of documents to ETA.
   *
   * ETA batch endpoint:
   *   POST {baseUrl}/api/v1/documentsubmissions
   *   Body: { documents: [{ typeName, typeVersionName, issuerType, issuerTaxpayerActivityCode, ... }] }
   *
   * The document must already be canonicalized, hashed, and signed before calling this.
   *
   * TODO: implement real ETA document schema (fields: typeName, typeVersionName, issuerType,
   *   issuerAddress, receiver, documentTypeVersion, dateTimeIssued, taxpayerActivityCode,
   *   invoiceLines, totalAmount, extraDiscountAmount, totalItemsDiscountAmount, signatures).
   */
  async submitDocument(canonicalDocument: Record<string, unknown>): Promise<EtaSubmitResult> {
    const token = await this._getToken();
    // TODO: compute UUID from SHA-256 of canonical bytes
    // const uuid = computeEtaUuid(canonicalDocument);
    const body = {
      documents: [canonicalDocument],
    };
    const resp = await this.http.post(
      `${this.config.baseUrl}/api/v1/documentsubmissions`,
      body,
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept-Language': 'ar',
      },
    );
    if (resp.status >= 400) throw new Error(`ETA submitDocument failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    // ETA returns { submissionId, acceptedDocuments: [{ uuid, ... }], rejectedDocuments: [] }
    const accepted = (data['acceptedDocuments'] as Array<Record<string, unknown>> | undefined) ?? [];
    const uuid = (accepted[0]?.['uuid'] ?? '') as string;
    const submissionId = (data['submissionId'] ?? '') as string;
    return { uuid: String(uuid), submissionId: String(submissionId), httpStatus: resp.status, raw: data };
  }

  /**
   * Poll ETA for the status of a document by UUID.
   *
   * ETA endpoint: GET {baseUrl}/api/v1/documents/{uuid}/details
   *
   * Returns: { status: 'Valid'|'Invalid'|'Submitted'|'Cancelled', uuid, ... }
   */
  async getDocumentStatus(uuid: string): Promise<EtaDocumentStatus> {
    const token = await this._getToken();
    const resp = await this.http.get(
      `${this.config.baseUrl}/api/v1/documents/${encodeURIComponent(uuid)}/details`,
      { Authorization: `Bearer ${token}`, 'Accept-Language': 'ar' },
    );
    if (resp.status >= 400) throw new Error(`ETA getDocumentStatus failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const status = (data['status'] ?? 'Submitted') as string;
    return { status: String(status), uuid, raw: data };
  }

  /**
   * Obtain an OAuth2 bearer token from ETA's identity server.
   *
   * ETA uses client_credentials flow:
   *   POST {tokenUrl}/connect/token
   *   Body: grant_type=client_credentials&client_id=…&client_secret=…
   *
   * Tokens are cached until expiry.
   */
  private async _getToken(): Promise<string> {
    if (this._cachedToken && Date.now() < this._cachedToken.expiresAt) {
      return this._cachedToken.token;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const resp = await this.http.post(
      `${this.config.tokenUrl}/connect/token`,
      body.toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    if (resp.status >= 400) throw new Error(`ETA authentication failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const token = (data['access_token'] ?? '') as string;
    const expiresIn = (data['expires_in'] ?? 3600) as number;
    this._cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
    return token;
  }
}

/**
 * Stub for ETA canonicalization.
 * TODO: implement per ETA SDK / spec:
 *   - lowercase all keys
 *   - sort object keys alphabetically
 *   - remove null/undefined values
 *   - arrays: sort by specific keys depending on type
 */
export function etaCanonicalize(doc: Record<string, unknown>): string {
  // TODO: implement ETA canonical JSON serialization
  return JSON.stringify(doc);
}

/**
 * Placeholder for ETA UUID computation.
 * Real UUID = SHA-256(UTF-8(canonical_json)).
 * TODO: import 'crypto' and implement.
 */
export function computeEtaUuid(_canonicalJson: string): string {
  // TODO: const hash = crypto.createHash('sha256').update(canonicalJson).digest('hex');
  // TODO: return formatAsUuid(hash);
  return 'TODO-ETA-UUID-FROM-SHA256';
}

/** Map ETA-specific status strings to canonical TransmissionStatus. */
export function mapEtaStatus(s: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
  const u = s.toUpperCase();
  // Check REJECTED tokens first (INVALID contains VALID, so order matters)
  if (['INVALID', 'REJECTED', 'CANCELLED', 'FAILED'].some((t) => u.includes(t))) return 'REJECTED';
  if (u === 'VALID' || u === 'ACCEPTED') return 'CLEARED';
  return 'PENDING';
}
