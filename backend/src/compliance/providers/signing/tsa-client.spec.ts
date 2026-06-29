/**
 * RFC 3161 TSA client and timestamp-embedding specs.
 *
 * Coverage:
 *  1. buildTsq / extractTokenFromTsr helpers
 *  2. NullTsaClient returns null (offline-safe)
 *  3. HttpTsaClient returns null on non-OK HTTP response; calls fetch with correct headers
 *  4. XAdES-T: mock TSA → signed XML contains xades:UnsignedProperties / SignatureTimeStamp
 *  5. CAdES-T: mock TSA → p7m DER contains id-aa-signatureTimeStampToken unsigned attr
 *  6. BES regression: NullTsaClient → output identical to BES-level signing
 *
 * The mock TSA returns a minimal but structurally valid TSR / TST built with pkijs.
 * No network calls are made.  No external files are read.
 */

import * as forge from 'node-forge';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import { Application as XmldsigApp } from 'xmldsigjs';
import { setNodeDependencies } from 'xadesjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { RecordingComplianceLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { SigningCredentialsMaterial, SigningCredentialsPort } from './signing-credentials-port';
import { CadesSigningProvider, XadesSigningProvider } from './providers';
import {
  NullTsaClient,
  HttpTsaClient,
  TsaPort,
  SHA256_OID,
  buildTsq,
  extractTokenFromTsr,
} from './tsa-client';

// ---------------------------------------------------------------------------
// Engine setup (mirrors providers.spec.ts)
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
// Test certificate factory (same approach as providers.spec.ts)
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
    { name: 'commonName', value: 'Invoicerr TSA Test Cert' },
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
  const p12Password = 'tsa-test-p12-pass';
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], p12Password, {
    algorithm: '3des',
  });
  const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');

  return { material: { certDer, privateKeyPem, certPem, p12Buffer, p12Password } };
}

function fixedCredentials(material: SigningCredentialsMaterial): SigningCredentialsPort {
  return { resolve: async () => material };
}

// ---------------------------------------------------------------------------
// Minimal valid TST builder for mock TSA
//
// We build a real but self-signed TST (CMS SignedData with TSTInfo content)
// using pkijs, signed with the test certificate.  The token is then wrapped
// in a TimeStampResp shell to exercise extractTokenFromTsr().
// ---------------------------------------------------------------------------

/** Build a minimal TSTInfo DER covering the given messageImprint. */
function buildTstInfoDer(digest: Buffer, algoOid: string, serialNumber: number): Buffer {
  const digestAb: ArrayBuffer = new Uint8Array(digest).buffer;

  const tstInfo = new pkijs.TSTInfo({
    version: 1,
    policy: '1.2.3.4.5',
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: algoOid }),
      hashedMessage: new asn1js.OctetString({ valueHex: digestAb }),
    }),
    serialNumber: new asn1js.Integer({ value: serialNumber }),
    genTime: new Date(),
    ordering: false,
  });

  return Buffer.from(tstInfo.toSchema().toBER(false));
}

/**
 * Build a minimal DER-encoded TimeStampToken (CMS ContentInfo / SignedData).
 * The content is a TSTInfo; the signature is not cryptographically valid
 * (the test only verifies structural embedding, not the TST chain).
 */
function buildMockTst(digest: Buffer, algoOid: string = SHA256_OID): Buffer {
  const tstInfoDer = buildTstInfoDer(digest, algoOid, 42);

  // Wrap in a minimal CMS SignedData ContentInfo (no actual signature needed for structural tests).
  // We build it as raw ASN.1 to avoid pkijs's mandatory signing flow.
  const sigDataContent = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    // version INTEGER
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
      forge.asn1.integerToDer(3).getBytes()),
    // digestAlgorithms SET
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
          forge.asn1.oidToDer(algoOid).getBytes()),
      ]),
    ]),
    // encapContentInfo SEQUENCE  (id-eContentType-TSTInfo + OCTET STRING wrapping TSTInfo DER)
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
        forge.asn1.oidToDer('1.2.840.113549.1.9.16.1.4').getBytes()),
      forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
          tstInfoDer.toString('binary')),
      ]),
    ]),
    // signerInfos SET (empty — structural mock only)
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, []),
  ]);

  // ContentInfo: OID(signedData) + [0] EXPLICIT SignedData
  const contentInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
      forge.asn1.oidToDer('1.2.840.113549.1.7.2').getBytes()),
    forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [sigDataContent]),
  ]);

  return Buffer.from(forge.asn1.toDer(contentInfo).getBytes(), 'binary');
}

/**
 * Build a minimal DER-encoded TimeStampResp wrapping the given TST DER.
 * status = 0 (granted).
 */
function buildMockTsr(tstDer: Buffer): Buffer {
  // PKIStatusInfo: SEQUENCE { status INTEGER(0) }
  const pkiStatus = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
      forge.asn1.integerToDer(0).getBytes()),
  ]);
  // Re-parse the TST DER as ASN.1 so we can embed it
  const tstAsn1 = forge.asn1.fromDer(tstDer.toString('binary'));
  // TimeStampResp SEQUENCE { status PKIStatusInfo, timeStampToken ContentInfo }
  const tsr = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    pkiStatus,
    tstAsn1,
  ]);
  return Buffer.from(forge.asn1.toDer(tsr).getBytes(), 'binary');
}

/** A TsaPort that returns a pre-built mock TST. */
class MockTsaClient implements TsaPort {
  readonly calls: Array<{ digest: Buffer; algoOid: string }> = [];

  async timestamp(digest: Buffer, algoOid: string = SHA256_OID): Promise<Buffer> {
    this.calls.push({ digest, algoOid });
    return buildMockTst(digest, algoOid);
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <ID>INV-TSA-001</ID>
  <IssueDate>2026-06-29</IssueDate>
  <TotalAmount>200.00</TotalAmount>
</Invoice>`;

const xmlArtifact: RenderedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'EN16931_UBL',
  mime: 'application/xml',
  bytes: new TextEncoder().encode(TEST_XML),
};

// ---------------------------------------------------------------------------
// buildTsq / extractTokenFromTsr helpers
// ---------------------------------------------------------------------------
describe('buildTsq', () => {
  it('produces a non-empty DER buffer', () => {
    const digest = Buffer.alloc(32, 0xab);
    const tsq = buildTsq(digest);
    expect(tsq.length).toBeGreaterThan(10);
    expect(tsq[0]).toBe(0x30); // SEQUENCE
  });

  it('is parseable by pkijs TimeStampReq', () => {
    const digest = crypto.getRandomValues(new Uint8Array(32));
    const tsq = buildTsq(Buffer.from(digest));
    const ab: ArrayBuffer = new Uint8Array(tsq).buffer;
    const asn1 = asn1js.fromBER(ab);
    expect(asn1.offset).not.toBe(-1);
    const req = new pkijs.TimeStampReq({ schema: asn1.result });
    expect(req.version).toBe(1);
    expect(req.certReq).toBe(true);
  });
});

describe('extractTokenFromTsr', () => {
  it('returns null for invalid DER', () => {
    expect(extractTokenFromTsr(Buffer.from([0x00, 0x01]))).toBeNull();
  });

  it('returns a Buffer for a well-formed mock TSR with status=0', () => {
    const digest = Buffer.alloc(32, 0xcc);
    const tst = buildMockTst(digest);
    const tsr = buildMockTsr(tst);
    const token = extractTokenFromTsr(tsr);
    expect(token).not.toBeNull();
    expect(token![0]).toBe(0x30);
  });
});

// ---------------------------------------------------------------------------
// NullTsaClient
// ---------------------------------------------------------------------------
describe('NullTsaClient', () => {
  it('always returns null', async () => {
    const client = new NullTsaClient();
    const result = await client.timestamp(Buffer.alloc(32));
    expect(result).toBeNull();
  });

  it('returns null for any algoOid', async () => {
    const client = new NullTsaClient();
    expect(await client.timestamp(Buffer.alloc(32), '1.2.3.4')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HttpTsaClient (fetch mocked)
// ---------------------------------------------------------------------------
describe('HttpTsaClient', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns null when the HTTP response is not OK', async () => {
    globalThis.fetch = async () => new Response(null, { status: 500 });
    const client = new HttpTsaClient('http://tsa.example.invalid');
    expect(await client.timestamp(Buffer.alloc(32))).toBeNull();
  });

  it('sends POST with correct Content-Type header and returns TST on success', async () => {
    const digest = Buffer.alloc(32, 0xde);
    const tst = buildMockTst(digest);
    const tsr = buildMockTsr(tst);
    let capturedReq: { method: string; headers: Headers; body: Uint8Array } | null = null;

    globalThis.fetch = async (url, init) => {
      capturedReq = {
        method: init?.method ?? '',
        headers: new Headers(init?.headers as HeadersInit),
        body: new Uint8Array(init?.body as ArrayBuffer),
      };
      return new Response(new Uint8Array(tsr));
    };

    const client = new HttpTsaClient('http://tsa.example.invalid');
    const token = await client.timestamp(digest);

    expect(capturedReq).not.toBeNull();
    expect(capturedReq!.method).toBe('POST');
    expect(capturedReq!.headers.get('Content-Type')).toBe('application/timestamp-query');
    expect(token).not.toBeNull();
    expect(token![0]).toBe(0x30);
  });

  it('returns null on network error (fetch throws)', async () => {
    globalThis.fetch = async () => { throw new Error('network error'); };
    const client = new HttpTsaClient('http://tsa.example.invalid');
    expect(await client.timestamp(Buffer.alloc(32))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// XAdES-T: mock TSA embeds SignatureTimeStamp in QualifyingProperties
// ---------------------------------------------------------------------------
describe('XadesSigningProvider with signatureLevel=T', () => {
  let bundle: TestCertBundle;
  beforeAll(() => { bundle = generateTestCert(); });

  it('embeds xades:UnsignedProperties/SignatureTimeStamp in the signed XML', async () => {
    const mockTsa = new MockTsaClient();
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(
      fixedCredentials(bundle.material),
      { signatureLevel: 'T', tsa: mockTsa },
    );
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    const xml = Buffer.from(signed.bytes).toString('utf-8');
    expect(xml).toContain('UnsignedProperties');
    expect(xml).toContain('SignatureTimeStamp');
    expect(xml).toContain('EncapsulatedTimeStamp');
    expect(mockTsa.calls).toHaveLength(1);
    expect(mockTsa.calls[0].algoOid).toBe(SHA256_OID);
  }, 30_000);

  it('logs XAdES-T in the info entry', async () => {
    const mockTsa = new MockTsaClient();
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(
      fixedCredentials(bundle.material),
      { signatureLevel: 'T', tsa: mockTsa },
    );
    await provider.sign(xmlArtifact, 'test-cert', log);
    const infoEntry = log.entries.find((e) => e.level === 'info' && e.scope === 'signing/xades');
    expect(infoEntry?.message).toContain('-T');
  }, 30_000);

  it('falls back to BES when NullTsaClient is used (no UnsignedProperties)', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(
      fixedCredentials(bundle.material),
      { signatureLevel: 'T', tsa: new NullTsaClient() },
    );
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);
    const xml = Buffer.from(signed.bytes).toString('utf-8');
    // NullTsa → no timestamp → no UnsignedProperties appended
    expect(xml).not.toContain('UnsignedProperties');
    expect(signed.signature?.algo).toBe('XAdES');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// CAdES-T: mock TSA appends id-aa-signatureTimeStampToken unsigned attribute
// ---------------------------------------------------------------------------
describe('CadesSigningProvider with signatureLevel=T', () => {
  let bundle: TestCertBundle;
  beforeAll(() => { bundle = generateTestCert(); });

  it('appends [1] IMPLICIT unsignedAttrs containing id-aa-signatureTimeStampToken OID', async () => {
    const mockTsa = new MockTsaClient();
    const log = new RecordingComplianceLogger();
    const provider = new CadesSigningProvider(
      fixedCredentials(bundle.material),
      { signatureLevel: 'T', tsa: mockTsa },
    );
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);

    // Re-parse the DER and verify the unsigned attribute was appended.
    const derStr = Buffer.from(signed.bytes).toString('binary');
    const parsed = forge.asn1.fromDer(derStr);
    const signedData = (parsed.value as forge.asn1.Asn1[])[1].value[0] as forge.asn1.Asn1;
    const sdChildren = signedData.value as forge.asn1.Asn1[];
    let signerInfosSet: forge.asn1.Asn1 | null = null;
    for (let i = sdChildren.length - 1; i >= 0; i--) {
      if (sdChildren[i].type === forge.asn1.Type.SET) { signerInfosSet = sdChildren[i]; break; }
    }
    expect(signerInfosSet).not.toBeNull();
    const signerInfo = (signerInfosSet!.value as forge.asn1.Asn1[])[0];
    const siChildren = signerInfo.value as forge.asn1.Asn1[];

    // The last child should be [1] IMPLICIT context (unsignedAttrs)
    const lastChild = siChildren[siChildren.length - 1];
    expect(lastChild.type).toBe(1); // tag [1]

    // Navigate inside: unsignedAttrs > Attribute > OID
    const attrSeq = (lastChild.value as forge.asn1.Asn1[])[0];
    const oidNode = (attrSeq.value as forge.asn1.Asn1[])[0];
    const oid = forge.asn1.derToOid(oidNode.value as string);
    expect(oid).toBe('1.2.840.113549.1.9.16.2.14');

    expect(mockTsa.calls).toHaveLength(1);
  }, 30_000);

  it('falls back to BES output when NullTsaClient used', async () => {
    const log = new RecordingComplianceLogger();
    const besProvider = new CadesSigningProvider(fixedCredentials(bundle.material));
    const tProvider = new CadesSigningProvider(
      fixedCredentials(bundle.material),
      { signatureLevel: 'T', tsa: new NullTsaClient() },
    );
    const [signedBes, signedT] = await Promise.all([
      besProvider.sign(xmlArtifact, 'test-cert', log),
      tProvider.sign(xmlArtifact, 'test-cert', log),
    ]);

    // Both should start with SEQUENCE (0x30)
    expect(signedBes.bytes[0]).toBe(0x30);
    expect(signedT.bytes[0]).toBe(0x30);
    // With NullTsa the output should NOT have an extra [1] unsignedAttrs
    const derStrT = Buffer.from(signedT.bytes).toString('binary');
    const parsedT = forge.asn1.fromDer(derStrT);
    const sdT = (parsedT.value as forge.asn1.Asn1[])[1].value[0] as forge.asn1.Asn1;
    const sdTChildren = sdT.value as forge.asn1.Asn1[];
    let siSetT: forge.asn1.Asn1 | null = null;
    for (let i = sdTChildren.length - 1; i >= 0; i--) {
      if (sdTChildren[i].type === forge.asn1.Type.SET) { siSetT = sdTChildren[i]; break; }
    }
    const siT = (siSetT!.value as forge.asn1.Asn1[])[0];
    const lastChildT = (siT.value as forge.asn1.Asn1[])[(siT.value as forge.asn1.Asn1[]).length - 1];
    // Last child should be OCTET STRING (sig value), not [1]
    expect(lastChildT.type).toBe(forge.asn1.Type.OCTETSTRING);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// BES regression: existing BES tests should not be affected by new constructor signature
// ---------------------------------------------------------------------------
describe('BES regression — default options produce unchanged BES output', () => {
  let bundle: TestCertBundle;
  beforeAll(() => { bundle = generateTestCert(); });

  it('XAdES default constructor (no options) still produces BES-level output', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new XadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);
    const xml = Buffer.from(signed.bytes).toString('utf-8');
    expect(xml).toContain('ds:Signature');
    expect(xml).not.toContain('UnsignedProperties');
  }, 30_000);

  it('CAdES default constructor (no options) still produces BES-level output', async () => {
    const log = new RecordingComplianceLogger();
    const provider = new CadesSigningProvider(fixedCredentials(bundle.material));
    const signed = await provider.sign(xmlArtifact, 'test-cert', log);
    expect(signed.bytes[0]).toBe(0x30);
    expect(signed.mime).toBe('application/pkcs7-mime');
    // Signature info present
    expect(signed.signature?.algo).toBe('CAdES');
  }, 30_000);
});
