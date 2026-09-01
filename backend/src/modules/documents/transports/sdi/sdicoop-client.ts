/**
 * The REAL SdICoop SOAP client — `SdIRiceviFile.RiceviFile`, the operation a trasmittente calls to
 * submit a FatturaPA (or archive) file to the Sistema di Interscambio. Explicit user decision (this
 * task's own brief): build the real client NOW, gated on AdE (Agenzia delle Entrate) intermediary
 * accreditation being complete, rather than waiting for accreditation to exist first — status
 * **implemented-awaiting-accreditation**: this file is never run against the true AdE endpoint until
 * that accreditation lands (see `sdicoop.live.spec.ts`'s own header, and `CREDENTIALS_GUIDE.md` §4
 * for the accreditation procedure itself, re-verified 2026-09-01). The first real collaudo submission
 * MAY reveal envelope discrepancies this file could not anticipate — every fact below is either READ
 * from a cited source or EXPLICITLY marked as an inference, never silently invented.
 *
 * ## What was actually READ (fetched 2026-09-01, `curl`/WebFetch against fatturapa.gov.it)
 *
 *  - `SdIRiceviFile_v1.0.wsdl` — https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/SdIRiceviFile_v1.0.wsdl
 *  - `TrasmissioneTypes_v1.0.xsd` — https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/TrasmissioneTypes_v1.0.xsd
 *  - `TrasmissioneTypes_v1.1.xsd` — https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/TrasmissioneTypes_v1.1.xsd
 *  - "Istruzioni per il servizio SDICoop - Trasmissione", v3.3 —
 *    https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v3.x/Istruzioni-per-il-servizio-SDICoop-Trasmissione-versione3.3.pdf
 *    (§1.3/§1.3.1 "IL WEB-SERVICE SDIRICEVIFILE" / "OPERAZIONE RICEVIFILE")
 *
 * From those: the `RiceviFile` request's root element is `fileSdIAccoglienza` (namespace
 * `http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types`), carrying exactly `NomeFile`
 * (`nomeFile_Type`, pattern `[a-zA-Z0-9_\.]{9,50}` — enforced below, `NOMEFILE_PATTERN`) and `File`
 * (`base64Binary`, the invoice/archive bytes). The response root is `rispostaSdIRiceviFile`, carrying
 * `IdentificativoSdI` (`identificativoSdI_Type`, a 12-digit integer — THE reference: "the request
 * accepted with no usable IdentificativoSdI" is never a success, the same hard-success contract every
 * transport in this directory enforces), `DataOraRicezione` (dateTime), and an OPTIONAL `Errore`
 * (`erroreInvio_Type`, exactly three enumerated values, meanings transcribed VERBATIM from the XSD's
 * own `xsd:documentation` / the instructions PDF §1.3.1's own parameter table — `SDI_ERRORE_MEANINGS`
 * below): EI01 = file allegato vuoto, EI02 = servizio momentaneamente non disponibile, EI03 = utente
 * non abilitato. The binding (`soapbind:binding style="document"`, `SdIRiceviFile_v1.0.wsdl`) is
 * SOAP 1.1; the operation's SOAPAction is `http://www.fatturapa.it/SdIRiceviFile/RiceviFile`
 * (`soapbind:operation` in the same WSDL).
 *
 * ## What was NOT read, and is therefore extrapolated (marked, never silent)
 *
 *  - The literal HTTPS endpoint URL. Both `SdIRiceviFile_v1.0.wsdl`'s own `soapbind:address`
 *    (`http://servizi.fatturapa.it/ricevi_file`) and the instructions PDF's own prose ("Tale servizio
 *    viene esposto sulla base di endpoint che vengono comunicati in fase di accreditamento") show
 *    this is a PLACEHOLDER, not a fixed public constant the way KSeF's `BASE_URLS` is — the real
 *    SdIRiceviFile URL (collaudo vs produzione) is assigned per intermediary at accreditation time.
 *    So, deliberately, NOTHING is hardcoded here: `endpoint` is a required field on the "sdi" channel
 *    config (`sdi-transport.ts#SdiCredentials`), sourced from whatever AdE's Sistema di Accreditamento
 *    actually hands the accredited intermediary — never guessed.
 *  - The exact SOAP-Fault shape a real server error would take, and whether a non-2xx HTTP status is
 *    ever actually used for a business-level `Errore` (vs. always HTTP 200 with `<Errore>` populated)
 *    — the read PDF shows only the message CONTENT, never a captured wire-level example. This client
 *    handles BOTH shapes defensively (a real `<soap:Fault>`, wherever it appears in the body,
 *    regardless of HTTP status; a business `<Errore>` inside a 200 `rispostaSdIRiceviFile`) rather
 *    than assuming one.
 *  - mTLS specifics (SOAPAction header quoting, TLS version) — not specified in either PDF; the
 *    standard SOAP 1.1/HTTP convention (quoted SOAPAction, `text/xml; charset=utf-8`) is used, same as
 *    `TrasmissioneFatture_v1.1.wsdl`'s sibling operations. The client certificate mechanics themselves
 *    (PKCS#12 + password → `https.request`'s native `pfx`/`passphrase`) come from
 *    `CREDENTIALS_GUIDE.md` §4 ("AdE's own PKI issuing an X.509 client cert for mutual-TLS
 *    authentication against the SDICoop web-service endpoint"), re-verified 2026-09-01.
 *
 * `getStatus`/`sendEsito` (the rest of `SdiHttpPort`) are NOT part of what a trasmittente's
 * `SdIRiceviFile` web-service exposes — there is no polling operation in what was read (matches
 * `conformity/authority-status-poller.ts`'s own header: SdI notifiche are PUSHED, never polled), and
 * `SdIRiceviNotifica`/`RicezioneFatture` (the OTHER pair of web-services published alongside these,
 * also read from the same page) are the RECEPTION direction — for when we are the BUYER submitting an
 * esito committente, a different feature this task does not build. Both throw a named,
 * honest "not part of this client" error rather than pretending either exists here.
 */
import * as https from 'node:https';
import { URL } from 'node:url';

import { create } from 'xmlbuilder2';

import { SdiHttpPort, SdiStatusResult, SdiSubmitRequest, SdiSubmitResult } from './sdi-client';
import { firstByLocalName, parseXml, textOf } from './xml-helpers';

// ---------------------------------------------------------------------------
// Constants read from the spec (see this file's own header for sources)
// ---------------------------------------------------------------------------

const TRASMISSIONE_TYPES_NS = 'http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types';
const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
export const RICEVI_FILE_SOAP_ACTION = 'http://www.fatturapa.it/SdIRiceviFile/RiceviFile';

/** `nomeFile_Type` (`TrasmissioneTypes_v1.0.xsd`/`v1.1.xsd`, identical in both) — read verbatim. */
export const NOMEFILE_PATTERN = /^[a-zA-Z0-9_.]{9,50}$/;

/** `erroreInvio_Type` enumeration — meanings transcribed verbatim from the XSD's own
 *  `xsd:documentation` (confirmed against the instructions PDF §1.3.1's own parameter table). */
export const SDI_ERRORE_MEANINGS: Record<string, string> = {
  EI01: 'file allegato vuoto (empty attached file)',
  EI02: 'servizio momentaneamente non disponibile (service temporarily unavailable)',
  EI03: 'utente non abilitato (user not authorized)',
};

/** A named SdICoop error — always carries a `code` a caller can branch on without parsing the
 *  message string, the same discipline `ksef-client.ts#KsefError` already holds for its own API. */
export interface SdiCoopError extends Error {
  code: 'EI01' | 'EI02' | 'EI03' | 'SOAP_FAULT' | 'MALFORMED_RESPONSE' | 'HTTP_ERROR' | 'TRANSPORT_ERROR';
}

function sdiCoopError(code: SdiCoopError['code'], message: string): SdiCoopError {
  return Object.assign(new Error(message), { code }) as SdiCoopError;
}

// ---------------------------------------------------------------------------
// Envelope construction — pure, exported for direct unit testing.
// ---------------------------------------------------------------------------

/**
 * Builds the `RiceviFile` request SOAP envelope. `nomeFile` is validated against the EXACT pattern
 * the XSD declares (`NOMEFILE_PATTERN`) BEFORE anything is sent — a filename SdI would reject anyway
 * fails here, named, rather than as an opaque remote rejection.
 */
export function buildRiceviFileEnvelope(nomeFile: string, fileBase64: string): string {
  if (!NOMEFILE_PATTERN.test(nomeFile)) {
    throw sdiCoopError(
      'MALFORMED_RESPONSE',
      `SdI NomeFile "${nomeFile}" does not match the required pattern [a-zA-Z0-9_.]{9,50} ` +
        '(TrasmissioneTypes_v1.0.xsd, nomeFile_Type) — refusing to submit a file SdI would reject anyway.',
    );
  }

  // xmlbuilder2's object form (the same convention `formats/national/fa3-provider.ts` already uses
  // for FA(2)/FA(3)) — `@xmlns:*` keys become namespace declarations, exactly as read from the WSDL:
  // `soapenv` for the SOAP 1.1 envelope, `tns` for the request's own `types` namespace.
  const envelope = {
    'soapenv:Envelope': {
      '@xmlns:soapenv': SOAP_ENVELOPE_NS,
      '@xmlns:tns': TRASMISSIONE_TYPES_NS,
      'soapenv:Body': {
        'tns:fileSdIAccoglienza': {
          'tns:NomeFile': nomeFile,
          'tns:File': fileBase64,
        },
      },
    },
  };

  return create(envelope).end({ prettyPrint: false });
}

// ---------------------------------------------------------------------------
// Response parsing — pure, exported for direct unit testing. `firstByLocalName`/`textOf`/`parseXml`
// come from `xml-helpers.ts`, shared with `sdi-notifiche.ts`'s own (inbound) parsing.
// ---------------------------------------------------------------------------

function parseSoapXml(xml: string) {
  const { doc, errors } = parseXml(xml);
  if (errors.length > 0) {
    throw sdiCoopError('MALFORMED_RESPONSE', `SdI response is not well-formed XML: ${errors.join('; ')}`);
  }
  return doc;
}

/**
 * Parses a `RiceviFile` SOAP response body into a `SdiSubmitResult`. Three distinct failure shapes,
 * every one NAMED (`SdiCoopError.code`), never a silent success:
 *  1. A `soap:Fault` anywhere in the body (regardless of HTTP status — see this file's own header on
 *     why status alone is not trusted) → `code: 'SOAP_FAULT'`.
 *  2. A business `<Errore>` inside `rispostaSdIRiceviFile` (EI01/EI02/EI03, meanings from
 *     `SDI_ERRORE_MEANINGS`) → `code` set to the error code itself.
 *  3. Neither a Fault nor an Errore, YET NO `IdentificativoSdI` either — a response this client
 *     cannot make sense of. THE hard-success contract every transport in this directory enforces:
 *     "accepted with no usable reference" is a FAILURE, never tolerated as a soft/empty success —
 *     enforced HERE, at the client, not left for a caller to remember to re-check.
 */
export function parseRiceviFileResponse(
  xml: string,
  request: Pick<SdiSubmitRequest, 'idTrasmittente' | 'filename'>,
): SdiSubmitResult {
  const doc = parseSoapXml(xml);

  const fault = firstByLocalName(doc, 'Fault');
  if (fault) {
    const faultString =
      textOf(firstByLocalName(fault, 'faultstring')) ??
      textOf(firstByLocalName(doc, 'faultstring')) ??
      'no faultstring in the SOAP Fault';
    throw sdiCoopError('SOAP_FAULT', `SdI returned a SOAP Fault: ${faultString}`);
  }

  // `rispostaSdIRiceviFile` is the response's own root per the read XSD — not captured separately:
  // `IdentificativoSdI`/`Errore` are searched for directly below (namespace-agnostic, see
  // `xml-helpers.ts`), which finds them equally well whether or not this root wrapper is present —
  // a defensive stance given no captured wire example confirms the exact response envelope shape.
  const errore = textOf(firstByLocalName(doc, 'Errore'));
  if (errore) {
    const meaning = SDI_ERRORE_MEANINGS[errore] ?? 'unknown error code — not one of EI01/EI02/EI03';
    const code: SdiCoopError['code'] =
      errore === 'EI01' || errore === 'EI02' || errore === 'EI03' ? errore : 'MALFORMED_RESPONSE';
    throw sdiCoopError(code, `SdI rejected the submission: ${errore} — ${meaning}`);
  }

  const identificativoSdI = textOf(firstByLocalName(doc, 'IdentificativoSdI'));
  const idSdI = identificativoSdI ? Number(identificativoSdI) : NaN;
  if (!identificativoSdI || !Number.isFinite(idSdI) || idSdI <= 0) {
    // MUTATION TARGET #1 (this task's own brief): removing this check would let a response with no
    // usable IdentificativoSdI parse into a "successful" result — never acceptable, see this
    // function's own header point 3.
    throw sdiCoopError(
      'MALFORMED_RESPONSE',
      'SdI response carries neither a usable IdentificativoSdI nor an <Errore> — ' +
        `treating this as a failed submission, never a silent success (raw: ${xml.slice(0, 500)}).`,
    );
  }

  return {
    idSdI,
    idTrasmittente: request.idTrasmittente,
    filename: request.filename,
  };
}

// ---------------------------------------------------------------------------
// HTTPS transport — node:https, native pfx/passphrase mTLS (no SOAP library, per this task's rule).
// ---------------------------------------------------------------------------

export interface SdiCoopClientConfig {
  /** The `SdIRiceviFile` HTTPS endpoint for this trasmittente — assigned during AdE accreditation,
   *  collaudo or produzione depending on which "sdi" channel environment this came from
   *  (`channels.service.ts`'s own TEST/PROD). Never a hardcoded default — see this file's own header
   *  on why no such constant exists. */
  endpoint: string;
  /** Pin a specific CA (PEM) instead of Node's system trust store. Real AdE traffic needs none of
   *  this (its server certificate chains to a publicly trusted CA) — this exists so a test double
   *  (a local mTLS stub, self-signed) can be trusted without weakening `rejectUnauthorized`. */
  ca?: string | Buffer;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function postSoap(
  config: SdiCoopClientConfig,
  soapAction: string,
  body: string,
  mtls: { pfx?: Buffer; passphrase?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(config.endpoint);
    } catch (err) {
      reject(sdiCoopError('TRANSPORT_ERROR', `SdI endpoint is not a valid URL: ${(err as Error).message}`));
      return;
    }

    // The ENTIRE request lifecycle is wrapped in one try/catch: Node parses `pfx`/`passphrase` into a
    // TLS secure context SYNCHRONOUSLY, as part of `https.request()`/`req.end()` themselves — a wrong
    // passphrase or a corrupt PFX throws SYNCHRONOUSLY (e.g. "mac verify failure"), it does NOT wait
    // for an async 'error' event the way a network-level failure (DNS/connection refused) does. Both
    // shapes end up as the SAME named `TRANSPORT_ERROR` rejection either way — the caller never has to
    // know which of the two actually happened.
    try {
      const payload = Buffer.from(body, 'utf-8');
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: `${url.pathname}${url.search}` || '/',
          method: 'POST',
          pfx: mtls.pfx,
          passphrase: mtls.passphrase,
          ca: config.ca,
          timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Content-Length': payload.length,
            SOAPAction: `"${soapAction}"`,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
          });
          res.on('error', (err) =>
            reject(sdiCoopError('TRANSPORT_ERROR', `SdI response stream error: ${err.message}`)),
          );
        },
      );

      req.on('timeout', () => {
        req.destroy(
          sdiCoopError(
            'TRANSPORT_ERROR',
            `SdI request timed out after ${config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
          ),
        );
      });
      // The ASYNC half of the same "network or TLS handshake failed" case (e.g. connection refused,
      // or a handshake failure Node reports post-construction rather than synchronously).
      req.on('error', (err) => {
        reject(sdiCoopError('TRANSPORT_ERROR', `SdI SOAP request failed: ${err.message}`));
      });

      req.write(payload);
      req.end();
    } catch (err) {
      reject(sdiCoopError('TRANSPORT_ERROR', `SdI SOAP request failed: ${(err as Error).message}`));
    }
  });
}

/**
 * The REAL `SdiHttpPort` — see this file's own header for what is proven-from-spec vs extrapolated,
 * and for why `getStatus`/`sendEsito` are honest non-implementations rather than invented ones.
 */
export class SdiCoopClient implements SdiHttpPort {
  constructor(private readonly config: SdiCoopClientConfig) {}

  async submit(request: SdiSubmitRequest): Promise<SdiSubmitResult> {
    const nomeFile = request.filename;
    const fileBase64 = request.xmlBytes.toString('base64');
    const envelope = buildRiceviFileEnvelope(nomeFile, fileBase64);

    const pfx = request.certificate ? Buffer.from(request.certificate, 'base64') : undefined;
    const { status, body } = await postSoap(this.config, RICEVI_FILE_SOAP_ACTION, envelope, {
      pfx,
      passphrase: request.certificatePassword,
    });

    if (status >= 500) {
      // A 5xx with no parseable Fault/Errore inside is still a named, honest failure — never
      // swallowed into a bare "request failed".
      try {
        return parseRiceviFileResponse(body, request);
      } catch (err) {
        if (err instanceof Error && (err as SdiCoopError).code) throw err;
        throw sdiCoopError('HTTP_ERROR', `SdI returned HTTP ${status}: ${body.slice(0, 500)}`);
      }
    }
    if (status !== 200) {
      throw sdiCoopError(
        'HTTP_ERROR',
        `SdI returned unexpected HTTP status ${status}: ${body.slice(0, 500)}`,
      );
    }
    return parseRiceviFileResponse(body, request);
  }

  /** SdICoop's trasmittente-side `SdIRiceviFile` service exposes NO polling operation — SdI PUSHES
   *  the RC/NS/MC/NE/DT/AT notifiche instead (see `sdi-notifiche.controller.ts`, and
   *  `conformity/authority-status-poller.ts`'s own header on why "sdi" registers no poller). Honest,
   *  named non-implementation — never an invented endpoint. Parameters kept (matching `SdiHttpPort`)
   *  even though unused, so a caller going through the CONCRETE class (never just the interface — see
   *  this file's own test) still calls it the same way it would any other `SdiHttpPort`. */
  async getStatus(_idSdI: number, _idTrasmittente: string): Promise<SdiStatusResult> {
    throw sdiCoopError(
      'TRANSPORT_ERROR',
      'SDICoop (trasmittente) has no polling operation in what was read from the published WSDL — ' +
        'notifiche are PUSHED to sdi-notifiche.controller.ts instead. See this file’s own header.',
    );
  }

  /** `NotificaEsito` on `SdIRiceviNotifica` is a RECEPTION-side operation (we would be the BUYER
   *  submitting an esito committente) — a different feature this task does not build. Honest, named
   *  non-implementation, never an invented call against a service this client was never asked to
   *  implement. */
  async sendEsito(
    _idSdI: number,
    _idTrasmittente: string,
    _esito: 'EC01' | 'EC02',
    _descrizione?: string,
  ): Promise<void> {
    throw sdiCoopError(
      'TRANSPORT_ERROR',
      'sendEsito (SdIRiceviNotifica.NotificaEsito) is a RECEPTION-side operation, out of scope for a ' +
        'trasmittente client sending its own invoices — see this file’s own header.',
    );
  }
}
