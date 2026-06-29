/**
 * Chile SII (Servicio de Impuestos Internos) DTE client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   - SII Firma Electrónica (digital certificate from SII-accredited CA).
 *   - Auth token: GET https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws (test)
 *     using a signed XML seed (FirmaXml(getSeedResponse) with your certificate).
 *   - Submit: POST /DTEWS/RecepcionMasivaDTE.jws (EnvioDTE XML).
 *   - Status: /DTEWS/QueryEstDteAv.jws.
 *
 * Endpoints (test / certificación):
 *   Base: https://maullin.sii.cl/DTEWS/
 * Endpoints (prod):
 *   Base: https://palena.sii.cl/DTEWS/
 *
 * LIVE PROOF: DEFERRED — SII-accredited digital certificate required.
 */

export type SiiEnvironment = 'cert' | 'prod';

const SII_BASE_URLS: Record<SiiEnvironment, string> = {
  cert: 'https://maullin.sii.cl/DTEWS',
  prod: 'https://palena.sii.cl/DTEWS',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiiToken {
  token: string;
  expiresAt?: string;
}

export interface SiiEnvioResponse {
  trackId: string;
  estado: string;
  glosa?: string;
}

export interface SiiEstadoResponse {
  estado: string;
  glosa?: string;
  detalle?: string;
}

// ---------------------------------------------------------------------------
// HTTP port
// ---------------------------------------------------------------------------

export interface SiiHttpPort {
  /** Fetch a seed from SII (GetSeedFromSII) — unauthenticated GET. */
  getSeed(baseUrl: string): Promise<string>;
  /** Exchange a signed seed XML for a token (GetTokenFromSeed). */
  getToken(baseUrl: string, firmadoXml: string): Promise<SiiToken>;
  /** Submit an EnvioDTE XML. */
  submitEnvioDTE(baseUrl: string, token: string, envioDteXml: Buffer, rutEnvia: string): Promise<SiiEnvioResponse>;
  /** Query DTE status by trackId. */
  queryEstado(baseUrl: string, token: string, rutEmisor: string, dvEmisor: string, trackId: string): Promise<SiiEstadoResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface SiiClientConfig {
  environment: SiiEnvironment;
  /** RUT of the company (without DV), digits only. */
  rut: string;
  /** DV (dígito verificador) of the RUT. */
  dv: string;
  /** PFX/PKCS#12 certificate (base64) for signing the seed. */
  certBase64?: string;
  certPassword?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SiiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: SiiHttpPort,
    private readonly config: SiiClientConfig,
  ) {
    this.baseUrl = SII_BASE_URLS[config.environment];
  }

  /** Authenticate: seed → sign → token. */
  async authenticate(): Promise<SiiToken> {
    const seed = await this.http.getSeed(this.baseUrl);
    // Real implementation: sign the seed XML with PKCS#12 cert.
    // Stub: pass the seed string directly (will fail on real SII).
    const firmadoXml = `<!-- TODO: sign seed '${seed}' with ${this.config.rut}-${this.config.dv} cert -->`;
    return this.http.getToken(this.baseUrl, firmadoXml);
  }

  /** Submit an EnvioDTE XML and return the trackId. */
  async submitDte(envioDteXml: Buffer): Promise<SiiEnvioResponse> {
    const token = await this.authenticate();
    return this.http.submitEnvioDTE(
      this.baseUrl,
      token.token,
      envioDteXml,
      `${this.config.rut}-${this.config.dv}`,
    );
  }

  /** Poll DTE processing status by trackId. */
  async queryEstado(trackId: string): Promise<SiiEstadoResponse> {
    const token = await this.authenticate();
    return this.http.queryEstado(
      this.baseUrl,
      token.token,
      this.config.rut,
      this.config.dv,
      trackId,
    );
  }

  static mapEstado(estado: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
    const e = estado.toUpperCase();
    if (['DOK', 'FOK', 'EPR'].includes(e)) return 'CLEARED'; // Accepted
    if (['RCH', 'RFR', 'RPR', 'RSC'].includes(e)) return 'REJECTED'; // Rejected
    return 'PENDING'; // SOK, PRD, CRT, unknown → pending
  }
}
