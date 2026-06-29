/**
 * Real cryptographic signing tests — all certs/keys are generated in-memory.
 * No external files, no network, no env vars needed.
 *
 * DoD:
 *  - XAdES output verifies with xadesjs own Verify() API
 *  - CAdES .p7m verifies with node-forge pkcs7 verify
 *  - PAdES PDF carries a signature extractable by @signpdf/utils
 *  - No-cert path returns unsigned with a warn note (tested in signing-registry.spec.ts)
 */
import * as forge from 'node-forge';
import { Application as XmldsigApp, Parse as XmlParse } from 'xmldsigjs';
import { setNodeDependencies } from 'xadesjs';
import { SignedXml } from 'xadesjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { PDFDocument } from 'pdf-lib';
import { extractSignature } from '@signpdf/utils';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

import { RecordingComplianceLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { SigningCredentialsMaterial, SigningCredentialsPort } from './signing-credentials-port';
import { CadesSigningProvider, PadesSigningProvider, XadesSigningProvider } from './providers';

// ---------------------------------------------------------------------------
// One-time engine setup for xmldsigjs / pkijs.
// Mirrors ensureXmlCryptoEngine() in providers.ts.
// ---------------------------------------------------------------------------
beforeAll(() => {
  const xmlDomDeps = { DOMParser, XMLSerializer } as Parameters<typeof setNodeDependencies>[0];

  // Set DOM deps on xadesjs's xml-core
  setNodeDependencies(xmlDomDeps);

  // Set DOM deps on xmldsigjs's own xml-core (separate module instance)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const xmldsigDir = path.dirname(require.resolve('xmldsigjs'));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xmlCoreInXmldsig = require(require.resolve('xml-core', { paths: [xmldsigDir] })) as {
    setNodeDependencies: typeof setNodeDependencies;
  };
  xmlCoreInXmldsig.setNodeDependencies(xmlDomDeps);

  // Register WebCrypto for xmldsigjs
  XmldsigApp.setEngine('native', globalThis.crypto as Crypto);

  // Register WebCrypto for pkijs
  const engine = new pkijs.CryptoEngine({ crypto: globalThis.crypto });
  pkijs.setEngine('native', engine);
});

// ---------------------------------------------------------------------------
// Test certificate factory — RSA-2048 self-signed cert via node-forge.
// Generated in-memory; never persisted to disk or logged.
// ---------------------------------------------------------------------------

interface TestCertBundle {
  material: SigningCredentialsMaterial;
  forgeCert: forge.pki.Certificate;
}

function generateTestCert(): TestCertBundle {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: 'Invoicerr Test Signing Cert' },
    { name: 'countryName', value: 'FR' },
    { name: 'organizationName', value: 'Invoicerr Tests' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)));
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');

  // Build PKCS#12 bundle for PAdES
  const p12Password = 'test-p12-pass';
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], p12Password, { algorithm: '3des' });
  const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');

  const material: SigningCredentialsMaterial = {
    certDer,
    privateKeyPem,
    certPem,
    p12Buffer,
    p12Password,
  };

  return { material, forgeCert: cert };
}

/** A credentials port that always returns the given material. */
function fixedCredentials(material: SigningCredentialsMaterial): SigningCredentialsPort {
  return { resolve: async () => material };
}

// ---------------------------------------------------------------------------
// Shared test XML document
// ---------------------------------------------------------------------------
const TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <ID>INV-001</ID>
  <IssueDate>2026-06-29</IssueDate>
  <TotalAmount>100.00</TotalAmount>
</Invoice>`;

const xmlArtifact: RenderedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'EN16931_UBL',
  mime: 'application/xml',
  bytes: new TextEncoder().encode(TEST_XML),
};

// ---------------------------------------------------------------------------
// XAdES tests
// ---------------------------------------------------------------------------

describe('XadesSigningProvider', () => {
  let bundle: TestCertBundle;

  beforeAll(() => {
    bundle = generateTestCert();
  });

  it('signs XML and produces a signed artifact with XAdES signature info', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    expect(signed.signature).toBeDefined();
    expect(signed.signature!.algo).toBe('XAdES');
    expect(signed.signature!.certRef).toBe('test-cert');
    expect(log.entries.some((e) => e.level === 'info' && e.scope === 'signing/xades')).toBe(true);
  });

  it('signed XML contains a ds:Signature element', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    const signedXmlStr = Buffer.from(signed.bytes).toString('utf-8');
    expect(signedXmlStr).toContain('<ds:Signature');
    expect(signedXmlStr).toContain('SignedInfo');
    expect(signedXmlStr).toContain('SignatureValue');
  });

  it('signature verifies with xadesjs Verify()', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    const signedXmlStr = Buffer.from(signed.bytes).toString('utf-8');
    const signedDoc = XmlParse(signedXmlStr);

    // Find the Signature element in the parsed document
    const signatureElements = signedDoc.getElementsByTagNameNS(
      'http://www.w3.org/2000/09/xmldsig#',
      'Signature',
    );
    expect(signatureElements.length).toBeGreaterThan(0);

    // Verify via xadesjs: must call LoadXml(signatureElement) before Verify()
    // so that the internal SignedXml object reads the signature metadata from the DOM.
    const verifier = new SignedXml(signedDoc);
    verifier.LoadXml(signatureElements[0] as Element);
    const isValid = await verifier.Verify();
    expect(isValid).toBe(true);
  }, 30000);

  it('different XML content produces different signature bytes', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(fixedCredentials(bundle.material));

    const xml2 = TEST_XML.replace('INV-001', 'INV-002');
    const artifact2: RenderedArtifact = { ...xmlArtifact, bytes: new TextEncoder().encode(xml2) };

    const [signed1, signed2] = await Promise.all([
      provider.sign(xmlArtifact, 'test-cert', log),
      provider.sign(artifact2, 'test-cert', log),
    ]);

    // The signature values must differ for different content.
    expect(Buffer.from(signed1.bytes).toString()).not.toBe(Buffer.from(signed2.bytes).toString());
  }, 30000);
});

// ---------------------------------------------------------------------------
// CAdES tests
// ---------------------------------------------------------------------------

describe('CadesSigningProvider', () => {
  let bundle: TestCertBundle;

  beforeAll(() => {
    bundle = generateTestCert();
  });

  it('signs content and produces a .p7m artifact with CAdES signature info', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new CadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    expect(signed.signature).toBeDefined();
    expect(signed.signature!.algo).toBe('CAdES');
    expect(signed.mime).toBe('application/pkcs7-mime');
    expect(log.entries.some((e) => e.level === 'info' && e.scope === 'signing/cades')).toBe(true);
  });

  it('output bytes are a valid PKCS#7 DER envelope', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new CadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    // DER ContentInfo starts with tag 0x30 (SEQUENCE)
    expect(signed.bytes[0]).toBe(0x30);
    expect(signed.bytes.length).toBeGreaterThan(100);
  });

  it('PKCS#7 envelope verifies with pkijs (signer cert matches)', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new CadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    // Parse the DER via asn1js → pkijs ContentInfo → SignedData
    const derBuffer = Buffer.from(signed.bytes);
    const asn1Object = asn1js.fromBER(
      derBuffer.buffer.slice(derBuffer.byteOffset, derBuffer.byteOffset + derBuffer.byteLength),
    );
    expect(asn1Object.offset).not.toBe(-1);

    const contentInfo = new pkijs.ContentInfo({ schema: asn1Object.result });
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });

    // Check signers
    expect(signedData.signerInfos).toHaveLength(1);

    // Verify the signature using pkijs (computes digest and verifies RSA signature)
    const isValid = await signedData.verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
    });
    // extendedMode returns an object with signatureVerified
    expect((isValid as pkijs.SignedDataVerifyResult).signatureVerified).toBe(true);
  }, 30000);

  it('envelope contains the signer certificate', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new CadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    const derString = Buffer.from(signed.bytes).toString('binary');
    const asn1 = forge.asn1.fromDer(derString);
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsSignedData;

    // The PKCS#7 SignedData must carry the signer certificate
    expect(p7.certificates).toHaveLength(1);
    const embeddedCert = p7.certificates![0] as forge.pki.Certificate;
    expect(embeddedCert.subject.getField('CN')?.value).toBe('Invoicerr Test Signing Cert');
  });
});

// ---------------------------------------------------------------------------
// PAdES tests
// ---------------------------------------------------------------------------

/** Minimal valid 1-page PDF created with pdf-lib. */
async function makeMiniPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save({ useObjectStreams: false });
}

const pdfArtifact: RenderedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'FACTURX',
  mime: 'application/pdf',
  bytes: new Uint8Array(), // will be populated in beforeAll
};

describe('PadesSigningProvider', () => {
  let bundle: TestCertBundle;
  let artifact: RenderedArtifact;

  beforeAll(async () => {
    bundle = generateTestCert();
    const pdfBytes = await makeMiniPdf();
    artifact = { ...pdfArtifact, bytes: pdfBytes };
  });

  it('signs PDF and produces a PAdES artifact with PAdES signature info', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new PadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(artifact, 'test-cert', log);

    expect(signed.signature).toBeDefined();
    expect(signed.signature!.algo).toBe('PAdES');
    expect(signed.signature!.certRef).toBe('test-cert');
    expect(log.entries.some((e) => e.level === 'info' && e.scope === 'signing/pades')).toBe(true);
  }, 30000);

  it('signed PDF bytes start with %PDF', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new PadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(artifact, 'test-cert', log);

    const header = Buffer.from(signed.bytes.slice(0, 4)).toString('binary');
    expect(header).toBe('%PDF');
    expect(signed.bytes.length).toBeGreaterThan(100);
  }, 30000);

  it('signed PDF carries an extractable PKCS#7 signature (@signpdf/utils)', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new PadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(artifact, 'test-cert', log);

    // extractSignature returns { ByteRange, signature } where signature is the raw
    // PKCS#7 DER hex. If the PDF is malformed or unsigned, this will throw.
    const extracted = extractSignature(Buffer.from(signed.bytes));
    expect(extracted.ByteRange).toHaveLength(4);
    // signature is a binary string; non-zero length confirms extraction succeeded
    expect(extracted.signature.length).toBeGreaterThan(10);

    // signature from extractSignature is a binary string (DER bytes)
    const asn1 = forge.asn1.fromDer(extracted.signature);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as any;
    expect(p7.rawCapture.signerInfos).toHaveLength(1);
    expect(p7.certificates).toHaveLength(1);
  }, 30000);

  it('warns and passes through unsigned when no p12Buffer present', async () => {
    const materialNoPfx: SigningCredentialsMaterial = {
      certDer: bundle.material.certDer,
      privateKeyPem: bundle.material.privateKeyPem,
      certPem: bundle.material.certPem,
      // no p12Buffer
    };
    const log = new RecordingComplianceLogger();
    const provider = new PadesSigningProvider(fixedCredentials(materialNoPfx));
    const signed = await provider.sign(artifact, 'test-cert', log);

    expect(signed.signature).toBeUndefined();
    expect(log.entries.some((e) => e.level === 'warn' && e.scope === 'signing/pades')).toBe(true);
  });
});
