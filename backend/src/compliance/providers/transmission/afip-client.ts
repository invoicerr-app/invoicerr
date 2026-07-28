/**
 * Argentina AFIP/ARCA WSFE client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   1. AFIP WSAA (WS de Autenticación y Autorización): sign a LoginTicketRequest XML
 *      with your PKCS#12 certificate → returns TA (Ticket de Acceso) with Token+Sign.
 *   2. WSFE (WS de Factura Electrónica): submit a FECAESolicitar request with the
 *      comprobante data and TA credentials → AFIP returns CAE + vencimiento.
 *   3. Poll via FECompConsultarAsync or FECompConsultar to confirm.
 *
 * Endpoints (test):
 *   WSAA: https://wsaahomo.afip.gov.ar/ws/services/LoginCms
 *   WSFE: https://wswhomo.afip.gov.ar/wsfev1/service.asmx
 * Endpoints (prod):
 *   WSAA: https://wsaa.afip.gov.ar/ws/services/LoginCms
 *   WSFE: https://servicios1.afip.gov.ar/wsfev1/service.asmx
 *
 * No sandbox public credentials available — live proof deferred.
 */

export type AfipEnvironment = 'test' | 'prod';

const WSAA_URLS: Record<AfipEnvironment, string> = {
  test: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

const WSFE_URLS: Record<AfipEnvironment, string> = {
  test: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

// ---------------------------------------------------------------------------
// Types (aligned to AFIP WSFE v1 SOAP spec)
// ---------------------------------------------------------------------------

export interface AfipTicketAcceso {
  token: string;
  sign: string;
  expirationTime: string;
}

export interface AfipCaeRequest {
  /** CUIT of the issuing company, digits only. */
  cuit: string;
  /** Point of sale (Punto de Venta), 1-9999. */
  puntoVenta: number;
  /** Invoice type code: 1=Factura A, 6=Factura B, 11=Factura C, etc. */
  tipoComprobante: number;
  /** Sequential number of the comprobante. */
  numero: number;
  /** Issue date YYYYMMDD. */
  fechaComprobante: string;
  /** Net amount excluding taxes. */
  importeGravado: number;
  /** Tax amount. */
  importeIva: number;
  /** Total amount. */
  importeTotal: number;
  /** CUIT of the buyer (or '0' for B2C). */
  cuitReceptor: string;
  /** IVA rates applied: array of {id (5=10.5%, 4=21%, 6=27%), baseImponible, importe}. */
  ivaItems: Array<{ id: number; baseImponible: number; importe: number }>;
}

export interface AfipCaeResponse {
  /** CAE (Código de Autorización Electrónico) — the invoice authorization code. */
  cae: string;
  /** CAE expiration date YYYYMMDD. */
  vencimientoCAE: string;
  /** Full invoice key (CUIT + tipoCBTE + ptoVta + nroDoc). */
  cbteDesde: number;
  cbteHasta: number;
  resultado: 'A' | 'R' | 'P'; // A=Aprobado, R=Rechazado, P=Parcial
  observaciones?: Array<{ code: number; msg: string }>;
  errores?: Array<{ code: number; msg: string }>;
}

export interface AfipStatusResponse {
  appServer: string;
  authServer: string;
  dbServer: string;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface AfipHttpPort {
  /**
   * POST a SOAP LoginCms envelope to WSAA and return the parsed TA.
   * Production: signs a CMS LoginTicketRequest XML with the PKCS#12 key.
   */
  authenticate(wsaaUrl: string, cmsSignedXml: string): Promise<AfipTicketAcceso>;
  /**
   * POST a FECAESolicitar SOAP envelope to WSFE and return the parsed response.
   */
  fecaeSolicitar(wsfeUrl: string, ta: AfipTicketAcceso, request: AfipCaeRequest): Promise<AfipCaeResponse>;
  /**
   * GET WSFE server status (FEDummy).
   */
  serverStatus(wsfeUrl: string): Promise<AfipStatusResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface AfipClientConfig {
  environment: AfipEnvironment;
  /** CUIT (tax ID) of the company, digits only, e.g. '30712345679'. */
  cuit: string;
  /**
   * PKCS#12 certificate (base64) + password — used by the real WSAA flow to
   * sign the LoginTicketRequest CMS. No certificate = auth will fail gracefully.
   * TODO: wire to SigningCredentialsPort / encrypted company certs.
   */
  certBase64?: string;
  certPassword?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AfipClient {
  private readonly wsaaUrl: string;
  private readonly wsfeUrl: string;

  constructor(
    private readonly http: AfipHttpPort,
    private readonly config: AfipClientConfig,
  ) {
    this.wsaaUrl = WSAA_URLS[config.environment];
    this.wsfeUrl = WSFE_URLS[config.environment];
  }

  /**
   * Authenticate via WSAA — sign a LoginTicketRequest CMS and exchange for a TA.
   *
   * LIVE PROOF: DEFERRED — real PKCS#12 certificate + AFIP CUIT required.
   * The mock HTTP port is used in tests.
   */
  async authenticate(): Promise<AfipTicketAcceso> {
    // In production: build the LoginTicketRequest XML, sign with PKCS#12 (CMS),
    // and POST to WSAA. The response contains Token+Sign (TA valid for 12h).
    const cmsSignedXml = `<!-- TODO: real WSAA CMS LoginTicketRequest signed with ${this.config.cuit} cert -->`;
    return this.http.authenticate(this.wsaaUrl, cmsSignedXml);
  }

  /**
   * Request a CAE (Código de Autorización Electrónico) from WSFE.
   *
   * LIVE PROOF: DEFERRED — requires valid TA + CUIT + AFIP registration.
   */
  async requestCae(ta: AfipTicketAcceso, request: AfipCaeRequest): Promise<AfipCaeResponse> {
    return this.http.fecaeSolicitar(this.wsfeUrl, ta, request);
  }

  /**
   * Check WSFE server status (FEDummy — unauthenticated health check).
   */
  async serverStatus(): Promise<AfipStatusResponse> {
    return this.http.serverStatus(this.wsfeUrl);
  }

  /**
   * Full submission flow: authenticate → requestCae → return CAE.
   * Returns the CAE string on success, or throws on auth/AFIP error.
   */
  async submitComprobante(request: AfipCaeRequest): Promise<AfipCaeResponse> {
    const ta = await this.authenticate();
    return this.requestCae(ta, request);
  }
}
