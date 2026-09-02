/**
 * WS-Security X.509 Certificate Token Profile signing for the FACe SOAP envelope — closes the
 * SECOND B2G hole named at `face-transport.ts`'s own header: `FaceSoapHttpPort` sent the envelope
 * UNSIGNED at the TRANSPORT layer even though the Facturae DOCUMENT it carries is already XAdES-signed
 * (a different, business-level signature — `formats/national/facturae-provider.ts`'s own header).
 * REAL, OBSERVED CONSEQUENCE (this task, 2026-09-02): the live sandbox
 * (`https://se-face-webservice.redsara.es/facturasspp2`) refuses an unsigned envelope with a genuine
 * SOAP Fault, `<faultcode>401</faultcode><faultstring>La petición no esta firmada</faultstring>` — see
 * `face.live.spec.ts`'s own header and this task's own report for the exact bytes, both before and
 * after this file existed.
 *
 * ## THE FORM — cited, not invented
 *
 * OASIS Web Services Security X.509 Certificate Token Profile (`docs.oasis-open.org`,
 * `oasis-200401-wss-x509-token-profile-1.0` / the 1.1 revision, `wss-x509TokenProfile-v1.1.1-os`),
 * §3.3.2's own worked example — fetched LIVE this task (2026-09-02,
 * `docs.oasis-open.org/wss-m/wss/v1.1.1/os/wss-x509TokenProfile-v1.1.1-os.html`), not from memory:
 *
 *  - `wsse:BinarySecurityToken` carries the DER certificate, base64-encoded, with
 *    `ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"`,
 *    `EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"`,
 *    and its OWN `wsu:Id` (so a `ds:Reference` can point back at it).
 *  - `ds:Signature`'s `SignedInfo` has a `ds:Reference URI="#<signed-element-id>"` — the OASIS example
 *    itself references the token; THIS file references the `soapenv:Body` instead (see "EXTRAPOLATED"
 *    below for why).
 *  - `ds:KeyInfo` carries a `wsse:SecurityTokenReference` / `wsse:Reference URI="#<binarytoken-id>"`
 *    pointing BACK at the `BinarySecurityToken` — the profile's own "token by reference" pattern,
 *    never the raw cert repeated a second time.
 *  - `wsse`/`wsu` namespace URIs are OASIS's own:
 *    `http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd` and
 *    `-utility-1.0.xsd` — UNCHANGED across the 1.0 → 1.1 token-profile revision.
 *
 * EXTRAPOLATED, named rather than silently assumed:
 *  - **Which element is referenced.** FACe's own SOAP shape (`face-client.ts`) carries no
 *    `wsu:Timestamp` (unlike some WS-Security deployments that sign Timestamp+Body together) — the
 *    only content that exists to sign here is the `soapenv:Body`, so that is the ONE `ds:Reference`
 *    this file emits. A real FACe deployment MAY expect more (Timestamp, or the whole Envelope) — not
 *    established either way; see this task's own report for what the live proof did and did not show.
 *  - **The signature/digest algorithm.** RSA-SHA256 / SHA-256
 *    (`http://www.w3.org/2001/04/xmldsig-more#rsa-sha256` / `http://www.w3.org/2001/04/xmlenc#sha256`)
 *    — matching this codebase's OWN existing XAdES/CAdES choice (`signing/providers.ts`'s `RSA_ALGO`),
 *    not an OASIS mandate: the Token Profile is algorithm-agnostic, and 2000s-era WS-Security
 *    deployments often used RSA-SHA1 — SHA-256 is today's unobjectionable default and this codebase
 *    never emits SHA-1 anywhere else, so reusing SHA-1 here "for authenticity" would be worse, not
 *    better.
 *  - **`soapenv:mustUnderstand="1"` on the `wsse:Security` header** — common SOAP security-header
 *    practice, NOT confirmed from the fetched X.509 Token Profile excerpt itself (that section is
 *    about the token/signature shape, not the SOAP header's own attributes). Included because it is
 *    harmless and near-universal; marked here as extrapolated, not cited.
 *  - **FACe's OWN integration manual** (administracionelectronica.gob.es/PAe/face) was NOT reachable
 *    this task — a WAF rejected the request outright ("Request Rejected", no document content). A
 *    cross-check attempt against `github.com/josemmo/Facturae-PHP` (a maintained OSS FACe client,
 *    already cited by `face-client.ts`'s own header for the endpoint hosts) found NO WS-Security
 *    signing code in its `Face/Traits/FaceTrait.php` — that client appears to authenticate by mTLS
 *    alone. This is named, not swept aside: it is either (a) evidence a real FACe deployment's
 *    requirement is mTLS-only and the sandbox's "no está firmada" fault tests something that client's
 *    callers configure differently, or (b) that client is simply untested against a live SSPP server
 *    itself. Genuinely unresolved — see this task's own report, not overclaimed here.
 *
 * ## WHY xmldsigjs, NOT hand-rolled crypto
 *
 * Canonicalization (`XmlDsigExcC14NTransform`, exported by `xmldsigjs`) and signing
 * (`crypto.subtle.sign`/`verify`, the SAME native WebCrypto engine `signing/providers.ts` already
 * uses) are BOTH library/platform primitives — nothing here reimplements C14N or RSA math. The XML
 * *structure* around them (the `wsse:Security` header itself) is hand-assembled the same way
 * `signing/providers.ts#applyTimestampXades` already hand-assembles XAdES's `UnsignedProperties`
 * around a library-computed timestamp token — the SAME division of labour this codebase already
 * establishes: libraries do the crypto, this file does XML shape.
 *
 * Parsing goes through `xmldsigjs`'s own re-exported `Parse()` (== `xml-core`'s `Parse`, which resolves
 * `@xmldom/xmldom`'s `DOMParser` via `getNodeDependency` — the SAME engine `providers.ts`'s
 * `ensureXmlCryptoEngine()` registers), NOT `@xmldom/xmldom` imported directly: `Parse()`'s own
 * `.d.ts` declares it returns the AMBIENT global `Document` (the SAME type `XmlDsigExcC14NTransform
 * .LoadInnerXml()`/`SignedXml` expect), whereas `@xmldom/xmldom`'s OWN `.d.ts` declares a
 * MODULE-SCOPED `Document`/`Element` (see `transports/face/face-client.ts`'s own `XmlElement` type
 * alias, built specifically to avoid naming that module-scoped type) — the SAME runtime object either
 * way, but only one of the two static types lines up with xmldsigjs's own APIs without a cast.
 *
 * `SignedXml.Sign()`'s OWN automatic by-Id reference resolution
 * (`xmldsigjs`'s `signed_xml.js#findAllById`) is DELIBERATELY NOT used here: it matches a reference
 * URI against an attribute by its EXACT qualified NAME — literally `"Id"`/`"ID"`/`"id"` — never a
 * namespaced `wsu:Id` (confirmed by reading `@xmldom/xmldom`'s own `Element#getAttributeNode`, which
 * looks up `this.attributes.getNamedItem(name)` — an exact `nodeName` match, so `"wsu:Id"` ≠ `"Id"`).
 * The X.509 Token Profile's OWN form (above) mandates `wsu:Id`, so this file computes the Body digest
 * and the `SignedInfo` signature ITSELF, calling `XmlDsigExcC14NTransform` directly on the
 * already-parsed `soapenv:Body` node — the SAME canonicalizer class `SignedXml.Sign()`'s own
 * `ApplyTransforms` would have used internally, just invoked one level down because the high-level API
 * cannot locate a namespaced Id attribute.
 *
 * This still produces byte-correct Exclusive C14N: `XmlCanonicalizer#WriteNamespacesAxis` (the
 * canonicalizer's own namespace-rendering pass) reads each node's OWN resolved `namespaceURI`/`prefix`
 * — properties the parser assigns once, at FULL-document parse time, and that `cloneNode`/detachment
 * never erases — rather than walking a LIVE `parentNode` chain. So even a `soapenv:Body` node examined
 * on its own (no ancestor `Envelope`/`xmlns:soapenv` attribute physically beside it) still renders the
 * correct `xmlns:soapenv="…"` declaration, exactly as a validator's own by-Id lookup within the full
 * transmitted document would when it independently canonicalizes the SAME referenced element.
 */
import { randomBytes } from 'node:crypto';

import { Parse as XmlParse, XmlDsigExcC14NTransform } from 'xmldsigjs';

import {
  ensureXmlCryptoEngine,
  importPrivateKeyPem,
  importPublicKeyFromCertDer,
  RSA_ALGO,
} from '../../signing/providers';

// ---------------------------------------------------------------------------
// Namespaces / algorithm URIs — see this file's own header for what is cited vs. extrapolated.
// ---------------------------------------------------------------------------

export const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
export const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
export const WSU_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
export const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
export const X509V3_VALUETYPE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3';
export const BASE64_ENCODINGTYPE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';
export const EXC_C14N_ALGO = 'http://www.w3.org/2001/10/xml-exc-c14n#';
export const RSA_SHA256_ALGO = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
export const SHA256_DIGEST_ALGO = 'http://www.w3.org/2001/04/xmlenc#sha256';

/** Credential material this file needs — a NARROWED view of
 *  `signing/signing-credentials-port.ts#SigningCredentialsMaterial` (only the two fields WS-Security
 *  XML-DSig actually uses; no PEM/PKCS12 convenience fields a SOAP-header signature has no use for). */
export interface WsseCertificate {
  /** X.509 certificate, DER (binary) — embedded as the `wsse:BinarySecurityToken`. */
  certDer: Buffer;
  /** PKCS#8 PEM private key — signs the `ds:SignedInfo` canonical bytes. */
  privateKeyPem: string;
}

export interface WsseSignResult {
  /** The full, signed SOAP envelope XML string — ready to POST as-is. */
  envelope: string;
  /** `wsu:Id` assigned to the signed `soapenv:Body` — exposed for tests, never needed by a caller. */
  bodyId: string;
  /** `wsu:Id` assigned to the `wsse:BinarySecurityToken` — exposed for tests. */
  tokenId: string;
}

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

/** Canonicalize one already-parsed DOM element with Exclusive C14N (no comments) — the SAME
 *  transform class `SignedXml.Sign()`'s own `ApplyTransforms` uses for an `'exc-c14n'` reference,
 *  called directly here (see this file's own header for why the high-level API cannot be used for a
 *  `wsu:Id`-referenced element). */
function canonicalize(element: Element): string {
  ensureXmlCryptoEngine();
  const transform = new XmlDsigExcC14NTransform();
  transform.LoadInnerXml(element);
  return transform.GetOutput();
}

async function sha256Base64(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Buffer.from(digest).toString('base64');
}

/** Build the UNSIGNED envelope — same shape `FaceSoapHttpPort.post()` sent before this task, kept
 *  here so both the signed and unsigned paths share ONE `soapenv:Envelope` skeleton (never two
 *  independently-typed templates that could silently drift). */
export function buildUnsignedEnvelope(bodyInner: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}">` +
    `<soapenv:Body>${bodyInner}</soapenv:Body>` +
    '</soapenv:Envelope>'
  );
}

/**
 * Build a WS-Security X.509 Token Profile-signed SOAP envelope around `bodyInner` (the already-built,
 * unsigned `<web:operation>…</web:operation>` fragment `face-client.ts`'s own builders produce).
 *
 * Steps (see this file's own header for the cited form and the library-primitives-only discipline):
 *  1. Assign the `soapenv:Body` a `wsu:Id`, parse the (Security-header-less) envelope, canonicalize
 *     the Body node (Exclusive C14N) and SHA-256 digest it.
 *  2. Hand-assemble `ds:SignedInfo` (one `ds:Reference` to the Body's `wsu:Id`), canonicalize IT the
 *     same way, and RSA-SHA256-sign the canonical bytes with the company's private key.
 *  3. Hand-assemble `wsse:Security` (`BinarySecurityToken` + `ds:Signature` + `KeyInfo`/
 *     `SecurityTokenReference`) and splice it into `soapenv:Header`.
 */
export async function signSoapEnvelope(bodyInner: string, cert: WsseCertificate): Promise<WsseSignResult> {
  ensureXmlCryptoEngine();
  const bodyId = randomId('Body');
  const tokenId = randomId('X509Token');

  // Step 1 — digest the Body. Parsed as part of the FULL envelope (not the Body fragment alone) so
  // the `soapenv` prefix resolves naturally from the Envelope's own `xmlns:soapenv` — irrelevant to
  // the CANONICAL bytes either way (see this file's own header on `namespaceURI`/`prefix` being
  // parser-assigned per node, not looked up live), but avoids an "unbound namespace prefix" parse
  // error from handing the parser a Body fragment in isolation.
  const bodyMarkup = `<soapenv:Body xmlns:wsu="${WSU_NS}" wsu:Id="${bodyId}">${bodyInner}</soapenv:Body>`;
  const digestDoc = XmlParse(
    '<?xml version="1.0" encoding="UTF-8"?>' +
      `<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}"><soapenv:Header/>${bodyMarkup}</soapenv:Envelope>`,
  );
  const bodyElement = digestDoc.getElementsByTagNameNS(SOAP_ENVELOPE_NS, 'Body')[0];
  if (!bodyElement) {
    throw new Error('WS-Security signing: could not locate the freshly-built soapenv:Body to digest');
  }
  const bodyDigestB64 = await sha256Base64(canonicalize(bodyElement));

  // Step 2 — SignedInfo: self-contained (its OWN xmlns:ds), so canonicalizing it standalone (not
  // nested inside the final envelope yet) produces the SAME bytes it will have once embedded — Exc
  // C14N only ever ADDS a namespace declaration that is not already visibly rendered; ds: is already
  // declared right here, so embedding this element deeper later changes nothing about its own output.
  const signedInfoXml =
    `<ds:SignedInfo xmlns:ds="${DS_NS}">` +
    `<ds:CanonicalizationMethod Algorithm="${EXC_C14N_ALGO}"/>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA256_ALGO}"/>` +
    `<ds:Reference URI="#${bodyId}">` +
    `<ds:Transforms><ds:Transform Algorithm="${EXC_C14N_ALGO}"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256_DIGEST_ALGO}"/>` +
    `<ds:DigestValue>${bodyDigestB64}</ds:DigestValue>` +
    '</ds:Reference>' +
    '</ds:SignedInfo>';
  const signedInfoDoc = XmlParse(signedInfoXml);
  const signedInfoEl = signedInfoDoc.documentElement;
  if (!signedInfoEl) {
    throw new Error('WS-Security signing: failed to build the SignedInfo element');
  }
  const signedInfoCanonical = canonicalize(signedInfoEl);

  const privateKey = await importPrivateKeyPem(cert.privateKeyPem);
  const signatureBytes = await crypto.subtle.sign(
    RSA_ALGO,
    privateKey,
    new TextEncoder().encode(signedInfoCanonical),
  );
  const signatureValueB64 = Buffer.from(signatureBytes).toString('base64');

  // Step 3 — BinarySecurityToken + Signature + KeyInfo/SecurityTokenReference, all per the OASIS form
  // cited in this file's own header.
  const certB64 = cert.certDer.toString('base64');
  const securityXml =
    `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}" soapenv:mustUnderstand="1">` +
    `<wsse:BinarySecurityToken wsu:Id="${tokenId}" ValueType="${X509V3_VALUETYPE}" ` +
    `EncodingType="${BASE64_ENCODINGTYPE}">${certB64}</wsse:BinarySecurityToken>` +
    `<ds:Signature xmlns:ds="${DS_NS}">${signedInfoXml}` +
    `<ds:SignatureValue>${signatureValueB64}</ds:SignatureValue>` +
    '<ds:KeyInfo><wsse:SecurityTokenReference>' +
    `<wsse:Reference URI="#${tokenId}" ValueType="${X509V3_VALUETYPE}"/>` +
    '</wsse:SecurityTokenReference></ds:KeyInfo>' +
    '</ds:Signature>' +
    '</wsse:Security>';

  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}">` +
    `<soapenv:Header>${securityXml}</soapenv:Header>` +
    bodyMarkup +
    '</soapenv:Envelope>';

  return { envelope, bodyId, tokenId };
}

// ---------------------------------------------------------------------------
// Local re-verification — used by wsse-sign.spec.ts (this task's own structure/mutation tests) and
// available to any future caller that wants to sanity-check a signed envelope offline. Independently
// re-derives the Body digest from the ACTUAL `soapenv:Body` element found in the document (never from
// whatever the `ds:Reference/@URI` merely CLAIMS to point at) — a signature that covers the wrong
// element, or a digest that was never recomputed, fails HERE, not just at a live server weeks later.
// ---------------------------------------------------------------------------

export interface WsseVerifyResult {
  /** The `ds:Reference/@URI` (with leading '#' stripped) found in the envelope. */
  referenceUri: string | undefined;
  /** The actual `wsu:Id` carried by the real `soapenv:Body` element. */
  bodyWsuId: string | undefined;
  /** Whether `referenceUri === bodyWsuId` — the Body is genuinely what the signature claims to cover. */
  referencesBody: boolean;
  /** Recomputed SHA-256/Exc-C14N digest of the ACTUAL Body element matches `ds:DigestValue`. */
  bodyDigestMatches: boolean;
  /** RSA-SHA256 signature over the recanonicalized `ds:SignedInfo` verifies against the public key
   *  extracted from the envelope's OWN `wsse:BinarySecurityToken`. */
  signatureValid: boolean;
}

export async function verifyWsseSignature(envelopeXml: string): Promise<WsseVerifyResult> {
  ensureXmlCryptoEngine();
  const doc = XmlParse(envelopeXml);

  const realBody = doc.getElementsByTagNameNS(SOAP_ENVELOPE_NS, 'Body')[0] as Element | undefined;
  const bodyWsuId = realBody?.getAttributeNS(WSU_NS, 'Id') ?? undefined;

  const reference = doc.getElementsByTagNameNS(DS_NS, 'Reference')[0] as Element | undefined;
  const referenceUriRaw = reference?.getAttribute('URI') ?? undefined;
  const referenceUri = referenceUriRaw?.startsWith('#') ? referenceUriRaw.slice(1) : referenceUriRaw;
  const referencesBody = !!referenceUri && !!bodyWsuId && referenceUri === bodyWsuId;

  const digestValueEl = doc.getElementsByTagNameNS(DS_NS, 'DigestValue')[0] as Element | undefined;
  const claimedDigest = digestValueEl?.textContent?.trim();
  const recomputedDigest = realBody ? await sha256Base64(canonicalize(realBody)) : undefined;
  const bodyDigestMatches = !!claimedDigest && claimedDigest === recomputedDigest;

  const signedInfoEl = doc.getElementsByTagNameNS(DS_NS, 'SignedInfo')[0] as Element | undefined;
  const signatureValueEl = doc.getElementsByTagNameNS(DS_NS, 'SignatureValue')[0] as Element | undefined;
  const tokenEl = doc.getElementsByTagNameNS(WSSE_NS, 'BinarySecurityToken')[0] as Element | undefined;
  let signatureValid = false;
  if (signedInfoEl && signatureValueEl && tokenEl) {
    const certDer = Buffer.from((tokenEl.textContent ?? '').trim(), 'base64');
    const publicKey = await importPublicKeyFromCertDer(certDer);
    const signatureBytes = Buffer.from((signatureValueEl.textContent ?? '').trim(), 'base64');
    const signedInfoCanonical = canonicalize(signedInfoEl);
    signatureValid = await crypto.subtle.verify(
      RSA_ALGO,
      publicKey,
      signatureBytes,
      new TextEncoder().encode(signedInfoCanonical),
    );
  }

  return { referenceUri, bodyWsuId, referencesBody, bodyDigestMatches, signatureValid };
}
