/**
 * Mexico PAC (Proveedor Autorizado de Certificación) client — scaffold, live-deferred.
 *
 * Real integration requires:
 *   - CSD (Certificado de Sello Digital) issued by SAT for the Emisor RFC.
 *   - A SAT-authorized PAC (e.g. Finkok, SW Sapien, Facturapi, StampDE…).
 *   - The PAC verifies the CFDI, stamps the TimbreFiscalDigital (UUID + selloSAT),
 *     and registers the CFDI with SAT — all synchronously in a single call.
 *   - The stamped CFDI XML (with <cfdi:Complemento>) is returned for archival.
 *
 * Typical PAC REST endpoint pattern (SW Sapien style):
 *   Test:  https://services.test.sw.com.mx/cfdi33/stamp/v3/b64
 *   Prod:  https://services.sw.com.mx/cfdi33/stamp/v3/b64
 *
 * Note: every SAT-authorized PAC exposes a slightly different API (endpoint, auth, payload).
 * This client models the common denominator; the actual HTTP call is injected via PacHttpPort
 * so the concrete PAC adapter can be swapped without touching the transmission provider.
 *
 * LIVE PROOF: DEFERRED — SAT CSD certificate + PAC API credentials required.
 */

export type PacEnvironment = 'test' | 'prod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** TimbreFiscalDigital fields returned by a PAC timbrado call. */
export interface PacTimbreResponse {
  /** UUID (folio fiscal) — 36-char UUID assigned by SAT via the PAC. */
  uuid: string;
  /** Sello digital del emisor (base64). */
  selloCfd: string;
  /** Sello del SAT (base64). */
  selloSat: string;
  /** NoCertificadoSAT (20-char cert serial). */
  noCertificadoSat: string;
  /** Full stamped CFDI XML with <cfdi:Complemento><tfd:TimbreFiscalDigital> injected. */
  cfdiXmlStamped: string;
}

/** Response from a PAC status/consultation call. */
export interface PacConsultaResponse {
  uuid: string;
  status: 'vigente' | 'cancelado' | 'no_encontrado';
  /** SAT cancellation acknowledgement number (if cancelled). */
  acuse?: string;
}

// ---------------------------------------------------------------------------
// HTTP port — injectable for testing
// ---------------------------------------------------------------------------

export interface PacHttpPort {
  /**
   * POST CFDI XML (base64-encoded) to the PAC stamping endpoint.
   * Returns the TimbreFiscalDigital fields synchronously.
   */
  timbrar(
    baseUrl: string,
    cfdiXmlBase64: string,
    apiKey: string,
    rfc: string,
  ): Promise<PacTimbreResponse>;

  /**
   * Consult the SAT registration status of a stamped CFDI by UUID.
   * Used for poll() in async PAC environments.
   */
  consultaEstado(
    baseUrl: string,
    uuid: string,
    rfcEmisor: string,
    rfcReceptor: string,
    total: string,
    apiKey: string,
  ): Promise<PacConsultaResponse>;
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface PacClientConfig {
  environment: PacEnvironment;
  /** PAC API base URL (test or prod endpoint provided by the PAC). */
  baseUrl: string;
  /** PAC API key / token (provided by the PAC). */
  apiKey: string;
  /** RFC del Emisor (taxpayer RFC for the supplier). */
  rfc: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PacClient {
  constructor(
    private readonly http: PacHttpPort,
    private readonly config: PacClientConfig,
  ) {}

  /**
   * Timbrar (stamp) a CFDI XML document.
   *
   * The XML must be a valid CFDI 4.0 `<cfdi:Comprobante>` with an empty
   * `<cfdi:Complemento/>` placeholder; the PAC will inject the
   * `<tfd:TimbreFiscalDigital>` node with the UUID, selloSAT, etc.
   *
   * Note: the CFDI Sello/Certificado/NoCertificado fields in the Comprobante root
   * must be filled by the signing port (CSD-based XAdES/RSA-SHA256) BEFORE this call.
   * This client receives an unsigned or partially-signed CFDI in the scaffold; a real
   * integration would pass the fully-sealed CFDI.
   */
  async timbrar(cfdiXml: Buffer | string): Promise<PacTimbreResponse> {
    const xmlStr = typeof cfdiXml === 'string' ? cfdiXml : cfdiXml.toString('utf-8');
    const xmlBase64 = Buffer.from(xmlStr, 'utf-8').toString('base64');
    return this.http.timbrar(
      this.config.baseUrl,
      xmlBase64,
      this.config.apiKey,
      this.config.rfc,
    );
  }

  /**
   * Consult the SAT status of a previously stamped CFDI by UUID.
   * Returns 'vigente' (active), 'cancelado', or 'no_encontrado'.
   */
  async consultaEstado(
    uuid: string,
    rfcReceptor: string,
    total: string,
  ): Promise<PacConsultaResponse> {
    return this.http.consultaEstado(
      this.config.baseUrl,
      uuid,
      this.config.rfc,
      rfcReceptor,
      total,
      this.config.apiKey,
    );
  }

  static mapEstado(estado: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
    if (estado === 'vigente') return 'CLEARED';
    if (estado === 'cancelado') return 'REJECTED';
    if (estado === 'no_encontrado') return 'PENDING';
    return 'PENDING';
  }
}
