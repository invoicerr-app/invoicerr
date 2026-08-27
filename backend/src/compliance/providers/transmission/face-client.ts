/**
 * Spain — FACe (Punto General de Entrada de Facturas Electrónicas) SSPP web-service client.
 *
 * FACe is the AGE (Administración General del Estado) mandatory B2G invoice entry point
 * (Ley 25/2013). Its machine interface is the "Servicios web SSPP" SOAP web service — this file
 * models that contract, verified against multiple independent sources (no single official gob.es
 * page could be fetched directly — administracionelectronica.gob.es rejects automated requests —
 * so the contract below is corroborated across THREE independent sources that all agree on the
 * same operation names, field shapes and namespace):
 *
 *  1. josemmo/Facturae-PHP (github.com/josemmo/Facturae-PHP, src/Face/{FaceClient,SoapClient,
 *     Traits/FaceTrait}.php) — an actively maintained OSS client used against the REAL production
 *     endpoint. Confirms: endpoint hosts, operation names/bodies, WS-Security signing algorithm.
 *  2. Diputación Foral de Bizkaia "Servicios para sistemas automatizados de proveedores" (BFA/DFB,
 *     PGEFe — a regional entry point that implements the same FACe SSPP WSDL contract). Confirms:
 *     operation request/response XML shapes, tramitación/anulación two-track status model.
 *  3. Diputación Foral de Gipuzkoa "Servicios para sistemas Automatizados de proveedores para su
 *     integración con el P.G.E.F.e" v1.0.3 (2024-07-09) — same WSDL contract. Confirms the exact
 *     numeric estado code table used below (§5 "Estados posibles") and the error code catalogue.
 *
 * Endpoints (confirmed by josemmo/Facturae-PHP, src/Face/FaceClient.php `getEndpointUrl()`):
 *   Production: https://webservice.face.gob.es/facturasspp2
 *   Sandbox:    https://se-face-webservice.redsara.es/facturasspp2
 *   SOAP namespace: https://webservice.face.gob.es
 *   WSDL (v1, discovered but not the exact endpoint used above): https://webservice.face.gob.es/sspp?wsdl
 *
 * Operations relevant to transmit()/poll() (SOAP body under the `web:` namespace):
 *   enviarFactura(request: {correo, factura:{factura(base64), nombre, mime}, anexos[]})
 *     → {resultado:{codigo,descripcion,codigoSeguimiento}, factura:{numeroRegistro,organoGestor,
 *        unidadTramitadora,oficinaContable,identificadorEmisor,numeroFactura,serieFactura,
 *        fechaRecepcion}}
 *   consultarFactura(numeroRegistro)
 *     → {resultado:{...}, factura:{numeroRegistro,tramitacion:{codigo,descripcion,motivo},
 *        anulacion:{codigo,descripcion,motivo}}}
 *   (anularFactura, consultarEstados, consultarUnidades, consultarAdministraciones also exist on
 *   the real WSDL — out of scope here; transmit()/poll() only need enviarFactura/consultarFactura.)
 *
 * `resultado.codigo === '0'` means the call succeeded; any other value is an application-level
 * error code (see the Gipuzkoa manual §6.2 for the catalogue — e.g. '303' = "no existe factura
 * con el número de registro especificado", '033' = "certificado de firma caducado").
 *
 * Authentication / transport security — WS-Security X.509 Token Profile 1.0 (OASIS), NOT mutual
 * TLS: every request and response is signed with a `<wsse:BinarySecurityToken>` carrying the
 * caller's X.509 certificate plus a `<ds:Signature>` computed over the `<wsu:Timestamp>` and
 * `<soapenv:Body>` digests (SignedInfo has exactly those two <ds:Reference> entries — this is a
 * WS-Security-wrapped signature, not an enveloped signature of the whole document). The
 * reference josemmo/Facturae-PHP implementation (SoapClient.php, actively exercised against the
 * real production endpoint) signs with:
 *   - CanonicalizationMethod: http://www.w3.org/2001/10/xml-exc-c14n#        (Exclusive C14N)
 *   - SignatureMethod:        http://www.w3.org/2001/04/xmldsig-more#rsa-sha512
 *   - DigestMethod:           http://www.w3.org/2001/04/xmlenc#sha512
 * (Some older regional-platform manuals — e.g. the Gipuzkoa PGEFe doc's 2016 worked example —
 * show RSA-SHA1/SHA1 instead; algorithms may vary by platform/vintage. The SHA-512 variant above
 * is treated as authoritative here because it is exercised against the live face.gob.es endpoint
 * by an actively maintained client, not a static example in a PDF.)
 *
 * WHY THIS FILE STOPS SHORT OF SIGNING: computing a WS-Security XML-DSig signature that a live
 * SSPP server will actually ACCEPT requires validating the exact canonicalization + digest
 * bytes against that live server — something that cannot be done offline/unattended. Rather than
 * hand-roll unverified crypto (COMPLIANCE_AUDIT.md F-6's exact mistake — a shape nobody has
 * checked against reality), the signing step is pushed into {@link FaceHttpPort}, which a real
 * deployment implements once a FACe-registered certificate is available — mirroring how
 * `SdiHttpPort` defers SdI's mTLS + PFX certificate for the exact same reason. Everything else in
 * this file (operation bodies, field names, response parsing, estado→status mapping) is real,
 * verified, and unit-tested against literal example XML lifted from the sources above.
 */
import { DOMParser } from '@xmldom/xmldom';
import { TransmissionStatus } from '../../execution/types';

// ---------------------------------------------------------------------------
// SOAP namespace / endpoints
// ---------------------------------------------------------------------------

export const FACE_NAMESPACE = 'https://webservice.face.gob.es';

export const FACE_ENDPOINTS = {
  prod: 'https://webservice.face.gob.es/facturasspp2',
  test: 'https://se-face-webservice.redsara.es/facturasspp2',
} as const;

// ---------------------------------------------------------------------------
// Port — swappable transport. A real implementation wraps `body` in a WS-Security-signed
// soap:Envelope (see file header) and POSTs it; tests inject a mock.
// ---------------------------------------------------------------------------

export interface FaceHttpPort {
  /**
   * Send one FACe SSPP SOAP operation.
   * @param endpoint  Resolved prod/sandbox base URL (already includes /facturasspp2).
   * @param operation Operation name, e.g. 'enviarFactura' — used to build the SOAPAction header
   *                  (`https://webservice.face.gob.es#<operation>`) in a real implementation.
   * @param body      The already-built, UNSIGNED `<web:operation>...</web:operation>` fragment.
   *                  A real implementation wraps this in a full soap:Envelope with a
   *                  WS-Security-signed soap:Header before sending (see file header).
   * @returns HTTP status + the raw SOAP response XML as a string.
   */
  post(endpoint: string, operation: string, body: string): Promise<{ status: number; data: string }>;
}

// ---------------------------------------------------------------------------
// enviarFactura (RegistrarFactura equivalent) — request / result
// ---------------------------------------------------------------------------

export interface FaceAnexo {
  contenidoBase64: string;
  nombre: string;
  mime: string;
}

export interface FaceEnviarFacturaRequest {
  /** 'correo' — notification email, mandatory per the SSPP contract. */
  correo: string;
  /** Base64-encoded Facturae XML (or .xsig if pre-signed as a whole). */
  facturaBase64: string;
  facturaNombre: string;
  /** Mandatory MIME type per the SSPP contract — always 'application/xml'. */
  facturaMime?: string;
  anexos?: FaceAnexo[];
}

export interface FaceEnviarFacturaResult {
  /** resultado.codigo — '0' means success; anything else is an SSPP application error code. */
  codigo: string;
  descripcion: string;
  codigoSeguimiento?: string;
  numeroRegistro?: string;
  organoGestor?: string;
  unidadTramitadora?: string;
  oficinaContable?: string;
  identificadorEmisor?: string;
  numeroFactura?: string;
  serieFactura?: string;
  fechaRecepcion?: string;
}

// ---------------------------------------------------------------------------
// consultarFactura — request / result
// ---------------------------------------------------------------------------

export interface FaceEstadoInfo {
  codigo: string;
  descripcion: string;
  motivo?: string;
}

export interface FaceConsultarFacturaResult {
  codigo: string;
  descripcion: string;
  numeroRegistro?: string;
  /** Ordinary processing lifecycle (Registrada → Contabilizada/Rechazada → Pagada/Anulada). */
  tramitacion?: FaceEstadoInfo;
  /** Cancellation-request lifecycle, independent of `tramitacion` (§5.2 estado table). */
  anulacion?: FaceEstadoInfo;
}

// ---------------------------------------------------------------------------
// Official estado code table (verified — Diputación Foral de Gipuzkoa PGEFe manual v1.0.3,
// §5 "Estados posibles"; cross-checked against independent web sources for 2600/3100).
// ---------------------------------------------------------------------------

/** §5.1 — Estados de tramitación (ordinary processing lifecycle). */
export const FACE_TRAMITACION_ESTADOS: Record<string, string> = {
  '1200': 'Registrada — la factura ha sido registrada en el registro electrónico REC',
  '1300': 'Registrada en RCF — la factura ha sido registrada en el Registro Contable de Facturas',
  '2400': 'Contabilizada — la factura ha sido reconocida con obligación de pago',
  '2500': 'Pagada — factura pagada',
  '2600': 'Rechazada — la unidad rechaza la factura',
  '3100': 'Anulada — la unidad aprueba la propuesta de anulación',
};

/** §5.2 — Estados de anulación (cancellation-request lifecycle, independent track). */
export const FACE_ANULACION_ESTADOS: Record<string, string> = {
  '4100': 'No solicitada anulación',
  '4200': 'Solicitada anulación',
  '4300': 'Aceptada anulación',
  '4400': 'Rechazada anulación',
};

/**
 * Map a `tramitacion.codigo` to the repo's TransmissionStatus vocabulary.
 *
 * 1200/1300 (Registrada / Registrada en RCF) — still being processed by the AAPP → PENDING.
 * 2400/2500 (Contabilizada / Pagada) — the invoice has been accepted for payment and can no
 *   longer be rejected at this stage → CLEARED (mirrors ChorusPro's MANDATEE/COMPTABILISEE →
 *   CLEARED: "accounted" is treated as the terminal delivery-success state, same rationale).
 * 2600 (Rechazada) — the receiving unit rejected the invoice → REJECTED.
 * 3100 (Anulada) — a cancellation request was approved; the invoice is void → REJECTED (it is no
 *   longer a valid delivered invoice, even though the cancellation itself was "successful" from
 *   the supplier's point of view — this mirrors how a CREDIT_NOTE-cancelled document is not
 *   itself "cleared").
 * Unknown/missing code → PENDING (never guess a terminal state for an unrecognised code).
 */
export function mapFaceEstado(codigo?: string): TransmissionStatus {
  switch (codigo) {
    case '1200':
    case '1300':
      return 'PENDING';
    case '2400':
    case '2500':
      return 'CLEARED';
    case '2600':
    case '3100':
      return 'REJECTED';
    default:
      return 'PENDING';
  }
}

// ---------------------------------------------------------------------------
// XML building (real, verified field names/nesting — see file header for sources)
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildEnviarFacturaBody(req: FaceEnviarFacturaRequest): string {
  const anexosXml = (req.anexos ?? [])
    .map(
      (a) =>
        `<anexo><anexo>${a.contenidoBase64}</anexo><nombre>${escapeXml(a.nombre)}</nombre>` +
        `<mime>${escapeXml(a.mime)}</mime></anexo>`,
    )
    .join('');
  return (
    `<web:enviarFactura xmlns:web="${FACE_NAMESPACE}"><request>` +
    `<correo>${escapeXml(req.correo)}</correo>` +
    `<factura><factura>${req.facturaBase64}</factura>` +
    `<nombre>${escapeXml(req.facturaNombre)}</nombre>` +
    `<mime>${escapeXml(req.facturaMime ?? 'application/xml')}</mime></factura>` +
    `<anexos>${anexosXml}</anexos>` +
    `</request></web:enviarFactura>`
  );
}

function buildConsultarFacturaBody(numeroRegistro: string): string {
  return (
    `<web:consultarFactura xmlns:web="${FACE_NAMESPACE}">` +
    `<numeroRegistro>${escapeXml(numeroRegistro)}</numeroRegistro>` +
    `</web:consultarFactura>`
  );
}

// ---------------------------------------------------------------------------
// XML parsing — direct-child lookups by localName (namespace-prefix agnostic), matching the
// pattern already used in peppol-sh-client.ts's ublToPeppolShDocument().
// ---------------------------------------------------------------------------

type XmlElement = ReturnType<DOMParser['parseFromString']>['documentElement'];

function childrenByLocalName(el: XmlElement | null, localName: string): XmlElement[] {
  const out: XmlElement[] = [];
  const nodes = el?.childNodes;
  if (!nodes) return out;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i) as XmlElement | null;
    if (n && n.nodeType === 1 && n.localName === localName) out.push(n);
  }
  return out;
}

function child(el: XmlElement | null, localName: string): XmlElement | null {
  return childrenByLocalName(el, localName)[0] ?? null;
}

function firstElementChild(el: XmlElement | null): XmlElement | null {
  const nodes = el?.childNodes;
  if (!nodes) return null;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i) as XmlElement | null;
    if (n && n.nodeType === 1) return n;
  }
  return null;
}

function childText(el: XmlElement | null, localName: string): string | undefined {
  const c = child(el, localName);
  const text = c?.textContent?.trim();
  return text ? text : undefined;
}

/**
 * Navigate Envelope → Body → {operation}Response → return, tolerant of namespace prefixes
 * (soapenv:/soap:, ns1:/no prefix — all confirmed to vary across real FACe-compatible platforms
 * in the sources above). Throws a descriptive error on a SOAP Fault or malformed envelope.
 */
function parseReturnElement(xml: string): XmlElement {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const envelope = doc.documentElement;
  if (!envelope) throw new Error('FACe SSPP response: could not parse SOAP envelope');
  const body = child(envelope, 'Body');
  if (!body) throw new Error('FACe SSPP response: missing soap:Body');
  const opResponse = firstElementChild(body);
  if (!opResponse) throw new Error('FACe SSPP response: empty soap:Body');
  if (opResponse.localName === 'Fault') {
    const faultString =
      childText(opResponse, 'faultstring') ?? childText(opResponse, 'Reason') ?? 'unknown SOAP fault';
    throw new Error(`FACe SSPP SOAP fault: ${faultString}`);
  }
  const ret = child(opResponse, 'return');
  if (!ret) throw new Error('FACe SSPP response: missing <return> element');
  return ret;
}

function parseEstadoInfo(el: XmlElement | null): FaceEstadoInfo | undefined {
  if (!el) return undefined;
  const codigo = childText(el, 'codigo');
  if (!codigo) return undefined;
  return { codigo, descripcion: childText(el, 'descripcion') ?? '', motivo: childText(el, 'motivo') };
}

function parseEnviarFacturaResponse(xml: string): FaceEnviarFacturaResult {
  const ret = parseReturnElement(xml);
  const resultado = child(ret, 'resultado');
  const factura = child(ret, 'factura');
  return {
    codigo: childText(resultado, 'codigo') ?? '999',
    descripcion: childText(resultado, 'descripcion') ?? '',
    codigoSeguimiento: childText(resultado, 'codigoSeguimiento'),
    numeroRegistro: childText(factura, 'numeroRegistro'),
    organoGestor: childText(factura, 'organoGestor'),
    unidadTramitadora: childText(factura, 'unidadTramitadora'),
    oficinaContable: childText(factura, 'oficinaContable'),
    identificadorEmisor: childText(factura, 'identificadorEmisor'),
    numeroFactura: childText(factura, 'numeroFactura'),
    serieFactura: childText(factura, 'serieFactura'),
    fechaRecepcion: childText(factura, 'fechaRecepcion'),
  };
}

function parseConsultarFacturaResponse(xml: string): FaceConsultarFacturaResult {
  const ret = parseReturnElement(xml);
  const resultado = child(ret, 'resultado');
  const factura = child(ret, 'factura');
  return {
    codigo: childText(resultado, 'codigo') ?? '999',
    descripcion: childText(resultado, 'descripcion') ?? '',
    numeroRegistro: childText(factura, 'numeroRegistro'),
    tramitacion: parseEstadoInfo(child(factura, 'tramitacion')),
    anulacion: parseEstadoInfo(child(factura, 'anulacion')),
  };
}

// ---------------------------------------------------------------------------
// Client — thin orchestrator on top of FaceHttpPort (mirrors SdiClient/ChorusProClient shape)
// ---------------------------------------------------------------------------

export interface FaceClientConfig {
  /** Resolved prod/sandbox endpoint (see FACE_ENDPOINTS). */
  endpoint: string;
}

export class FaceClient {
  constructor(
    private readonly config: FaceClientConfig,
    private readonly http: FaceHttpPort,
  ) {}

  /** SSPP `enviarFactura` — submit a Facturae invoice for registration. */
  async enviarFactura(req: FaceEnviarFacturaRequest): Promise<FaceEnviarFacturaResult> {
    const body = buildEnviarFacturaBody(req);
    const res = await this.http.post(this.config.endpoint, 'enviarFactura', body);
    if (res.status >= 400) {
      throw new Error(`FACe enviarFactura failed (HTTP ${res.status})`);
    }
    return parseEnviarFacturaResponse(res.data);
  }

  /** SSPP `consultarFactura` — query the tramitación/anulación estado for a numeroRegistro. */
  async consultarFactura(numeroRegistro: string): Promise<FaceConsultarFacturaResult> {
    const body = buildConsultarFacturaBody(numeroRegistro);
    const res = await this.http.post(this.config.endpoint, 'consultarFactura', body);
    if (res.status >= 400) {
      throw new Error(`FACe consultarFactura failed (HTTP ${res.status})`);
    }
    return parseConsultarFacturaResponse(res.data);
  }
}
