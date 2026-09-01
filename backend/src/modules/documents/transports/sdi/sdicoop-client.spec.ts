/**
 * `sdicoop-client.ts` in isolation — root TODO item 10, SdI wave, **implemented-awaiting-
 * accreditation** (see that file's own header for the full "what was read vs extrapolated" account,
 * and `sdicoop.live.spec.ts` for the real, gated round-trip nobody can run today).
 *
 * Three layers proven here, exactly as this task's own brief asks:
 *  1. `buildRiceviFileEnvelope` — the exact SOAP structure read from the WSDL/XSD (pure, no network).
 *  2. `parseRiceviFileResponse` — every named failure shape (SOAP Fault, business `<Errore>`, and the
 *     hard-success contract: no `IdentificativoSdI` is a FAILURE even with no `<Errore>` either —
 *     MUTATION TARGET #1, see that function's own comment in `sdicoop-client.ts`).
 *  3. `SdiCoopClient` against a REAL local HTTPS server requiring mTLS — a self-signed client
 *     certificate (built in-memory with `node-forge`, the exact `generateTestCert` shape
 *     `signing-certificates.service.spec.ts` already uses for the identical "no real certificate is
 *     ever committed" reasoning) is presented and VERIFIED server-side (`req.socket.authorized`,
 *     `getPeerCertificate().subject.CN`) — proving the client actually authenticates with the
 *     certificate it was configured with, not merely that some TLS handshake happened to succeed.
 */
import * as forge from 'node-forge';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';

import {
  buildRiceviFileEnvelope,
  NOMEFILE_PATTERN,
  parseRiceviFileResponse,
  SdiCoopClient,
  SdiCoopError,
} from './sdicoop-client';

// ---------------------------------------------------------------------------
// In-memory cert helpers — no real certificate ever committed or used.
// ---------------------------------------------------------------------------

interface GeneratedCert {
  certPem: string;
  keyPem: string;
  cert: forge.pki.Certificate;
  keys: forge.pki.rsa.KeyPair;
}

function generateSelfSignedCert(commonName: string, opts: { subjectAltIp?: string } = {}): GeneratedCert {
  // 2048, not 1024: a REAL TLS handshake is established below (unlike
  // `signing-certificates.service.spec.ts`'s own 1024-bit fixture, which only ever gets PARSED, never
  // used to actually negotiate TLS) — modern OpenSSL's default security level rejects a 1024-bit key
  // for a live handshake ("ee key too small"), discovered running this very spec.
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'countryName', value: 'IT' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  if (opts.subjectAltIp) {
    // The SERVER cert needs a subjectAltName matching the address the client connects to (127.0.0.1)
    // — discovered running this very spec: Node's TLS client checks SAN/IP, not just commonName, even
    // against a self-signed cert it otherwise trusts via `ca`. Type 7 = iPAddress (RFC 5280 GeneralName).
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

/** Builds a PKCS#12 (.pfx) bundle, base64-encoded — the exact shape a real "sdi" channel's own
 *  `certificate` field carries (`sdi-transport.ts#SdiCredentials`), generated the same way
 *  `signing-certificates.service.spec.ts#generateTestCert` already does for the identical reason. */
function buildClientPfx(clientCert: GeneratedCert, password: string): string {
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(clientCert.keys.privateKey, [clientCert.cert], password);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary').toString('base64');
}

// ---------------------------------------------------------------------------
// A local, self-signed, mTLS-REQUIRING HTTPS server standing in for SdIRiceviFile.
// ---------------------------------------------------------------------------

interface StubServer {
  url: string;
  serverCertPem: string;
  close(): Promise<void>;
  /** The last request's peer certificate CN, and whether Node itself verified it against the `ca` this
   *  server was configured with — set by the handler right before it responds. */
  lastPeer: { authorized: boolean; commonName: string | undefined } | undefined;
  setResponse(status: number, body: string): void;
}

async function startStubServer(
  clientCertPem: string,
  opts: { rejectUnauthorized?: boolean } = {},
): Promise<StubServer> {
  const server0 = generateSelfSignedCert('Test SdI Collaudo Stub', { subjectAltIp: '127.0.0.1' });
  let responseStatus = 200;
  let responseBody = '';
  const state: StubServer = {
    url: '',
    serverCertPem: server0.certPem,
    lastPeer: undefined,
    close: () => Promise.resolve(),
    setResponse(status: number, body: string) {
      responseStatus = status;
      responseBody = body;
    },
  };

  const server = https.createServer(
    {
      key: server0.keyPem,
      cert: server0.certPem,
      // mTLS: require and verify the CLIENT's own certificate against `clientCertPem` — this is what
      // proves `SdiCoopClient` actually PRESENTS its configured pfx, not merely that plain TLS works.
      requestCert: true,
      // Lenient by default (inspect `authorized` ourselves rather than hard-failing the socket) — the
      // WRONG-passphrase test below asks for `true` (a REAL AdE server's likely posture) specifically
      // BECAUSE a lenient server would otherwise still complete the handshake (Node silently sends no
      // client cert at all when pfx decryption fails, rather than throwing) and this test would prove
      // nothing.
      rejectUnauthorized: opts.rejectUnauthorized ?? false,
      ca: [clientCertPem],
    },
    (req, res) => {
      const socket = req.socket as unknown as {
        authorized?: boolean;
        getPeerCertificate: () => { subject?: { CN?: string } };
      };
      state.lastPeer = {
        authorized: socket.authorized === true,
        commonName: socket.getPeerCertificate()?.subject?.CN,
      };
      res.statusCode = responseStatus;
      res.setHeader('Content-Type', 'text/xml; charset=utf-8');
      res.end(responseBody);
    },
  );

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  state.url = `https://127.0.0.1:${port}/ricevi_file`;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}

const RESPOSTA_XML = (idSdI: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
     <soap:Body>
       <ns:rispostaSdIRiceviFile xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
         <ns:IdentificativoSdI>${idSdI}</ns:IdentificativoSdI>
         <ns:DataOraRicezione>2026-09-01T10:00:00</ns:DataOraRicezione>
       </ns:rispostaSdIRiceviFile>
     </soap:Body>
   </soap:Envelope>`;

const ERRORE_XML = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
     <soap:Body>
       <ns:rispostaSdIRiceviFile xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
         <ns:IdentificativoSdI>000000000000</ns:IdentificativoSdI>
         <ns:DataOraRicezione>2026-09-01T10:00:00</ns:DataOraRicezione>
         <ns:Errore>${code}</ns:Errore>
       </ns:rispostaSdIRiceviFile>
     </soap:Body>
   </soap:Envelope>`;

const MALFORMED_XML_NO_REFERENCE = `<?xml version="1.0" encoding="UTF-8"?>
   <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
     <soap:Body>
       <ns:rispostaSdIRiceviFile xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
         <ns:DataOraRicezione>2026-09-01T10:00:00</ns:DataOraRicezione>
       </ns:rispostaSdIRiceviFile>
     </soap:Body>
   </soap:Envelope>`;

const SOAP_FAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
   <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
     <soap:Body>
       <soap:Fault>
         <faultcode>soap:Server</faultcode>
         <faultstring>Certificate rejected</faultstring>
       </soap:Fault>
     </soap:Body>
   </soap:Envelope>`;

// ---------------------------------------------------------------------------
// 1. buildRiceviFileEnvelope — pure
// ---------------------------------------------------------------------------

describe('buildRiceviFileEnvelope', () => {
  it('builds the exact structure read from TrasmissioneTypes_v1.0/1.1.xsd: fileSdIAccoglienza(NomeFile, File)', () => {
    const xml = buildRiceviFileEnvelope('IT01234567890_0000000001.xml', 'aGVsbG8=');

    expect(xml).toContain('http://schemas.xmlsoap.org/soap/envelope/');
    expect(xml).toContain('http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types');
    expect(xml).toMatch(/<[\w:]*fileSdIAccoglienza[^>]*>/);
    expect(xml).toMatch(/<[\w:]*NomeFile[^>]*>IT01234567890_0000000001\.xml<\/[\w:]*NomeFile>/);
    expect(xml).toMatch(/<[\w:]*File[^>]*>aGVsbG8=<\/[\w:]*File>/);
  });

  it('rejects a NomeFile that does not match the read pattern [a-zA-Z0-9_.]{9,50} (nomeFile_Type)', () => {
    expect(() => buildRiceviFileEnvelope('bad name!.xml', 'aGVsbG8=')).toThrow(/NomeFile/);
    expect(NOMEFILE_PATTERN.test('bad name!.xml')).toBe(false);
    expect(NOMEFILE_PATTERN.test('IT01234567890_0000000001.xml')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. parseRiceviFileResponse — pure
// ---------------------------------------------------------------------------

describe('parseRiceviFileResponse', () => {
  const REQUEST = { idTrasmittente: 'IT01234567890', filename: 'IT01234567890_0000000001.xml' };

  it('parses IdentificativoSdI out of a well-formed rispostaSdIRiceviFile', () => {
    const result = parseRiceviFileResponse(RESPOSTA_XML('123456789012'), REQUEST);
    expect(result).toEqual({
      idSdI: 123456789012,
      idTrasmittente: 'IT01234567890',
      filename: REQUEST.filename,
    });
  });

  it('throws a named SOAP_FAULT error for a soap:Fault, never a silent success', () => {
    expect(() => parseRiceviFileResponse(SOAP_FAULT_XML, REQUEST)).toThrow(/SOAP Fault/);
    try {
      parseRiceviFileResponse(SOAP_FAULT_XML, REQUEST);
      throw new Error('expected parseRiceviFileResponse to throw');
    } catch (err) {
      expect((err as SdiCoopError).code).toBe('SOAP_FAULT');
      expect((err as Error).message).toContain('Certificate rejected');
    }
  });

  it.each([
    'EI01',
    'EI02',
    'EI03',
  ] as const)('throws a named %s error (business Errore), with its verbatim meaning, never a silent success', (code) => {
    expect(() => parseRiceviFileResponse(ERRORE_XML(code), REQUEST)).toThrow(new RegExp(code));
    try {
      parseRiceviFileResponse(ERRORE_XML(code), REQUEST);
      throw new Error('expected parseRiceviFileResponse to throw');
    } catch (err) {
      expect((err as SdiCoopError).code).toBe(code);
    }
  });

  it('MUTATION TARGET #1 — throws when the response carries NEITHER a usable IdentificativoSdI NOR an Errore', () => {
    expect(() => parseRiceviFileResponse(MALFORMED_XML_NO_REFERENCE, REQUEST)).toThrow(
      /neither a usable IdentificativoSdI nor an <Errore>/,
    );
    try {
      parseRiceviFileResponse(MALFORMED_XML_NO_REFERENCE, REQUEST);
      throw new Error('expected parseRiceviFileResponse to throw');
    } catch (err) {
      expect((err as SdiCoopError).code).toBe('MALFORMED_RESPONSE');
    }
  });

  it('also rejects an explicitly empty IdentificativoSdI element (never treated as present)', () => {
    const xml = RESPOSTA_XML('');
    expect(() => parseRiceviFileResponse(xml, REQUEST)).toThrow(/neither a usable IdentificativoSdI/);
  });
});

// ---------------------------------------------------------------------------
// 3. SdiCoopClient — REAL mTLS, against a local stub. No real network dependency.
// ---------------------------------------------------------------------------

describe('SdiCoopClient — mTLS against a local stub server', () => {
  const CLIENT_CN = 'Test Invoicerr Trasmittente';
  let clientCert: GeneratedCert;
  let clientPfxBase64: string;
  const CLIENT_PFX_PASSWORD = 'test-pfx-password-not-real';
  let stub: StubServer;

  beforeAll(async () => {
    clientCert = generateSelfSignedCert(CLIENT_CN);
    clientPfxBase64 = buildClientPfx(clientCert, CLIENT_PFX_PASSWORD);
    stub = await startStubServer(clientCert.certPem);
  });

  afterAll(async () => {
    await stub.close();
  });

  it('presents its client certificate (verified server-side) and parses IdentificativoSdI on success', async () => {
    stub.setResponse(200, RESPOSTA_XML('987654321098'));
    const client = new SdiCoopClient({ endpoint: stub.url, ca: stub.serverCertPem });

    const result = await client.submit({
      idTrasmittente: 'IT01234567890',
      xmlBytes: Buffer.from('<FatturaElettronica/>', 'utf-8'),
      filename: 'IT01234567890_0000000001.xml',
      certificate: clientPfxBase64,
      certificatePassword: CLIENT_PFX_PASSWORD,
    });

    expect(result.idSdI).toBe(987654321098);
    // THE proof this is genuine mTLS, not merely "some TLS handshake succeeded": the server verified
    // the presented certificate against the exact `ca` it was configured with, AND that certificate's
    // own CN is the one this test built — never a coincidental pass.
    expect(stub.lastPeer?.authorized).toBe(true);
    expect(stub.lastPeer?.commonName).toBe(CLIENT_CN);
  });

  it(
    'fails (named, never a silent success) with the WRONG passphrase, against a STRICT server ' +
      '(rejectUnauthorized: true — the realistic posture for a real AdE endpoint)',
    async () => {
      // A LENIENT server (the shared `stub` above) would still complete the handshake even with a
      // wrong passphrase — Node silently sends NO client certificate at all when pfx decryption fails,
      // rather than throwing, so a lenient server proves nothing here. A dedicated strict server is
      // started for this one test.
      const strictStub = await startStubServer(clientCert.certPem, { rejectUnauthorized: true });
      strictStub.setResponse(200, RESPOSTA_XML('987654321098'));
      try {
        const client = new SdiCoopClient({
          endpoint: strictStub.url,
          ca: strictStub.serverCertPem,
          timeoutMs: 5_000,
        });

        await expect(
          client.submit({
            idTrasmittente: 'IT01234567890',
            xmlBytes: Buffer.from('<FatturaElettronica/>', 'utf-8'),
            filename: 'IT01234567890_0000000001.xml',
            certificate: clientPfxBase64,
            certificatePassword: 'definitely-the-wrong-password',
          }),
        ).rejects.toThrow(/SdI SOAP request failed/);
      } finally {
        await strictStub.close();
      }
    },
  );

  it('surfaces a SOAP Fault from the real server as a named SOAP_FAULT failure', async () => {
    stub.setResponse(500, SOAP_FAULT_XML);
    const client = new SdiCoopClient({ endpoint: stub.url, ca: stub.serverCertPem });

    await expect(
      client.submit({
        idTrasmittente: 'IT01234567890',
        xmlBytes: Buffer.from('<FatturaElettronica/>', 'utf-8'),
        filename: 'IT01234567890_0000000001.xml',
        certificate: clientPfxBase64,
        certificatePassword: CLIENT_PFX_PASSWORD,
      }),
    ).rejects.toThrow(/SOAP Fault/);
  });

  it(
    'MUTATION TARGET #1, end-to-end through the real transport — a response with no usable ' +
      'IdentificativoSdI fails the call rather than resolving',
    async () => {
      stub.setResponse(200, MALFORMED_XML_NO_REFERENCE);
      const client = new SdiCoopClient({ endpoint: stub.url, ca: stub.serverCertPem });

      await expect(
        client.submit({
          idTrasmittente: 'IT01234567890',
          xmlBytes: Buffer.from('<FatturaElettronica/>', 'utf-8'),
          filename: 'IT01234567890_0000000001.xml',
          certificate: clientPfxBase64,
          certificatePassword: CLIENT_PFX_PASSWORD,
        }),
      ).rejects.toThrow(/neither a usable IdentificativoSdI/);
    },
  );

  it('getStatus()/sendEsito() are honest, named non-implementations — SDICoop trasmittente has neither', async () => {
    const client = new SdiCoopClient({ endpoint: stub.url, ca: stub.serverCertPem });
    await expect(client.getStatus(0, 'IT01234567890')).rejects.toThrow(/no polling operation/);
    await expect(client.sendEsito(0, 'IT01234567890', 'EC01')).rejects.toThrow(/RECEPTION-side/);
  });
});
