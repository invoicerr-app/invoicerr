/**
 * unwrapCadesP7m — CAdES-BES (.p7m) de-enveloping (M-11).
 *
 * Builds a REAL PKCS#7 SignedData envelope in-test with node-forge (self-signed cert, small
 * 1024-bit key for speed) and asserts the exact encapsulated XML round-trips back out.
 */
import * as forge from 'node-forge';
import { unwrapCadesP7m } from './p7m';

// ---------------------------------------------------------------------------
// Helper: build a real CAdES-BES SignedData envelope around `xml`.
// ---------------------------------------------------------------------------

function makeP7m(xml: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: 'Test Signer' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: keys.privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // signingTime: omit value — forge fills it in automatically from current time
      { type: forge.pki.oids.signingTime },
    ],
  });
  p7.sign();
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

const SAMPLE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">' +
  '<FatturaElettronicaHeader><CedentePrestatore><DatiAnagrafici><Anagrafica>' +
  '<Denominazione>Fornitore Test SRL</Denominazione></Anagrafica></DatiAnagrafici></CedentePrestatore>' +
  '</FatturaElettronicaHeader></p:FatturaElettronica>';

describe('unwrapCadesP7m', () => {
  it('unwraps a real CAdES-BES SignedData Buffer and returns the exact encapsulated XML', () => {
    const der = makeP7m(SAMPLE_XML);
    const result = unwrapCadesP7m(der);
    expect(result.unwrapped).toBe(true);
    expect(result.xml).toBe(SAMPLE_XML);
  });

  it('unwraps the same envelope passed as a latin1-encoded DER string (byte-fidelity string)', () => {
    const der = makeP7m(SAMPLE_XML);
    const asLatin1String = der.toString('binary'); // 'binary' === 'latin1' in Node
    const result = unwrapCadesP7m(asLatin1String);
    expect(result.unwrapped).toBe(true);
    expect(result.xml).toBe(SAMPLE_XML);
  });

  it('unwraps a base64-encoded DER string', () => {
    const der = makeP7m(SAMPLE_XML);
    const b64 = der.toString('base64');
    const result = unwrapCadesP7m(b64);
    expect(result.unwrapped).toBe(true);
    expect(result.xml).toBe(SAMPLE_XML);
  });

  it('unwraps a PEM-encoded PKCS7 block (-----BEGIN PKCS7-----)', () => {
    const der = makeP7m(SAMPLE_XML);
    const b64 = der.toString('base64');
    const pem = `-----BEGIN PKCS7-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PKCS7-----\n`;
    const result = unwrapCadesP7m(pem);
    expect(result.unwrapped).toBe(true);
    expect(result.xml).toBe(SAMPLE_XML);
  });

  it('passes plain XML through untouched (unwrapped: false)', () => {
    const result = unwrapCadesP7m(SAMPLE_XML);
    expect(result.unwrapped).toBe(false);
    expect(result.xml).toBe(SAMPLE_XML);
  });

  it('passes plain XML without a declaration through untouched', () => {
    const xml = '<FatturaElettronica><Test>x</Test></FatturaElettronica>';
    const result = unwrapCadesP7m(xml);
    expect(result.unwrapped).toBe(false);
    expect(result.xml).toBe(xml);
  });

  it('garbage/non-CMS binary returns unwrapped:false without throwing', () => {
    const garbage = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
    expect(() => unwrapCadesP7m(garbage)).not.toThrow();
    const result = unwrapCadesP7m(garbage);
    expect(result.unwrapped).toBe(false);
  });

  it('garbage text (not XML, not CMS) returns unwrapped:false without throwing', () => {
    const result = unwrapCadesP7m('not an invoice, not a p7m, just garbage text');
    expect(result.unwrapped).toBe(false);
    expect(result.xml).toBe('not an invoice, not a p7m, just garbage text');
  });

  it('a malformed DER SEQUENCE (truncated) returns unwrapped:false without throwing', () => {
    // Starts like a DER SEQUENCE (0x30 0x82 ...) but is truncated/garbage inside.
    const malformed = Buffer.from([0x30, 0x82, 0x7f, 0xff, 0x01, 0x02, 0x03]);
    expect(() => unwrapCadesP7m(malformed)).not.toThrow();
    expect(unwrapCadesP7m(malformed).unwrapped).toBe(false);
  });

  it('empty string returns unwrapped:false without throwing', () => {
    expect(() => unwrapCadesP7m('')).not.toThrow();
    expect(unwrapCadesP7m('').unwrapped).toBe(false);
  });
});
