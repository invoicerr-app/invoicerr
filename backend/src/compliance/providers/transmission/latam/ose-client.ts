/**
 * Peru OSE (Operador de Servicios Electrónicos) client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   - Digital certificate from SUNAT-accredited CA (DigiCert / COSAPI DATA, etc.).
 *   - Two-phase flow: enviarComprobante() → pollCdr() for the CDR (Constancia de Recepción).
 *   - XML signed with XAdES-BES using the company's accredited certificate.
 *   - The OSE validates the document against SUNAT rules and issues a CDR (zip with XML).
 *
 * Typical OSE REST endpoint pattern:
 *   Test: https://ose-homologacion.example.pe/ose/api/v1/invoices
 *   Prod: https://ose.example.pe/ose/api/v1/invoices
 *
 * Note: each OSE (e.g. Nubefact, Facturalo.pe, Efact, Perú Factura Electrónica) exposes
 * slightly different endpoints. The port (`OseHttpPort`) lets the concrete OSE adapter
 * be swapped without touching the transmission provider.
 *
 * CDR (Constancia de Recepción): a ZIP archive containing an XML from the OSE/SUNAT
 * confirming acceptance (`0` → aceptado) or rejection (error codes).
 *
 * LIVE PROOF: DEFERRED — SUNAT-accredited digital certificate + OSE credentials required.
 */

export type OseEnvironment = 'test' | 'prod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** OSE document type codes (tipoDoc) per SUNAT table 10. */
export type OseTipoDoc =
  | '01' // Factura (invoice)
  | '03' // Boleta de venta (receipt B2C)
  | '07' // Nota de crédito
  | '08'; // Nota de débito

export interface OseSubmitResponse {
  /**
   * Número de ticket / tracking ref from the OSE for CDR polling.
   * Some OSEs return the CDR synchronously; others issue a ticket for async polling.
   */
  ticket?: string;
  /** CDR zip bytes (if the OSE returns synchronously). */
  cdrZip?: Buffer;
  /**
   * SUNAT response code from the CDR:
   *   '0' → aceptado (accepted)
   *   '1xxx' → aceptado con observaciones
   *   '2xxx' → rechazado (rejected)
   */
  codigoRespuesta?: string;
  descripcion?: string;
  estado: 'ACEPTADO' | 'RECHAZADO' | 'EN_PROCESO';
}

export interface OseCdrResponse {
  /** CDR zip bytes. */
  cdrZip: Buffer;
  /** SUNAT response code ('0' = aceptado). */
  codigoRespuesta: string;
  descripcion: string;
  estado: 'ACEPTADO' | 'RECHAZADO' | 'PENDIENTE';
  /** Structured error/warning list from the CDR XML. */
  detalles?: Array<{ codigo: string; descripcion: string; tipoError?: string }>;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface OseHttpPort {
  /**
   * POST a signed comprobante ZIP (containing the XML) to the OSE.
   * Some OSEs accept a raw XML; others expect a ZIP matching the SUNAT filename convention.
   * Returns a ticket for async CDR polling, or the CDR immediately.
   */
  enviarComprobante(
    baseUrl: string,
    ruc: string,
    tipoDoc: OseTipoDoc,
    serie: string,
    correlativo: string,
    xmlZip: Buffer,
    apiKey: string,
  ): Promise<OseSubmitResponse>;

  /**
   * Poll the OSE for the CDR by ticket number.
   * Returns the CDR zip bytes and SUNAT response code once available.
   */
  obtenerCdr(
    baseUrl: string,
    ruc: string,
    tipoDoc: OseTipoDoc,
    serie: string,
    correlativo: string,
    apiKey: string,
    ticket?: string,
  ): Promise<OseCdrResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface OseClientConfig {
  environment: OseEnvironment;
  /** OSE API base URL (test or prod endpoint provided by the OSE operator). */
  baseUrl: string;
  /** OSE API key / token. */
  apiKey: string;
  /** RUC del emisor (11-digit Peruvian taxpayer ID). */
  ruc: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OseClient {
  constructor(
    private readonly http: OseHttpPort,
    private readonly config: OseClientConfig,
  ) {}

  /**
   * Submit a signed comprobante to the OSE.
   *
   * The xmlZip must follow the SUNAT filename convention:
   *   {RUC}-{tipoDoc}-{serie}-{correlativo}.zip
   *
   * Returns a ticket for async CDR polling, or the CDR directly if the OSE is sync.
   */
  async enviarComprobante(
    tipoDoc: OseTipoDoc,
    serie: string,
    correlativo: string,
    xmlZip: Buffer,
  ): Promise<OseSubmitResponse> {
    return this.http.enviarComprobante(
      this.config.baseUrl,
      this.config.ruc,
      tipoDoc,
      serie,
      correlativo,
      xmlZip,
      this.config.apiKey,
    );
  }

  /**
   * Poll the OSE for the CDR (Constancia de Recepción) by ticket.
   * Returns ACEPTADO / RECHAZADO / PENDIENTE + CDR zip bytes.
   */
  async obtenerCdr(
    tipoDoc: OseTipoDoc,
    serie: string,
    correlativo: string,
    ticket?: string,
  ): Promise<OseCdrResponse> {
    return this.http.obtenerCdr(
      this.config.baseUrl,
      this.config.ruc,
      tipoDoc,
      serie,
      correlativo,
      this.config.apiKey,
      ticket,
    );
  }

  static mapEstado(estado: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
    if (estado === 'ACEPTADO') return 'CLEARED';
    if (estado === 'RECHAZADO') return 'REJECTED';
    return 'PENDING'; // EN_PROCESO, PENDIENTE
  }

  static mapCodigo(codigoRespuesta: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
    const code = parseInt(codigoRespuesta, 10);
    if (code === 0) return 'CLEARED'; // aceptado
    if (code >= 100 && code < 2000) return 'CLEARED'; // observaciones — still accepted
    if (code >= 2000) return 'REJECTED'; // rechazado
    return 'PENDING';
  }
}
