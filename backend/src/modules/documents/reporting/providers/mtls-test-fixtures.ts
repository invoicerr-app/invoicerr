/**
 * In-memory, throwaway TLS certificate helpers shared by every spec that needs to prove a "pt-at"
 * mTLS handshake against a REAL local `node:https` server — `pt-at-client.spec.ts` (the client's own
 * mTLS suite), `pt-declaration-provider.spec.ts` (the full WS-Security → HTTPS flow), and
 * `queue/__tests__/document-report-queue.redis.spec.ts` (the real-queue end-to-end proof). Never a
 * real certificate, never committed to disk — `node-forge` generates a self-signed cert + PKCS#12
 * purely in process memory, the same shape `transports/sdi/sdicoop-client.spec.ts`'s own
 * `generateSelfSignedCert`/`buildClientPfx` already established for the identical Italian mTLS case.
 *
 * Extracted here (2026-09-19) rather than left duplicated a third time: `pt-at-client.ts#buildPtAtClient`
 * presents its OWN `pfx`/`passphrase` on the raw TLS connection now (see that file's own "mTLS" header
 * section) — any spec whose "pt-at" stub is reachable over plain `http://` fails the handshake outright
 * (`AT mTLS/HTTPS request failed: not enough data`, the exact symptom that turned up in
 * `document-report-queue.redis.spec.ts` once this wiring landed), so every such stub needs the SAME
 * real cert + `requestCert: true, rejectUnauthorized: true` HTTPS server, not a per-file copy of it.
 */
import * as forge from 'node-forge';

export interface GeneratedCert {
  certPem: string;
  keyPem: string;
  cert: forge.pki.Certificate;
  keys: forge.pki.rsa.KeyPair;
}

/**
 * A self-signed X.509 certificate, generated fresh in memory. 2048-bit, not 1024: a REAL TLS
 * handshake is negotiated against this cert in every caller — modern OpenSSL's default security level
 * rejects a 1024-bit key for a live handshake ("ee key too small"), discovered building
 * `sdicoop-client.spec.ts`'s own identical fixture.
 */
export function generateSelfSignedCert(
  commonName: string,
  opts: { subjectAltIp?: string } = {},
): GeneratedCert {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'countryName', value: 'PT' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  if (opts.subjectAltIp) {
    // The SERVER cert needs a subjectAltName matching the address the client connects to (127.0.0.1)
    // — Node's TLS client checks SAN/IP, not just commonName, even against a self-signed cert it
    // otherwise trusts via `ca`. Type 7 = iPAddress (RFC 5280 GeneralName).
    cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 7, ip: opts.subjectAltIp }] }]);
  }
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    cert,
    keys,
  };
}

/** Builds a PKCS#12 (.pfx) bundle, base64-encoded — the exact shape a real "pt-at" channel's own
 *  `clientCertificateBase64` carries (`pt-at-client.ts#PtAtCredentials`). */
export function buildClientPfx(clientCert: GeneratedCert, password: string): string {
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(clientCert.keys.privateKey, [clientCert.cert], password);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary').toString('base64');
}
