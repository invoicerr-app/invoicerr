/**
 * `wsse-sign.ts` in isolation — fully offline, no network, no real certificate (an in-memory
 * RSA-2048 self-signed test cert via node-forge, the SAME `generateTestCert` shape
 * `signing/providers.spec.ts`/`signing-certificates.service.spec.ts` already use for the identical
 * "no real certificate is ever committed" reasoning).
 *
 * DoD (this task's own brief):
 *  - Structure: `wsse:BinarySecurityToken` present, `ds:SignedInfo`'s ONE `ds:Reference` targets the
 *    `soapenv:Body`'s OWN `wsu:Id` (not merely "some id"), `KeyInfo`/`SecurityTokenReference` points
 *    back at the token.
 *  - The signature RE-VERIFIES: `verifyWsseSignature()` independently recomputes the Body digest
 *    (Exc-C14N + SHA-256, via `xmldsigjs`'s own canonicalizer — see `wsse-sign.ts`'s own header for
 *    why the high-level `SignedXml.Verify()` API cannot be used for a `wsu:Id` reference) and
 *    RSA-SHA256-verifies `SignedInfo` against the public key embedded in the envelope's OWN
 *    `BinarySecurityToken` — never trusting the signer's own math blindly.
 *  - MUTATION GUARD #1 — a `ds:Reference` that targets something OTHER than the real `soapenv:Body`
 *    (the reference "points elsewhere") is caught by `referencesBody` going false — `verifyWsseSignature`
 *    always compares the Reference's OWN `URI` against the ACTUAL `soapenv:Body`'s `wsu:Id`, never
 *    trusting the URI to be correct just because SOME digest happens to validate.
 */
import * as forge from 'node-forge';

import { WsseCertificate, signSoapEnvelope, verifyWsseSignature } from './wsse-sign';

// ---------------------------------------------------------------------------
// In-memory test certificate — see this file's own header.
// ---------------------------------------------------------------------------
function generateTestCert(): WsseCertificate {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'Invoicerr WS-Security Test Cert' },
    { name: 'countryName', value: 'ES' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)),
  );
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return { certDer, privateKeyPem };
}

const BODY_INNER =
  '<web:enviarFactura xmlns:web="https://webservice.face.gob.es">' +
  '<request><correo>facturacion@empresa.es</correo></request>' +
  '</web:enviarFactura>';

describe('signSoapEnvelope', () => {
  let cert: WsseCertificate;

  beforeAll(() => {
    cert = generateTestCert();
  });

  it('embeds a wsse:BinarySecurityToken carrying the base64 DER certificate', async () => {
    const { envelope, tokenId } = await signSoapEnvelope(BODY_INNER, cert);

    expect(envelope).toContain('wsse:BinarySecurityToken');
    expect(envelope).toContain(`wsu:Id="${tokenId}"`);
    expect(envelope).toContain(
      'ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"',
    );
    expect(envelope).toContain(cert.certDer.toString('base64'));
  });

  it("the ONE ds:Reference targets the soapenv:Body's OWN wsu:Id — not the token, not anything else", async () => {
    const { envelope, bodyId, tokenId } = await signSoapEnvelope(BODY_INNER, cert);

    expect(envelope).toContain(`<ds:Reference URI="#${bodyId}">`);
    expect(envelope).not.toContain(`<ds:Reference URI="#${tokenId}">`);
    expect(envelope).toMatch(new RegExp(`<soapenv:Body[^>]*wsu:Id="${bodyId}"`));
  });

  it('KeyInfo/SecurityTokenReference points BACK at the BinarySecurityToken by its own wsu:Id', async () => {
    const { envelope, tokenId } = await signSoapEnvelope(BODY_INNER, cert);

    expect(envelope).toContain('wsse:SecurityTokenReference');
    expect(envelope).toContain(`<wsse:Reference URI="#${tokenId}"`);
  });

  it('carries the original body content through byte-for-byte', async () => {
    const { envelope } = await signSoapEnvelope(BODY_INNER, cert);
    expect(envelope).toContain(BODY_INNER);
  });

  it('the signature RE-VERIFIES independently (own digest recomputation + RSA-SHA256 verify)', async () => {
    const { envelope } = await signSoapEnvelope(BODY_INNER, cert);

    const result = await verifyWsseSignature(envelope);

    expect(result.referencesBody).toBe(true);
    expect(result.bodyDigestMatches).toBe(true);
    expect(result.signatureValid).toBe(true);
  });

  it('a DIFFERENT cert signing the SAME body produces a DIFFERENT signature (not a fixed/fake value)', async () => {
    const other = generateTestCert();
    const a = await signSoapEnvelope(BODY_INNER, cert);
    const b = await signSoapEnvelope(BODY_INNER, other);
    const sigOf = (xml: string) => xml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)?.[1];
    expect(sigOf(a.envelope)).toBeTruthy();
    expect(sigOf(a.envelope)).not.toBe(sigOf(b.envelope));
  });

  // MUTATION GUARD #1 (this task's own) — "la signature couvre autre chose que le Body (la référence
  // pointe ailleurs)". Rather than only asserting on the HAPPY output above, this simulates the
  // mutant's OWN observable symptom directly against `verifyWsseSignature` — a Reference rewritten to
  // point at the wrong id must be caught, because the verifier recomputes the Body digest from the
  // REAL Body element, never from whatever the URI merely claims.
  it('MUTATION GUARD #1 — a Reference rewritten to point away from the real Body is caught by verifyWsseSignature', async () => {
    const { envelope, bodyId, tokenId } = await signSoapEnvelope(BODY_INNER, cert);
    // Simulate "the reference points elsewhere" — rewrite the ONE ds:Reference's URI from the Body's
    // own wsu:Id to the token's — everything else (the DigestValue, the SignatureValue) is left as
    // originally computed FOR THE BODY, exactly what a real "wrong element referenced" bug would
    // produce (the code still digests/signs the Body, it just mislabels what the Reference claims to
    // cover).
    const mutated = envelope.replace(`URI="#${bodyId}"`, `URI="#${tokenId}"`);

    const result = await verifyWsseSignature(mutated);

    // The digest bytes themselves are still a valid hash of the real Body (this mutation only
    // relabels what the Reference CLAIMS to cover) — `referencesBody` is the signal that actually
    // catches "wrong element referenced", and it must be false here.
    expect(result.referencesBody).toBe(false);
    expect(result.bodyWsuId).toBe(bodyId);
    expect(result.referenceUri).toBe(tokenId);
  });

  it('is genuinely tied to the body content — a tampered Body fails digest verification', async () => {
    const { envelope } = await signSoapEnvelope(BODY_INNER, cert);
    const tampered = envelope.replace('facturacion@empresa.es', 'attacker@evil.example');

    const result = await verifyWsseSignature(tampered);

    expect(result.bodyDigestMatches).toBe(false);
  });
});
