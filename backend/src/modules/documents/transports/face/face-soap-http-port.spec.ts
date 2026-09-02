/**
 * `FaceSoapHttpPort` (`../face-transport.ts`) against a REAL local HTTPS server — no mocks of
 * `node:https`, the SAME "no crypto maison, real behaviour" discipline `sdicoop-client.spec.ts`
 * already establishes for SdI's own SOAP client (its own `startStubServer`/`generateSelfSignedCert`
 * shape is mirrored here). This is the ONE place that proves the ACTUAL bytes written to the wire —
 * `face-transport.spec.ts` mocks `FaceClient` wholesale, so it can prove the ORCHESTRATION (which
 * cert gets resolved, when `send()` refuses) but never the envelope itself.
 *
 * DoD:
 *  - No `wsseCertificate` configured → the envelope on the wire is UNSIGNED, byte-identical in shape
 *    to what `FaceSoapHttpPort` sent before this task (regression — a caller that has not been
 *    updated, or FACe channels with no signing cert resolved, keep working exactly as before).
 *  - A `wsseCertificate` IS configured → the envelope on the wire carries a real, independently
 *    re-verifiable WS-Security signature (`wsse-sign.ts#verifyWsseSignature`).
 *  - MUTATION GUARD #2 (this task's own) — "l'enveloppe part non signée malgré un certificat
 *    présent": demonstrated against THIS spec by literally mutating `FaceSoapHttpPort.post()` to
 *    always build the unsigned envelope (see this task's own report for the before/after run).
 */
import * as forge from 'node-forge';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';

import { FaceSoapHttpPort } from '../face-transport';
import { WsseCertificate, verifyWsseSignature } from './wsse-sign';

// ---------------------------------------------------------------------------
// In-memory self-signed server cert — same shape/reasoning as
// `sdi/sdicoop-client.spec.ts#generateSelfSignedCert` (never a real certificate committed).
// ---------------------------------------------------------------------------
function generateServerCert(): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [
    { name: 'commonName', value: 'Test FACe SSPP Stub' },
    { name: 'countryName', value: 'ES' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  // A SAN matching 127.0.0.1 — required by Node's TLS client even against a trusted `ca` (the SAME
  // gotcha `sdicoop-client.spec.ts`'s own header names).
  cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

function generateWsseCert(): WsseCertificate {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'Invoicerr Test Company' },
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

interface StubServer {
  url: string;
  serverCertPem: string;
  lastBody: string | undefined;
  close(): Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const { certPem, keyPem } = generateServerCert();
  const state: StubServer = {
    url: '',
    serverCertPem: certPem,
    lastBody: undefined,
    close: () => Promise.resolve(),
  };
  const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      state.lastBody = Buffer.concat(chunks).toString('utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/xml; charset=utf-8');
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soapenv:Body><soapenv:Fault><faultcode>500</faultcode>' +
          '<faultstring>stub — not a real SSPP</faultstring></soapenv:Fault></soapenv:Body>' +
          '</soapenv:Envelope>',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  state.url = `https://127.0.0.1:${port}/facturasspp2`;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}

const OPERATION_BODY =
  '<web:enviarFactura xmlns:web="https://webservice.face.gob.es">' +
  '<request><correo>facturacion@empresa.es</correo></request>' +
  '</web:enviarFactura>';

describe('FaceSoapHttpPort — real local HTTPS server, no mocks', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  it('REGRESSION — with no wsseCertificate, the envelope on the wire is UNSIGNED (pre-task shape)', async () => {
    const port = new FaceSoapHttpPort(undefined, undefined, undefined, undefined, stub.serverCertPem);

    const res = await port.post(stub.url, 'enviarFactura', OPERATION_BODY);

    expect(res.status).toBe(200);
    expect(stub.lastBody).toBeDefined();
    expect(stub.lastBody).not.toContain('wsse:Security');
    expect(stub.lastBody).not.toContain('ds:Signature');
    expect(stub.lastBody).toContain(OPERATION_BODY);
    expect(stub.lastBody).toContain('<soapenv:Envelope');
  });

  it('with a wsseCertificate, the envelope on the wire carries a genuine, re-verifiable WS-Security signature', async () => {
    const cert = generateWsseCert();
    const port = new FaceSoapHttpPort(undefined, undefined, undefined, cert, stub.serverCertPem);

    await port.post(stub.url, 'enviarFactura', OPERATION_BODY);

    expect(stub.lastBody).toContain('wsse:Security');
    expect(stub.lastBody).toContain('wsse:BinarySecurityToken');
    expect(stub.lastBody).toContain(OPERATION_BODY);

    const verified = await verifyWsseSignature(stub.lastBody!);
    expect(verified.referencesBody).toBe(true);
    expect(verified.bodyDigestMatches).toBe(true);
    expect(verified.signatureValid).toBe(true);
  });

  it('a Fault response is still parsed (status + raw body returned) regardless of signing', async () => {
    const port = new FaceSoapHttpPort(undefined, undefined, undefined, undefined, stub.serverCertPem);

    const res = await port.post(stub.url, 'enviarFactura', OPERATION_BODY);

    expect(res.status).toBe(200);
    expect(res.data).toContain('stub — not a real SSPP');
  });
});
