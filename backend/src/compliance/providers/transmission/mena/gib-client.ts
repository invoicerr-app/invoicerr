/**
 * Turkey GİB (Gelir İdaresi Başkanlığı) e-Fatura / e-Arşiv client — scaffold, live-deferred.
 *
 * GİB architecture:
 *  - e-Fatura: B2B registered invoices (buyer must be GİB-registered).
 *    Sent via GİB Web Service (GWS) or private integrator (özel entegratör).
 *  - e-Arşiv: invoices to non-registered buyers (B2C/unregistered B2B).
 *    Also submitted via GİB or integrator, but not posted to buyer directly.
 *
 * Auth: username/password (GİB portal) or integrator credentials.
 * Format: UBL-TR (urn:oasis…Invoice-2 + GİB namespace extensions).
 * Signing: e-İmza (XAdES-BES) required for every document.
 *
 * Endpoints (GİB direct — integrators provide their own):
 *   Test:  https://efaturaportal.gib.gov.tr/EFaturaTest/
 *   Prod:  https://efaturaportal.gib.gov.tr/EFatura/
 *
 * TODO for live integration:
 *   1. Sign UBL-TR with e-İmza (XAdES-BES) via the signing port.
 *   2. Wrap in GİB envelope (sendInvoice SOAP or REST).
 *   3. Submit and receive UUID/status.
 *   4. Poll for ACCEPTED/REJECTED (GİB returns async acknowledgement).
 *   5. For e-Arşiv: submit daily report to GİB within 24 h.
 *
 * Credentials live in the channel-credentials store (never in source).
 */

export interface GibClientConfig {
  baseUrl: string;
  vkn: string;         // VKN (Vergi Kimlik Numarası, 10 digits) — seller tax ID
  username: string;    // GİB portal username
  password: string;    // GİB portal password (secret, encrypted at rest)
  integrator?: string; // optional: integrator code if using özel entegratör
}

export interface GibHttpPort {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
}

export interface GibSubmitResult {
  /** GİB-assigned UUID for the document (36-char UUID v4). */
  uuid: string;
  /** HTTP status returned by GİB. */
  httpStatus: number;
  raw: unknown;
}

export interface GibStatusResult {
  /** e.g. 'WAITING', 'ACCEPTED', 'REJECTED', 'SENDING'. */
  status: string;
  uuid: string;
  raw: unknown;
}

/**
 * GibClient — thin HTTP layer around the GİB e-Fatura / e-Arşiv REST API.
 *
 * Scaffold: real endpoint paths and request shapes are documented; the HTTP
 * calls are wired but the port is a stub (throws unless replaced in tests).
 */
export class GibClient {
  constructor(
    private readonly config: GibClientConfig,
    private readonly http: GibHttpPort,
  ) {}

  /**
   * Submit a signed UBL-TR e-Fatura (or e-Arşiv) document to GİB.
   *
   * GİB expects:
   *   POST /sendInvoice
   *   Content-Type: application/json
   *   Body: { vkn, invoiceContent: base64(signedUblTrXml), invoiceType: 'SATIS'|'IADE' }
   *
   * Returns UUID assigned by GİB.
   *
   * TODO: implement real SOAP/REST envelope per GİB WebService spec (WSDL available).
   */
  async sendInvoice(signedUblTrXml: string, invoiceType: 'SATIS' | 'IADE' = 'SATIS'): Promise<GibSubmitResult> {
    const token = await this._authenticate();
    const body = {
      vkn: this.config.vkn,
      invoiceContent: Buffer.from(signedUblTrXml, 'utf-8').toString('base64'),
      invoiceType,
    };
    const resp = await this.http.post(
      `${this.config.baseUrl}/sendInvoice`,
      body,
      { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    );
    if (resp.status >= 400) {
      throw new Error(`GİB sendInvoice failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const uuid = (data['uuid'] ?? data['invoiceUUID'] ?? data['id'] ?? '') as string;
    return { uuid: String(uuid), httpStatus: resp.status, raw: data };
  }

  /**
   * Poll GİB for the status of a previously submitted document.
   *
   * GİB endpoint: GET /getInvoiceStatus?uuid={uuid}
   *
   * TODO: handle GİB status codes: WAITING | ACCEPTED | REJECTED | SENDING | CANCELLED.
   */
  async getInvoiceStatus(uuid: string): Promise<GibStatusResult> {
    const token = await this._authenticate();
    const resp = await this.http.get(
      `${this.config.baseUrl}/getInvoiceStatus?uuid=${encodeURIComponent(uuid)}`,
      { Authorization: `Bearer ${token}` },
    );
    if (resp.status >= 400) {
      throw new Error(`GİB getInvoiceStatus failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const status = (data['status'] ?? data['invoiceStatus'] ?? 'WAITING') as string;
    return { status: String(status), uuid, raw: data };
  }

  /**
   * Authenticate against GİB and return a bearer token.
   *
   * GİB uses a token endpoint (OAuth2 / basic auth depending on channel).
   * TODO: implement proper GİB auth flow with certificate or username/password.
   */
  private async _authenticate(): Promise<string> {
    // TODO: real GİB auth — username/password → POST /login → token
    // For now this is a stub; the token is returned by the port when replaced in tests.
    const resp = await this.http.post(
      `${this.config.baseUrl}/login`,
      { username: this.config.username, password: this.config.password, vkn: this.config.vkn },
      { 'Content-Type': 'application/json' },
    );
    if (resp.status >= 400) throw new Error(`GİB authentication failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    return (data['token'] ?? data['access_token'] ?? '') as string;
  }
}

/** Map GİB-specific status strings to our canonical TransmissionStatus. */
export function mapGibStatus(s: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
  const u = s.toUpperCase();
  if (['ACCEPTED', 'SUCCESS', 'APPROVED'].some((t) => u.includes(t))) return 'CLEARED';
  if (['REJECTED', 'FAILED', 'CANCELLED', 'ERROR'].some((t) => u.includes(t))) return 'REJECTED';
  return 'PENDING';
}
