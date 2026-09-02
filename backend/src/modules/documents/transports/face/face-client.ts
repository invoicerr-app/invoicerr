/**
 * Spain — FACe (Punto General de Entrada de Facturas Electrónicas) SSPP SOAP web-service client.
 *
 * FACe is the AGE (Administración General del Estado) mandatory B2G invoice entry point named by
 * Ley 25/2013 (see `b2g-routing/data/es.json`'s own header for the article-level citation). This
 * file REPRISES `avant-refonte-documents`'s `compliance/providers/transmission/face-client.ts`
 * almost verbatim — the operation names, field shapes, estado code table and the "signing stays
 * deferred" contract are all UNCHANGED — with exactly two adaptations:
 *
 *  1. The request-envelope builders (`buildEnviarFacturaBody`/`buildConsultarFacturaBody`) now use
 *     `xmlbuilder2`'s object form, the SAME convention `transports/sdi/sdicoop-client.ts` already
 *     established for FACe's own sibling SOAP client (SdICoop) in THIS codebase — string
 *     concatenation with a hand-rolled `escapeXml` is gone; xmlbuilder2 escapes for us.
 *  2. `SigningLogger`/local imports are dropped — this file has no compliance-engine logger to lean
 *     on (that engine is gone, see `TODO.md`'s own header); callers (`face-transport.ts`) use the
 *     ordinary NestJS `logger` singleton instead, the same split every sibling transport draws.
 *
 * Everything else below — the endpoint hosts, the operation contract, the estado table, and the
 * "why this file stops short of a WS-Security signature" reasoning — is the repère's own content,
 * RE-VERIFIED on 2026-09-02 (this task), not merely copied forward:
 *
 *  - `FACE_ENDPOINTS` — RE-FETCHED today from the SAME source #1 the repère cites
 *    (github.com/josemmo/Facturae-PHP, `src/Face/FaceClient.php`, an actively maintained OSS client
 *    exercised against the REAL production endpoint): identical values to what the repère recorded —
 *    `https://webservice.face.gob.es/facturasspp2` (prod) / `https://se-face-webservice.redsara.es/
 *    facturasspp2` (sandbox). This is STRONGER evidence than the repère had (a live re-fetch on the
 *    date of this task, not a one-time historical read) — see this task's own report for what was
 *    also independently observed today: the HUMAN-FACING face.gob.es portal itself now redirects to
 *    a successor, `proveedores.face.gob.es` ("en este portal solo se pueden consultar facturas
 *    remitidas hasta el 27/02/2026") — a portal-only migration; nothing fetched today suggests the
 *    machine SSPP SOAP endpoints below moved, but this codebase has NOT independently exercised them
 *    live (no FACe-registered certificate — see `CREDENTIALS_GUIDE.md`'s own FACe section), so that
 *    absence-of-evidence is named, never treated as proof either way.
 *  - The estado code table (`FACE_TRAMITACION_ESTADOS`/`FACE_ANULACION_ESTADOS`) — REPRISED verbatim,
 *    not re-fetched this task (the Diputación Foral de Gipuzkoa PDF the repère cites was not
 *    re-read here); treated as still authoritative because nothing found today contradicts it.
 *  - The AdministrativeCentres RoleTypeCode ↔ DIR3-role mapping used by `formats/national/
 *    facturae-provider.ts` (órgano gestor/unidad tramitadora/oficina contable) is a DIFFERENT fact,
 *    NEWLY sourced this task from `github.com/josemmo/Facturae-PHP`, `src/FacturaeCentre.php`
 *    (`ROLE_GESTOR`/`ROLE_RECEPTOR = "02"`, `ROLE_TRAMITADOR`/`ROLE_PAGADOR = "03"`,
 *    `ROLE_CONTABLE`/`ROLE_FISCAL = "01"`), cross-checked against this repo's OWN vendored
 *    `formats/vendored/es/Facturaev3_2_2.xsd`'s `RoleTypeCodeType` documentation (01 Fiscal, 02
 *    Receptor, 03 Pagador) — two independent sources agreeing, the same corroboration discipline the
 *    repère's own header used. See that provider's own header for the citation, not repeated here.
 *
 * THE SOAP MESSAGE'S OWN WS-Security SIGNATURE — CLOSED, 2026-09-02 TASK (previously deferred,
 * unchanged from the repère until now): every SSPP request/response is authenticated by WS-Security
 * X.509 Token Profile 1.0/1.1 — a `<wsse:BinarySecurityToken>` plus a `<ds:Signature>` over (at
 * least) the `<soapenv:Body>` digest, NOT a plain bearer token and NOT (as far as either the repère or
 * this task could establish) mutual TLS. This client (`FaceHttpPort`'s own contract) still hands
 * `FaceSoapHttpPort`/`wsse-sign.ts` the RAW, unsigned operation fragment — the signing itself happens
 * one layer up, in `face-transport.ts`'s `FaceSoapHttpPort.post()`, the exact seam this interface's own
 * doc comment always described. What changed is that seam is now FILLED: `wsse-sign.ts` builds a real
 * WS-Security-signed envelope via `xmldsigjs` (OASIS X.509 Certificate Token Profile form — see that
 * file's own header for the citation), and this task LIVE-VERIFIED (2026-09-02, `se-face-webservice
 * .redsara.es`, a throwaway self-signed test certificate — no FACe-registered credential needed) that
 * doing so makes the sandbox's own SOAP Fault CHANGE NATURE: from `<faultstring>La petición no esta
 * firmada</faultstring>` (unsigned) to `<faultstring>Error al validar el certificado</faultstring>`
 * (signed, but with a certificate FACe does not recognize — see `face.live.spec.ts`'s own header for
 * the raw evidence both ways, and `wsse-sign.ts`'s own header for what is cited vs. extrapolated in
 * the signature's exact shape). Genuinely ACCEPTING a deposit still needs a real FNMT-issued,
 * FACe-registered certificate this checkout does not have (`CREDENTIALS_GUIDE.md` §20) — that gap is
 * real and named, but it is now the ONLY remaining one, not "nothing here signs anything at all". mTLS
 * remains `FaceSoapHttpPort`'s own separate, still-defensive-only concern (see that file's own
 * header), same as SdI's mTLS is `SdiHttpPort`'s (see `sdi-client.ts`).
 */
import { create } from 'xmlbuilder2';
import { DOMParser } from '@xmldom/xmldom';

// ---------------------------------------------------------------------------
// SOAP namespace / endpoints — see this file's own header for the 2026-09-02 re-verification.
// ---------------------------------------------------------------------------

export const FACE_NAMESPACE = 'https://webservice.face.gob.es';

export const FACE_ENDPOINTS = {
  prod: 'https://webservice.face.gob.es/facturasspp2',
  test: 'https://se-face-webservice.redsara.es/facturasspp2',
} as const;

export type FaceStatus = 'PENDING' | 'CLEARED' | 'REJECTED';

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
// enviarFactura — request / result
// ---------------------------------------------------------------------------

export interface FaceAnexo {
  contenidoBase64: string;
  nombre: string;
  mime: string;
}

export interface FaceEnviarFacturaRequest {
  /** 'correo' — notification email, mandatory per the SSPP contract. */
  correo: string;
  /** Base64-encoded (already XAdES-signed) Facturae XML. */
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
  /** THE reference — see face-transport.ts's own hard-success contract (mutation guard #2): an
   *  accepted enviarFactura with no usable numeroRegistro is a FAILURE, never a silent success. */
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
// Official estado code table — REPRISED verbatim from the repère (Diputación Foral de Gipuzkoa
// "Servicios para sistemas Automatizados de proveedores..." v1.0.3, §5 "Estados posibles"; NOT
// re-fetched by this task — see this file's own header).
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
 * Map a `tramitacion.codigo` to this repo's own tri-state transmission status vocabulary — REPRISED
 * verbatim from the repère's own reasoning (see that file's own header, not repeated here):
 *   1200/1300 → PENDING · 2400/2500 → CLEARED · 2600/3100 → REJECTED · unknown → PENDING.
 */
export function mapFaceEstado(codigo?: string): FaceStatus {
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
// XML building — xmlbuilder2's object form, the SAME convention `sdicoop-client.ts` (FACe's own
// sibling B2G SOAP client) already established in this codebase, replacing the repère's hand-rolled
// string concatenation + `escapeXml`.
// ---------------------------------------------------------------------------

function buildEnviarFacturaBody(req: FaceEnviarFacturaRequest): string {
  const anexos = (req.anexos ?? []).map((a) => ({
    anexo: a.contenidoBase64,
    nombre: a.nombre,
    mime: a.mime,
  }));
  const envelope = {
    'web:enviarFactura': {
      '@xmlns:web': FACE_NAMESPACE,
      request: {
        correo: req.correo,
        factura: {
          factura: req.facturaBase64,
          nombre: req.facturaNombre,
          mime: req.facturaMime ?? 'application/xml',
        },
        anexos: anexos.length > 0 ? { anexo: anexos } : {},
      },
    },
  };
  return create(envelope).end({ headless: true, prettyPrint: false });
}

function buildConsultarFacturaBody(numeroRegistro: string): string {
  const envelope = {
    'web:consultarFactura': {
      '@xmlns:web': FACE_NAMESPACE,
      numeroRegistro,
    },
  };
  return create(envelope).end({ headless: true, prettyPrint: false });
}

// ---------------------------------------------------------------------------
// Response parsing — REPRISED verbatim from the repère: direct-child lookups by localName
// (namespace-prefix agnostic), the same pattern `sdi/xml-helpers.ts` independently arrived at for
// SdI's own responses.
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
 * (soapenv:/soap:, ns1:/no prefix — all confirmed to vary across real FACe-compatible platforms, see
 * this file's own header). Throws a descriptive error on a SOAP Fault or malformed envelope.
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
// Client — thin orchestrator on top of FaceHttpPort (mirrors SdiCoopClient's own shape).
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

  /**
   * SSPP `enviarFactura` — submit a (XAdES-signed) Facturae invoice for registration.
   *
   * A non-2xx status is tried for a SOAP Fault FIRST, never treated as an opaque failure outright —
   * REAL, OBSERVED BEHAVIOUR (this task, 2026-09-02, `curl` AND `fetch` directly against
   * `https://se-face-webservice.redsara.es/facturasspp2`, an UNSIGNED request, `face.live.spec.ts`'s
   * own gated reachability test): the live sandbox answers with a real, informative
   * `<SOAP-ENV:Fault><faultcode>401</faultcode><faultstring>La petición no esta firmada</faultstring>`
   * — i.e. it is REACHABLE and DOES respond meaningfully, it just refuses an unsigned request
   * (confirming, live, this file's own header on why WS-Security signing stays deferred). REPEATED
   * calls observed the HTTP STATUS ITSELF flip between 200 and 500 for the IDENTICAL fault body —
   * genuinely flaky/inconsistent (a load-balanced backend, evidently), not a one-off fluke — which is
   * EXACTLY why this method never trusts the status code alone: discarding that faultstring behind a
   * bare "HTTP 500" (or worse, treating a 200 as automatic success without reading the body) would
   * throw away the exact information this codebase's ⚖ discipline exists to surface — the SAME
   * `status >= 500 → try to parse anyway` shape `sdicoop-client.ts#submit` already holds for the
   * identical reason.
   */
  async enviarFactura(req: FaceEnviarFacturaRequest): Promise<FaceEnviarFacturaResult> {
    const body = buildEnviarFacturaBody(req);
    const res = await this.http.post(this.config.endpoint, 'enviarFactura', body);
    if (res.status >= 400) {
      try {
        return parseEnviarFacturaResponse(res.data);
      } catch (err) {
        throw new Error(
          `FACe enviarFactura failed (HTTP ${res.status}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return parseEnviarFacturaResponse(res.data);
  }

  /** SSPP `consultarFactura` — query the tramitación/anulación estado for a numeroRegistro. Same
   *  "try to parse a SOAP Fault before giving up" discipline as `enviarFactura` above. */
  async consultarFactura(numeroRegistro: string): Promise<FaceConsultarFacturaResult> {
    const body = buildConsultarFacturaBody(numeroRegistro);
    const res = await this.http.post(this.config.endpoint, 'consultarFactura', body);
    if (res.status >= 400) {
      try {
        return parseConsultarFacturaResponse(res.data);
      } catch (err) {
        throw new Error(
          `FACe consultarFactura failed (HTTP ${res.status}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return parseConsultarFacturaResponse(res.data);
  }
}
