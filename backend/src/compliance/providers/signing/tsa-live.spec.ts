/**
 * TSA live integration test — gated behind TSA_LIVE=1 + TSA_URL.
 *
 * Skipped by default in CI and any offline run.  Set TSA_LIVE=1 and TSA_URL
 * to a real RFC 3161 endpoint (e.g. https://freetsa.org/tsr) to run.
 *
 * What this proves:
 *  - HttpTsaClient sends a valid TimeStampReq and parses the response.
 *  - XadesSigningProvider at level-T embeds a real SignatureTimeStamp node.
 *  - The returned TST is non-empty DER (starts with 0x30 SEQUENCE).
 *
 * Usage:
 *   cd backend
 *   TSA_LIVE=1 TSA_URL=https://freetsa.org/tsr npx jest tsa-live --no-coverage --runInBand
 */

import * as forge from 'node-forge';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import { Application as XmldsigApp } from 'xmldsigjs';
import { setNodeDependencies } from 'xadesjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { liveDescribe } from '../transmission/live-gate';
import { RecordingComplianceLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { SigningCredentialsMaterial, SigningCredentialsPort } from './signing-credentials-port';
import { XadesSigningProvider } from './providers';
import { HttpTsaClient } from './tsa-client';
import { SigningProviderRegistry } from './registry';

// ---------------------------------------------------------------------------
// Gate — entire suite is skipped unless TSA_LIVE=1 + TSA_URL are set
// ---------------------------------------------------------------------------
const describeLive = liveDescribe('TSA_LIVE', ['TSA_URL']);

// ---------------------------------------------------------------------------
// Engine setup (same as providers.spec.ts / tsa-client.spec.ts)
// ---------------------------------------------------------------------------
beforeAll(() => {
  const xmlDomDeps = { DOMParser, XMLSerializer } as Parameters<typeof setNodeDependencies>[0];
  setNodeDependencies(xmlDomDeps);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const xmldsigDir = path.dirname(require.resolve('xmldsigjs'));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xmlCoreInXmldsig = require(require.resolve('xml-core', { paths: [xmldsigDir] })) as {
    setNodeDependencies: typeof setNodeDependencies;
  };
  xmlCoreInXmldsig.setNodeDependencies(xmlDomDeps);
  XmldsigApp.setEngine('native', globalThis.crypto as Crypto);

  const engine = new pkijs.CryptoEngine({ crypto: globalThis.crypto });
  pkijs.setEngine('native', engine);
});

// ---------------------------------------------------------------------------
// Test certificate factory
// ---------------------------------------------------------------------------
interface TestCertBundle {
  material: SigningCredentialsMaterial;
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
    { name: 'commonName', value: 'Invoicerr TSA Live Test Cert' },
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
  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)),
  );
  const certDer = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    'binary',
  );

  return { material: { certDer, privateKeyPem, certPem } };
}

function fixedCredentials(material: SigningCredentialsMaterial): SigningCredentialsPort {
  return { resolve: async () => material };
}

// ---------------------------------------------------------------------------
// Sample invoice XML for signing
// ---------------------------------------------------------------------------
const TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <ID>INV-TSA-LIVE-001</ID>
  <IssueDate>2026-06-30</IssueDate>
  <TotalAmount>999.00</TotalAmount>
</Invoice>`;

const xmlArtifact: RenderedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'EN16931_UBL',
  mime: 'application/xml',
  bytes: new TextEncoder().encode(TEST_XML),
};

// ---------------------------------------------------------------------------
// Live suite
// ---------------------------------------------------------------------------
describeLive('TSA live round-trip against real TSA_URL', () => {
  const tsaUrl = process.env['TSA_URL']!;
  let bundle: TestCertBundle;

  beforeAll(() => {
    bundle = generateTestCert();
  });

  it('HttpTsaClient.timestamp returns a non-empty DER TST from the real TSA', async () => {
    const client = new HttpTsaClient(tsaUrl);
    const digest = Buffer.alloc(32, 0x42);
    const tst = await client.timestamp(digest);

    expect(tst).not.toBeNull();
    expect(tst!.length).toBeGreaterThan(10);
    // TST is a DER SEQUENCE (ContentInfo)
    expect(tst![0]).toBe(0x30);

    // Structural parse: should be decodable by asn1js
    const ab: ArrayBuffer = new Uint8Array(tst!).buffer;
    const parsed = asn1js.fromBER(ab);
    expect(parsed.offset).not.toBe(-1);
  }, 30_000);

  it('XadesSigningProvider at level-T embeds SignatureTimeStamp from real TSA', async () => {
    const provider = new XadesSigningProvider(
      fixedCredentials(bundle.material),
      { signatureLevel: 'T', tsa: new HttpTsaClient(tsaUrl) },
    );
    const log = new RecordingComplianceLogger();
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    const xml = Buffer.from(signed.bytes).toString('utf-8');

    // Hard-success: timestamp nodes must be present
    expect(xml).toContain('UnsignedProperties');
    expect(xml).toContain('SignatureTimeStamp');
    expect(xml).toContain('EncapsulatedTimeStamp');

    // Level logged as -T
    const infoEntry = log.entries.find((e) => e.level === 'info' && e.scope === 'signing/xades');
    expect(infoEntry?.message).toContain('-T');

    // EncapsulatedTimeStamp must contain non-empty base64 content
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#';
    const encapsulated = doc.getElementsByTagNameNS(XADES_NS, 'EncapsulatedTimeStamp');
    expect(encapsulated.length).toBeGreaterThan(0);
    const b64 = (encapsulated[0].textContent ?? '').replace(/\s/g, '');
    expect(b64.length).toBeGreaterThan(20);

    // Decode and parse the TST DER
    const tstDer = Buffer.from(b64, 'base64');
    expect(tstDer[0]).toBe(0x30);
    const ab: ArrayBuffer = new Uint8Array(tstDer).buffer;
    const parsed = asn1js.fromBER(ab);
    expect(parsed.offset).not.toBe(-1);
  }, 60_000);

  it('SigningProviderRegistry built from TSA_URL env produces XAdES-T with real TSA', async () => {
    // Full wiring path: env override → HttpTsaClient → -T provider → real TSA call.
    const registry = new SigningProviderRegistry(
      undefined,
      fixedCredentials(bundle.material),
      { TSA_URL: tsaUrl },
    );
    const log = new RecordingComplianceLogger();
    const signed = await registry.get('XAdES').sign(xmlArtifact, 'test-cert', log);

    const xml = Buffer.from(signed.bytes).toString('utf-8');
    expect(xml).toContain('SignatureTimeStamp');
    expect(xml).toContain('EncapsulatedTimeStamp');
  }, 60_000);
});
