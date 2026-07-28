/**
 * Uruguay DGI CFE (Comprobante Fiscal Electrónico) client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   - Digital certificate from DGI-accredited CA (ABITAB, SeamlessDocs, etc.).
 *   - WS DGI CFE: SOAP/HTTPS mutual TLS.
 *   - Two-phase flow: enviarCfe (submit signed CFE XML) → obtenerRespuesta (poll).
 *   - CAE (Constancia de Autorización Electrónica) assigned by DGI upon acceptance.
 *
 * Endpoints:
 *   Test: https://efactura.dgi.gub.uy:6443/dte/ws/dte_ws
 *   Prod: https://efactura.dgi.gub.uy/dte/ws/dte_ws
 *
 * LIVE PROOF: DEFERRED — DGI-accredited certificate required.
 */

export type UyDgiEnvironment = 'test' | 'prod';

const UY_DGI_URLS: Record<UyDgiEnvironment, string> = {
  test: 'https://efactura.dgi.gub.uy:6443/dte/ws/dte_ws',
  prod: 'https://efactura.dgi.gub.uy/dte/ws/dte_ws',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UyDgiEnvioResponse {
  /** Unique transmission identifier returned by DGI for polling. */
  idEnvio: string;
  estado: 'RECIBIDO' | 'ERROR';
  errorMsg?: string;
}

export interface UyDgiRespuesta {
  idEnvio: string;
  estado: 'ACEPTADO' | 'RECHAZADO' | 'EN_PROCESO';
  cae?: string;
  caeFechaVto?: string;
  rechazos?: Array<{ codigo: string; descripcion: string }>;
}

// ---------------------------------------------------------------------------
// HTTP port
// ---------------------------------------------------------------------------

export interface UyDgiHttpPort {
  /** POST enviarCfe SOAP envelope — submit signed CFE XML. */
  enviarCfe(url: string, signedCfeXml: Buffer, rutEmisor: string): Promise<UyDgiEnvioResponse>;
  /** POST obtenerRespuesta SOAP — poll by idEnvio. */
  obtenerRespuesta(url: string, idEnvio: string, rutEmisor: string): Promise<UyDgiRespuesta>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface UyDgiClientConfig {
  environment: UyDgiEnvironment;
  /** RUT of the issuing company (11-12 digits). */
  rut: string;
  certBase64?: string;
  certPassword?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class UyDgiClient {
  private readonly wsUrl: string;

  constructor(
    private readonly http: UyDgiHttpPort,
    private readonly config: UyDgiClientConfig,
  ) {
    this.wsUrl = UY_DGI_URLS[config.environment];
  }

  /**
   * Submit a signed CFE XML.
   * Returns idEnvio for polling.
   */
  async enviarCfe(signedCfeXml: Buffer): Promise<UyDgiEnvioResponse> {
    return this.http.enviarCfe(this.wsUrl, signedCfeXml, this.config.rut);
  }

  /**
   * Poll for DGI response.
   * Returns CAE on acceptance or rejection details.
   */
  async obtenerRespuesta(idEnvio: string): Promise<UyDgiRespuesta> {
    return this.http.obtenerRespuesta(this.wsUrl, idEnvio, this.config.rut);
  }

  static mapEstado(estado: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
    if (estado === 'ACEPTADO') return 'CLEARED';
    if (estado === 'RECHAZADO') return 'REJECTED';
    if (estado === 'ERROR') return 'REJECTED';
    return 'PENDING'; // EN_PROCESO, RECIBIDO
  }
}
