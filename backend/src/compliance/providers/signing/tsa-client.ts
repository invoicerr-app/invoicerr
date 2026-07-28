/**
 * RFC 3161 Timestamp Authority (TSA) port + client implementations.
 *
 * TsaPort:       interface signing providers depend on — the only seam they touch.
 * NullTsaClient: offline-safe default (returns null; never calls the network).
 * HttpTsaClient: real RFC 3161 over HTTP/HTTPS (POST application/timestamp-query).
 *
 * Only SHA-256 (OID 2.16.840.1.101.3.4.2.1) is used as the message-imprint algorithm.
 *
 * Security rules:
 *  - TSA URL is NEVER logged (may contain embedded credentials).
 *  - All network errors degrade gracefully to null; callers continue at BES level.
 *  - Digest computation is done by the caller (sign providers); this module only packages.
 *
 * buildTsq / extractTokenFromTsr are exported for unit-test coverage.
 */

import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

/** SHA-256 OID per RFC 5758 */
export const SHA256_OID = '2.16.840.1.101.3.4.2.1';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/**
 * Port: request an RFC 3161 TimeStampToken over a pre-computed digest.
 * Returns the DER-encoded TimeStampToken (CMS ContentInfo wrapping TSTInfo),
 * or null when no TSA is configured or on any error.
 */
export interface TsaPort {
  /**
   * @param digest   Pre-computed hash bytes (SHA-256, 32 bytes).
   * @param algoOid  Hash algorithm OID (default: SHA-256).
   * @returns        DER-encoded TimeStampToken or null.
   */
  timestamp(digest: Buffer, algoOid?: string): Promise<Buffer | null>;
}

// ---------------------------------------------------------------------------
// NullTsaClient — the safe offline default
// ---------------------------------------------------------------------------

/**
 * Offline-safe default — never touches the network.
 * Signing providers use this when no TSA URL is configured,
 * producing BES-level output regardless of the requested signatureLevel.
 */
export class NullTsaClient implements TsaPort {
  async timestamp(_digest: Buffer, _algoOid?: string): Promise<null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HttpTsaClient — real RFC 3161 HTTP client
// ---------------------------------------------------------------------------

/**
 * Real RFC 3161 timestamp client.
 * Sends a TimeStampReq to the configured TSA URL and returns the TimeStampToken DER
 * extracted from the TimeStampResp.
 */
export class HttpTsaClient implements TsaPort {
  constructor(
    private readonly tsaUrl: string,
    private readonly timeoutMs: number = 10_000,
  ) {}

  async timestamp(digest: Buffer, algoOid: string = SHA256_OID): Promise<Buffer | null> {
    const tsqDer = buildTsq(digest, algoOid);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.tsaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/timestamp-query' },
        body: new Uint8Array(tsqDer),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const tsrBytes = Buffer.from(await response.arrayBuffer());
      return extractTokenFromTsr(tsrBytes);
    } catch {
      // Network errors, timeouts, and abort signals all degrade gracefully.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build a DER-encoded RFC 3161 TimeStampReq for the given digest.
 * certReq=true requests the TSA certificate to be embedded in the token.
 */
export function buildTsq(digest: Buffer, algoOid: string = SHA256_OID): Buffer {
  // Copy to a fresh ArrayBuffer — Buffer.buffer may be a SharedArrayBuffer on some runtimes.
  const digestAb = new Uint8Array(digest).buffer;

  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: algoOid }),
      hashedMessage: new asn1js.OctetString({ valueHex: digestAb }),
    }),
    certReq: true,
    nonce: buildNonce(),
  });

  return Buffer.from(req.toSchema().toBER(false));
}

/**
 * Extract the DER-encoded TimeStampToken from a raw TSR buffer.
 * Returns null if the TSR status is not "granted" (0) or "grantedWithMods" (1),
 * or if the DER cannot be parsed.
 */
export function extractTokenFromTsr(tsrBytes: Buffer): Buffer | null {
  // Copy to a fresh ArrayBuffer — Buffer.buffer may be a SharedArrayBuffer.
  const ab: ArrayBuffer = new Uint8Array(tsrBytes).buffer;
  const asn1 = asn1js.fromBER(ab);
  if (asn1.offset === -1) return null;

  let resp: pkijs.TimeStampResp;
  try {
    resp = new pkijs.TimeStampResp({ schema: asn1.result });
  } catch {
    return null;
  }

  // PKIStatus: 0 = granted, 1 = grantedWithMods
  const status = resp.status.status;
  if (status !== 0 && status !== 1) return null;
  if (!resp.timeStampToken) return null;

  return Buffer.from(resp.timeStampToken.toSchema().toBER(false));
}

function buildNonce(): asn1js.Integer {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return new asn1js.Integer({ valueHex: buf.buffer });
}
