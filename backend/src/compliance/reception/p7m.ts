/**
 * .p7m (CAdES-BES) de-enveloping — M-11.
 *
 * Italian passive (supplier) invoices are very commonly delivered as `.p7m`: a CMS/PKCS#7
 * SignedData DER structure (RFC 5652) whose encapsulated content (`eContent`) is the actual
 * FatturaPA XML. Without unwrapping, that DER envelope goes straight into the regex-based
 * `parseInboundDocument` as if it were XML → empty/garbage fields, no error surfaced.
 *
 * Pure module, no I/O, never throws — on anything it can't confidently unwrap it hands the raw
 * payload back unchanged so the existing parser can surface its own parseError, same as today.
 *
 * Uses `node-forge` (`forge.asn1` + `forge.pkcs7`), already a project dependency (see
 * modules/signing-certificates/signing-certificates.service.ts, compliance/providers/signing/providers.ts).
 *
 * Implementation note: forge's own `PkcsSignedData.content` extraction is unreliable for the
 * EXPLICIT-tagged `ContentInfo.content` inside a SignedData (its generic `_fromAsn1` content
 * reader treats the captured ASN.1 *node* as if it were already unwrapped bytes, producing an
 * empty buffer) — confirmed empirically against a real forge-generated SignedData round-trip.
 * We instead walk `p7.rawCapture.content` ourselves and collect the OCTET STRING bytes directly.
 */
import * as forge from 'node-forge';

export interface UnwrapP7mResult {
  xml: string;
  unwrapped: boolean;
}

/**
 * True when the payload already looks like XML (no envelope to remove). Strict — only the front
 * of the string is examined ('<' after trim). Used for the pre-unwrap passthrough check: a loose
 * whole-string substring scan for "FatturaElettronica" would false-positive on an actual CMS/p7m
 * envelope, since its DER bytes always embed that literal text (it's exactly what we're unwrapping
 * to reach) — just not at the front.
 */
function startsWithXmlTag(s: string): boolean {
  return s.trimStart().startsWith('<');
}

/**
 * Broader "does this look like XML" check, used only to sanity-check content we already extracted
 * from a successfully-parsed CMS envelope (a short string, not a raw DER blob) — safe to also
 * accept a "FatturaElettronica" substring there since false positives can't arise from unrelated
 * binary noise at that point.
 */
function looksLikeXml(s: string): boolean {
  return startsWithXmlTag(s) || s.includes('FatturaElettronica');
}

/**
 * Recursively collect the raw byte-string content of the primitive OCTET STRING node(s) under a
 * captured ASN.1 node. Handles both the common case (a single primitive OCTET STRING) and a
 * BER-fragmented / EXPLICIT-tag-wrapped constructed one — forge represents each ASN.1 node as
 * `{ constructed, value }` where `value` is either the raw byte string (primitive) or an array of
 * child nodes (constructed).
 */
function collectOctetStringBytes(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { constructed?: boolean; value?: unknown };
  if (Array.isArray(n.value)) {
    return n.value.map(collectOctetStringBytes).join('');
  }
  if (n.constructed === false && typeof n.value === 'string') {
    return n.value;
  }
  return typeof n.value === 'string' ? n.value : '';
}

/** Decode a base64 PEM body (`-----BEGIN PKCS7-----...-----END PKCS7-----`) to a binary string. */
function decodePemPkcs7(trimmed: string): string | null {
  const m = trimmed.match(/-----BEGIN PKCS7-----([\s\S]*?)-----END PKCS7-----/);
  if (!m) return null;
  try {
    return forge.util.decode64(m[1].replace(/\s+/g, ''));
  } catch {
    return null;
  }
}

/**
 * Unwrap a CAdES-BES (.p7m) CMS/PKCS#7 SignedData envelope and return its encapsulated FatturaPA
 * XML. Accepts a `Buffer` (byte-faithful), a PEM `-----BEGIN PKCS7-----` block, base64-of-DER, or
 * a string carrying latin1-encoded DER bytes (one JS char == one byte — the shape a caller gets
 * from `buffer.toString('latin1')` when byte fidelity must survive a `string`-typed call chain).
 *
 * Never throws: any failure to detect/parse a CMS envelope returns the original payload unchanged
 * with `unwrapped: false`, so the downstream structural parser can surface its own parseError.
 */
export function unwrapCadesP7m(raw: string | Buffer): UnwrapP7mResult {
  const isBuffer = Buffer.isBuffer(raw);
  const asUtf8 = isBuffer ? (raw as Buffer).toString('utf8') : (raw as string);

  if (startsWithXmlTag(asUtf8)) {
    return { xml: asUtf8, unwrapped: false };
  }

  try {
    let binary: string; // forge "binary" string: one char == one byte
    if (isBuffer) {
      binary = (raw as Buffer).toString('binary');
    } else {
      const s = raw as string;
      const trimmed = s.trimStart();
      if (/^-----BEGIN PKCS7-----/.test(trimmed)) {
        const pem = decodePemPkcs7(trimmed);
        if (pem === null) return { xml: asUtf8, unwrapped: false };
        binary = pem;
      } else if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s+/g, '').length > 32) {
        // Plausible base64 alphabet — decode and confirm it's a DER SEQUENCE before committing.
        let decoded: string;
        try {
          decoded = forge.util.decode64(trimmed.replace(/\s+/g, ''));
        } catch {
          return { xml: asUtf8, unwrapped: false };
        }
        binary = decoded.charCodeAt(0) === 0x30 ? decoded : s;
      } else {
        // Treat the string itself as a latin1-encoded byte sequence.
        binary = s;
      }
    }

    if (binary.charCodeAt(0) !== 0x30) {
      // Not a DER SEQUENCE (ASN.1 tag 0x30) — nothing to unwrap.
      return { xml: asUtf8, unwrapped: false };
    }

    const asn1obj = forge.asn1.fromDer(binary);
    const p7 = forge.pkcs7.messageFromAsn1(asn1obj) as unknown as {
      type?: string;
      rawCapture?: { content?: unknown };
    };
    if (p7.type !== forge.pki.oids.signedData) {
      return { xml: asUtf8, unwrapped: false };
    }

    const bytes = collectOctetStringBytes(p7.rawCapture?.content);
    if (!bytes) return { xml: asUtf8, unwrapped: false };

    const xml = Buffer.from(bytes, 'binary').toString('utf8');
    if (!looksLikeXml(xml)) return { xml: asUtf8, unwrapped: false };
    return { xml, unwrapped: true };
  } catch {
    return { xml: asUtf8, unwrapped: false };
  }
}
