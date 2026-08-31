/**
 * `signRenderedPdfIfConfigured` in isolation — root TODO item 13's wiring. No Prisma, no Puppeteer:
 * `SigningCredentialsPort` is a fake here (this is exactly the seam `sign-instance-pdf.ts`'s own
 * header documents), the same discipline `send-document-email.spec.ts` already holds for
 * `renderDocumentInstance`.
 *
 * The two behaviors root TODO item 13 requires, proven directly:
 *  1. No certificate configured → the PDF returned is the EXACT SAME BYTES, untouched.
 *  2. An ACTIVE certificate that fails to actually sign → THROWS (never a silent unsigned PDF).
 */
import * as forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { extractSignature } from '@signpdf/utils';
import { Application as XmldsigApp } from 'xmldsigjs';
import { setNodeDependencies } from 'xadesjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { signRenderedPdfIfConfigured } from './sign-instance-pdf';
import {
  NullSigningCredentials,
  SigningCredentialsMaterial,
  SigningCredentialsPort,
} from './signing-credentials-port';
import { RecordingSigningLogger } from './signing-logger';

beforeAll(() => {
  // ensureXmlCryptoEngine() in providers.ts also does this for XAdES/CAdES; PAdES itself needs none
  // of this, but the shared module-level init in providers.ts runs regardless of which algo is used.
  const xmlDomDeps = { DOMParser, XMLSerializer } as Parameters<typeof setNodeDependencies>[0];
  setNodeDependencies(xmlDomDeps);
  XmldsigApp.setEngine('native', globalThis.crypto as Crypto);
});

async function makeMiniPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

function generateTestCert(): SigningCredentialsMaterial {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: 'sign-instance-pdf test cert' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)),
  );
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const p12Password = 'sign-instance-pdf-test-pass';
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], p12Password, { algorithm: '3des' });
  const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');

  return { certDer, privateKeyPem, certPem, p12Buffer, p12Password };
}

function fixedCredentials(material: SigningCredentialsMaterial | null): SigningCredentialsPort {
  return { resolve: async () => material };
}

describe('signRenderedPdfIfConfigured', () => {
  it('no certificate configured (NullSigningCredentials) → the PDF is returned byte-for-byte unchanged', async () => {
    const pdf = await makeMiniPdf();
    const signed = await signRenderedPdfIfConfigured(new NullSigningCredentials(), 'company-1', pdf);

    expect(signed).toEqual(pdf);
    expect(Buffer.compare(signed, pdf)).toBe(0);
  });

  it('a credentials port that resolves to null for this company → unchanged, same as no port at all', async () => {
    const pdf = await makeMiniPdf();
    const signed = await signRenderedPdfIfConfigured(fixedCredentials(null), 'company-1', pdf);

    expect(Buffer.compare(signed, pdf)).toBe(0);
  });

  it('resolves the certRef as "{companyId}:PAdES" — never a bare companyId or a different algo', async () => {
    const material = generateTestCert();
    const seen: string[] = [];
    const spyPort: SigningCredentialsPort = {
      resolve: async (certRef) => {
        seen.push(certRef);
        return material;
      },
    };
    const pdf = await makeMiniPdf();
    await signRenderedPdfIfConfigured(spyPort, 'company-42', pdf);

    expect(seen).toEqual(['company-42:PAdES']);
  });

  it('an active, applicable certificate → the returned PDF is genuinely PAdES-signed (/ByteRange, /Contents, pdf-lib reopens)', async () => {
    const material = generateTestCert();
    const pdf = await makeMiniPdf();
    const log = new RecordingSigningLogger();

    const signed = await signRenderedPdfIfConfigured(fixedCredentials(material), 'company-1', pdf, { log });

    expect(Buffer.compare(signed, pdf)).not.toBe(0);
    const header = signed.subarray(0, 4).toString('latin1');
    expect(header).toBe('%PDF');

    const extracted = extractSignature(signed);
    expect(extracted.ByteRange).toHaveLength(4);
    expect(extracted.signature.length).toBeGreaterThan(10);

    const raw = signed.toString('latin1');
    expect(raw).toContain('/ByteRange');
    expect(raw).toContain('/Contents');

    const reopened = await PDFDocument.load(signed, { ignoreEncryption: true });
    expect(reopened.getPageCount()).toBe(1);

    expect(log.entries.some((e) => e.level === 'info' && e.scope === 'signing/pades')).toBe(true);
  }, 30_000);

  /**
   * THE loud-failure contract root TODO item 13 asks for: a certificate IS active (a p12Buffer WAS
   * resolved) but the PFX itself is unusable — this must never come back as an unsigned PDF with no
   * indication anything went wrong.
   */
  it('an active certificate whose PFX cannot actually sign → THROWS, never a silently-unsigned PDF', async () => {
    const material = generateTestCert();
    const broken: SigningCredentialsMaterial = { ...material, p12Buffer: Buffer.from('not-a-pkcs12-bundle') };
    const pdf = await makeMiniPdf();

    await expect(signRenderedPdfIfConfigured(fixedCredentials(broken), 'company-1', pdf)).rejects.toThrow();
  }, 30_000);
});
