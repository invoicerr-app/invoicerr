/**
 * Ecuador SRI comprobante electrónico client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   - Digital certificate from SRI-accredited CA.
 *   - Two-phase flow: Recepción (upload) → Autorización (poll).
 *   - All documents signed with XAdES-BES using the SRI accredited certificate.
 *
 * Endpoints (test):
 *   Recepción:   https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline
 *   Autorización:https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantes
 * Endpoints (prod):
 *   Recepción:   https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline
 *   Autorización:https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantes
 *
 * LIVE PROOF: DEFERRED — SRI-accredited certificate required.
 */

export type SriEnvironment = 'test' | 'prod';

const SRI_URLS: Record<SriEnvironment, { recepcion: string; autorizacion: string }> = {
  test: {
    recepcion: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
    autorizacion: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantes',
  },
  prod: {
    recepcion: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
    autorizacion: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantes',
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SriRecepcionResponse {
  estado: 'RECIBIDA' | 'DEVUELTA';
  comprobantes?: Array<{ claveAcceso: string; mensajes?: Array<{ mensaje: string; tipo: string }> }>;
}

export interface SriAutorizacionResponse {
  claveAccesoConsultada: string;
  numeroComprobantes: number;
  autorizaciones: Array<{
    estado: 'AUTORIZADO' | 'NO AUTORIZADO';
    numeroAutorizacion?: string;
    fechaAutorizacion?: string;
    ambiente: string;
    comprobante: string;
    mensajes?: Array<{ mensaje: string; tipo: string; identificador?: string }>;
  }>;
}

// ---------------------------------------------------------------------------
// HTTP port
// ---------------------------------------------------------------------------

export interface SriHttpPort {
  /** POST signed XML to the Recepción SOAP endpoint. */
  recibirComprobante(url: string, signedXml: Buffer): Promise<SriRecepcionResponse>;
  /** GET autorizacion by claveAcceso (49-char access key). */
  autorizarComprobante(url: string, claveAcceso: string): Promise<SriAutorizacionResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface SriClientConfig {
  environment: SriEnvironment;
  /** RUC (13 chars) of the issuing company. */
  ruc: string;
  certBase64?: string;
  certPassword?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SriClient {
  private readonly urls: typeof SRI_URLS[SriEnvironment];

  constructor(
    private readonly http: SriHttpPort,
    private readonly config: SriClientConfig,
  ) {
    this.urls = SRI_URLS[config.environment];
  }

  /**
   * Phase 1: submit the signed comprobante XML.
   * Returns 'RECIBIDA' if accepted for processing, 'DEVUELTA' if rejected immediately.
   */
  async submitComprobante(signedXml: Buffer): Promise<SriRecepcionResponse> {
    return this.http.recibirComprobante(this.urls.recepcion, signedXml);
  }

  /**
   * Phase 2: poll for authorization by claveAcceso.
   * Returns AUTORIZADO (with numeroAutorizacion) or NO AUTORIZADO.
   */
  async pollAutorizacion(claveAcceso: string): Promise<SriAutorizacionResponse> {
    return this.http.autorizarComprobante(this.urls.autorizacion, claveAcceso);
  }

  static mapEstado(estado: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
    if (estado === 'AUTORIZADO') return 'CLEARED';
    if (estado === 'NO AUTORIZADO') return 'REJECTED';
    if (estado === 'DEVUELTA') return 'REJECTED'; // immediate rejection
    return 'PENDING'; // RECIBIDA → still processing
  }
}
