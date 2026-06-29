/**
 * Romania ANAF SPV / e-Factura client — scaffold, live-deferred.
 *
 * RO e-Factura architecture:
 *  - Format: UBL 2.1 (EN 16931 + RO_CIUS extension) or Factur-X/UN-EDIFACT.
 *  - Upload: PUT https://api.anaf.ro/test/FCTEL/rest/upload?standard=UBL&cif={cif}
 *    Body: binary UBL file.
 *    Auth: OAuth2 bearer token.
 *  - Index: on acceptance, ANAF attaches a Ministry signature and returns an index number.
 *  - Poll: GET https://api.anaf.ro/test/FCTEL/rest/stareMesaj?id_incarcare={id}
 *    Returns JSON: { stare: 'in prelucrare'|'ok'|'nok', ... }
 *  - Download: GET .../descarcare?id={id} — download signed/indexed XML + attached ANAF signature.
 *
 * OAuth2 flow: Authorization Code (with PKI certificate on behalf of taxpayer).
 *   Token endpoint: https://logincert.anaf.ro/anaf-oauth2/v1/token
 *
 * TODO for live integration:
 *   1. Implement OAuth2 with certificate-based auth (qualified signature / qualified cert).
 *   2. Upload UBL file (multipart or raw binary body).
 *   3. Poll stareMesaj until 'ok' or 'nok'.
 *   4. On 'ok': download indexed document with ANAF Ministry signature.
 */

export interface AnafClientConfig {
  baseUrl: string;          // e.g. https://api.anaf.ro/test or /prod/FCTEL/rest
  tokenUrl: string;         // OAuth2 token endpoint
  clientId: string;         // OAuth2 client_id (from ANAF SPV registration)
  clientSecret: string;     // OAuth2 client_secret (secret, encrypted at rest)
  cif: string;              // CUI/CIF (Romanian tax ID, digits only, no 'RO' prefix for API)
}

export interface AnafHttpPort {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  get(url: string, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
  put(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; data: unknown }>;
}

export interface AnafUploadResult {
  /** Upload ID (id_incarcare) returned by ANAF. Used for polling. */
  idIncarcare: string;
  httpStatus: number;
  raw: unknown;
}

export interface AnafStatusResult {
  /** ANAF status: 'in prelucrare' | 'ok' | 'nok' | 'XML cu erori neprelucrat' */
  stare: string;
  /** Optional: error messages when stare='nok'. */
  errors?: string[];
  raw: unknown;
}

/**
 * AnafClient — thin HTTP layer around the ANAF SPV e-Factura REST API.
 *
 * All methods use the cached OAuth2 bearer token.
 * The stub throws unless the HTTP port is replaced (in tests or live).
 */
export class AnafClient {
  private _cachedToken?: { token: string; expiresAt: number };

  constructor(
    private readonly config: AnafClientConfig,
    private readonly http: AnafHttpPort,
  ) {}

  /**
   * Upload a UBL XML e-Factura to ANAF SPV.
   *
   * ANAF endpoint:
   *   PUT {baseUrl}/upload?standard=UBL&cif={cif}
   *   Body: raw UBL XML bytes
   *   Headers: Authorization: Bearer {token}, Content-Type: text/plain
   *
   * Returns: { ExecutionStatus: 0, Errors: [], Notificari: [], id_incarcare: 12345 }
   */
  async uploadInvoice(ublXml: string): Promise<AnafUploadResult> {
    const token = await this._getToken();
    const resp = await this.http.put(
      `${this.config.baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(this.config.cif)}`,
      ublXml,
      { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    );
    if (resp.status >= 400) throw new Error(`ANAF upload failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const idIncarcare = (data['id_incarcare'] ?? data['idIncarcare'] ?? '') as string | number;
    return { idIncarcare: String(idIncarcare), httpStatus: resp.status, raw: data };
  }

  /**
   * Poll ANAF for the processing status of an upload.
   *
   * ANAF endpoint:
   *   GET {baseUrl}/stareMesaj?id_incarcare={idIncarcare}
   *
   * Returns: { stare: 'in prelucrare'|'ok'|'nok', ... }
   */
  async getStatus(idIncarcare: string): Promise<AnafStatusResult> {
    const token = await this._getToken();
    const resp = await this.http.get(
      `${this.config.baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(idIncarcare)}`,
      { Authorization: `Bearer ${token}` },
    );
    if (resp.status >= 400) throw new Error(`ANAF stareMesaj failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const stare = (data['stare'] ?? 'in prelucrare') as string;
    const errors = Array.isArray(data['Errors']) ? (data['Errors'] as string[]) : [];
    return { stare, errors, raw: data };
  }

  /**
   * Obtain an OAuth2 bearer token from ANAF's identity server.
   *
   * ANAF uses Authorization Code flow with certificate; in the scaffold we use
   * client_credentials for simplicity (actual live flow requires PKI cert).
   *
   * TODO: implement real ANAF OAuth2 Authorization Code + PKCE + qualified cert.
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
      `${this.config.tokenUrl}/token`,
      body.toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    if (resp.status >= 400) throw new Error(`ANAF authentication failed (HTTP ${resp.status})`);
    const data = resp.data as Record<string, unknown>;
    const token = (data['access_token'] ?? '') as string;
    const expiresIn = (data['expires_in'] ?? 3600) as number;
    this._cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
    return token;
  }
}

/** Map ANAF stare values to canonical TransmissionStatus. */
export function mapAnafStatus(stare: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
  const s = stare.toLowerCase();
  if (s === 'ok') return 'CLEARED';
  if (s === 'nok' || s.includes('erori') || s.includes('error')) return 'REJECTED';
  return 'PENDING'; // 'in prelucrare' = in processing
}
