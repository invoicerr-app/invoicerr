/**
 * `pt-at-client.ts`'s own wire-level pieces — proves the STRUCTURE this client builds (the
 * WS-Security header's four fields exist, are base64-well-formed, and actually decrypt back to what
 * was encrypted; the right endpoint is picked per environment; a `RegisterInvoiceResponse` parses
 * into the right `CodigoResposta`/`Mensagem`/`DataOperacao`) PLUS, in the "mTLS" describe block below,
 * a REAL `node:https` handshake against a local self-signed stub — see that block's own header for
 * exactly what that proves and does not. Neither proves AT itself accepts any of it — see
 * `pt-at-client.ts`'s own header, "implemented to the documented AT contract, awaiting
 * accreditation": a live round-trip (`pt-declaration-provider.live.spec.ts`, gated `PT_AT_LIVE=1`) is
 * the only thing that could prove that.
 */
import * as forge from 'node-forge';
import {
  privateDecrypt,
  generateKeyPairSync,
  createDecipheriv,
  constants as cryptoConstants,
} from 'node:crypto';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';

import {
  AT_CODIGO_RESPOSTA_MEANINGS,
  buildPtAtClient,
  buildPtAtEnvelope,
  buildPtAtSecurityFields,
  describePtAtCodigoResposta,
  encryptPtAtAesField,
  encryptPtAtNonce,
  parsePtAtRegisterInvoiceResponse,
  PT_AT_PROD_BASE_URL,
  PT_AT_TEST_BASE_URL,
  PtAtCredentials,
  resolvePtAtBaseUrl,
} from './pt-at-client';

// A real RSA keypair, generated ONCE for this whole spec — stands in for the AT Sistema de
// Autenticação's own key pair (no real one was available — see `pt-at-client.ts`'s own header).
const { publicKey: AT_PUBLIC_KEY_PEM, privateKey: AT_PRIVATE_KEY_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const CREDENTIALS: PtAtCredentials = {
  username: '599999993/37',
  password: 'correct horse battery staple',
  authPublicKeyPem: AT_PUBLIC_KEY_PEM,
  clientCertificateBase64: 'ZmFrZS1jZXJ0', // structural fixture only — see this file's own mTLS caveat
  clientCertificatePassword: 'fake-passphrase',
};

/**
 * Undoes RFC 8017's EME-PKCS1-v1_5 encoding (`00 02 <nonzero padding, ≥8 bytes> 00 <message>`) by
 * hand. Needed because Node disabled `privateDecrypt`'s own `RSA_PKCS1_PADDING` option as the
 * CVE-2023-46809 ("Marvin attack") mitigation — a timing side-channel in the PADDING-REMOVAL step when
 * decrypting ATTACKER-SUPPLIED ciphertext against a server's own key. Neither risk applies here: this
 * buffer is our OWN fixture (never attacker-controlled) and this call runs once per test with no
 * observer positioned to measure it. `RSA_NO_PADDING` — raw modular exponentiation, no padding
 * decision made or timed by Node at all — is untouched by that mitigation, so the two steps together
 * (raw decrypt, then this function) are the exact bytes `RSA_PKCS1_PADDING` decryption used to hand
 * back, checked against the standard by hand instead of trusting Node's now-disabled shortcut for it.
 * Verified against a real Node 20 build (the CI runner's own version) via `nvm`: decrypting a
 * `publicEncrypt(..., RSA_PKCS1_PADDING)` ciphertext this way recovers the exact original plaintext,
 * on the exact Node build where the guarded convenience path throws
 * "RSA_PKCS1_PADDING is no longer supported for private decryption".
 */
function unpadPkcs1v15(padded: Buffer): Buffer {
  if (padded[0] !== 0x00 || padded[1] !== 0x02) {
    throw new Error('not a valid PKCS#1 v1.5 EME block (bad leading 00 02)');
  }
  let i = 2;
  while (i < padded.length && padded[i] !== 0x00) i++;
  if (i >= padded.length) {
    throw new Error('PKCS#1 v1.5 padding never terminates with a 00 byte');
  }
  return padded.subarray(i + 1);
}

/** Decrypts what THIS client encrypted, using the matching private key — independently re-deriving
 *  the plaintext rather than merely re-reading what the client already believes it produced. Proves
 *  the round-trip is internally consistent (client encrypts with the public key exactly the way a real
 *  server would decrypt with the private half), never that AT's OWN key/padding expectations match —
 *  see `pt-at-client.ts`'s own header on the RSA padding scheme being ⚠ UNVERIFIED against a real AT
 *  key. Raw (`RSA_NO_PADDING`) decrypt + `unpadPkcs1v15` above, NOT `privateDecrypt`'s own
 *  `RSA_PKCS1_PADDING` option — see that function's own header for why this is the same check, not a
 *  weaker one. */
function decryptNonce(nonceBase64: string): Buffer {
  const raw = privateDecrypt(
    { key: AT_PRIVATE_KEY_PEM, padding: cryptoConstants.RSA_NO_PADDING },
    Buffer.from(nonceBase64, 'base64'),
  );
  return unpadPkcs1v15(raw);
}

function decryptAesField(fieldBase64: string, symmetricKey: Buffer): string {
  const decipher = createDecipheriv('aes-128-ecb', symmetricKey, null);
  return Buffer.concat([decipher.update(Buffer.from(fieldBase64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

describe('WS-Security header construction (Aspetos Genéricos §2.2.1) — round-trips against the matching private key', () => {
  it('Nonce decrypts back to the exact 16-byte symmetric key it was built from', () => {
    const symmetricKey = Buffer.from('0123456789ABCDEF', 'utf8'); // 16 bytes, deterministic fixture
    const nonce = encryptPtAtNonce(symmetricKey, AT_PUBLIC_KEY_PEM);

    expect(decryptNonce(nonce)).toEqual(symmetricKey);
  });

  it("Password/Created decrypt back to their exact plaintext with the Nonce's own symmetric key", () => {
    const symmetricKey = Buffer.from('FEDCBA9876543210', 'utf8');
    const password = encryptPtAtAesField(symmetricKey, 'correct horse battery staple');
    const created = encryptPtAtAesField(symmetricKey, '2026-09-11T10:00:00.000Z');

    expect(decryptAesField(password, symmetricKey)).toBe('correct horse battery staple');
    expect(decryptAesField(created, symmetricKey)).toBe('2026-09-11T10:00:00.000Z');
  });

  it('buildPtAtSecurityFields produces all four fields, each base64-well-formed, and they decrypt consistently end to end', () => {
    const symmetricKey = Buffer.from('AAAAAAAAAAAAAAAA', 'utf8');
    const now = new Date('2026-09-11T12:34:56.789Z');

    const fields = buildPtAtSecurityFields(CREDENTIALS, now, symmetricKey);

    expect(fields.username).toBe(CREDENTIALS.username);
    for (const value of [fields.password, fields.nonce, fields.created]) {
      expect(value.length).toBeGreaterThan(0);
      expect(() => Buffer.from(value, 'base64')).not.toThrow();
      // A real base64 round-trip check (not just "didn't throw" — `Buffer.from` never throws on
      // arbitrary text, it just drops invalid characters silently).
      expect(Buffer.from(value, 'base64').toString('base64')).toBe(value);
    }

    const recoveredKey = decryptNonce(fields.nonce);
    expect(recoveredKey).toEqual(symmetricKey);
    expect(decryptAesField(fields.password, recoveredKey)).toBe(CREDENTIALS.password);
    expect(decryptAesField(fields.created, recoveredKey)).toBe(now.toISOString());
  });

  it('two calls never reuse the same Nonce/symmetric key — "não pode ser repetida" (§2.2.1, H.3)', () => {
    const first = buildPtAtSecurityFields(CREDENTIALS);
    const second = buildPtAtSecurityFields(CREDENTIALS);
    expect(first.nonce).not.toBe(second.nonce);
  });
});

describe("buildPtAtEnvelope — matches the worked SOAP example's own structure (Aspetos Específicos §2.1.1.3)", () => {
  it('produces an S:Envelope with a WS-Security S:Header and a doc:RegisterInvoiceRequest S:Body', () => {
    const symmetricKey = Buffer.from('BBBBBBBBBBBBBBBB', 'utf8');
    const xml = buildPtAtEnvelope(
      CREDENTIALS,
      { 'doc:TaxRegistrationNumber': '222222222' },
      new Date('2026-09-11T00:00:00.000Z'),
      symmetricKey,
    );

    expect(xml).toContain('<S:Envelope');
    expect(xml).toContain('xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"');
    expect(xml).toContain('<wss:Security');
    expect(xml).toContain('xmlns:wss="http://schemas.xmlsoap.org/ws/2002/12/secext"');
    expect(xml).toContain('<wss:UsernameToken>');
    expect(xml).toContain(`<wss:Username>${CREDENTIALS.username}</wss:Username>`);
    expect(xml).toMatch(/<wss:Password>[^<]+<\/wss:Password>/);
    expect(xml).toMatch(/<wss:Nonce>[^<]+<\/wss:Nonce>/);
    expect(xml).toMatch(/<wss:Created>[^<]+<\/wss:Created>/);
    expect(xml).toContain('<doc:RegisterInvoiceRequest');
    expect(xml).toContain('xmlns:doc="http://factemi.at.min_financas.pt/documents"');
    expect(xml).toContain('<doc:TaxRegistrationNumber>222222222</doc:TaxRegistrationNumber>');
  });
});

describe('resolvePtAtBaseUrl — environment-based endpoint selection (Aspetos Genéricos §3.7)', () => {
  it('TEST resolves to the non-standard port 723 test endpoint', () => {
    expect(resolvePtAtBaseUrl('TEST')).toBe(PT_AT_TEST_BASE_URL);
    expect(resolvePtAtBaseUrl('TEST')).toContain(':723/');
  });

  it('PROD resolves to the non-standard port 423 production endpoint', () => {
    expect(resolvePtAtBaseUrl('PROD')).toBe(PT_AT_PROD_BASE_URL);
    expect(resolvePtAtBaseUrl('PROD')).toContain(':423/');
  });

  it('an explicit override always wins, regardless of environment', () => {
    expect(resolvePtAtBaseUrl('PROD', 'http://127.0.0.1:9999/stub')).toBe('http://127.0.0.1:9999/stub');
  });
});

describe('parsePtAtRegisterInvoiceResponse — RegisterInvoiceResponse (Aspetos Específicos §2.1.1.2)', () => {
  it('parses a success response (CodigoResposta 0)', () => {
    const xml =
      '<RegisterInvoiceResponse xmlns="http://factemi.at.min_financas.pt/documents">' +
      '<CodigoResposta>0</CodigoResposta><Mensagem>Operação efetuada com sucesso.</Mensagem>' +
      '<DataOperacao>2026-09-11T10:00:00</DataOperacao></RegisterInvoiceResponse>';

    const result = parsePtAtRegisterInvoiceResponse(xml);

    expect(result.codigoResposta).toBe(0);
    expect(result.mensagem).toBe('Operação efetuada com sucesso.');
    expect(result.dataOperacao).toBe('2026-09-11T10:00:00');
  });

  it('parses a document-level rejection (a negative CodigoResposta, e.g. -7)', () => {
    const xml =
      '<RegisterInvoiceResponse xmlns="http://factemi.at.min_financas.pt/documents">' +
      '<CodigoResposta>-7</CodigoResposta><Mensagem>Documento inválido por valores anómalos.</Mensagem>' +
      '<DataOperacao>2026-09-11T10:00:01</DataOperacao></RegisterInvoiceResponse>';

    const result = parsePtAtRegisterInvoiceResponse(xml);

    expect(result.codigoResposta).toBe(-7);
    expect(describePtAtCodigoResposta(result.codigoResposta)).toBe(AT_CODIGO_RESPOSTA_MEANINGS['-7']);
  });

  it('parses an authentication-layer rejection (a positive CodigoResposta, e.g. 99)', () => {
    const xml =
      '<RegisterInvoiceResponse xmlns="http://factemi.at.min_financas.pt/documents">' +
      '<CodigoResposta>99</CodigoResposta>' +
      '<Mensagem>Erro na validação da senha (Senha errada, acesso suspenso, etc.).</Mensagem>' +
      '<DataOperacao>2026-09-11T10:00:02</DataOperacao></RegisterInvoiceResponse>';

    const result = parsePtAtRegisterInvoiceResponse(xml);

    expect(result.codigoResposta).toBe(99);
  });

  it("is namespace/prefix agnostic — a differently-prefixed response still parses (see this file's own header on the EXTRAPOLATED response tag shape)", () => {
    const xml =
      '<doc:RegisterInvoiceResponse xmlns:doc="http://factemi.at.min_financas.pt/documents">' +
      '<doc:CodigoResposta>0</doc:CodigoResposta></doc:RegisterInvoiceResponse>';

    expect(parsePtAtRegisterInvoiceResponse(xml).codigoResposta).toBe(0);
  });

  it('a response with no CodigoResposta at all is refused, named, never treated as a silent success', () => {
    const xml = '<RegisterInvoiceResponse><Mensagem>huh</Mensagem></RegisterInvoiceResponse>';
    expect(() => parsePtAtRegisterInvoiceResponse(xml)).toThrow(/no CodigoResposta/);
  });

  it('malformed XML is refused, named', () => {
    expect(() => parsePtAtRegisterInvoiceResponse('<not-xml')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mTLS — REAL node:https handshake against a local self-signed stub.
//
// This is the ONE thing this file's own standing "no real AT certificate exists, so mTLS is not
// wired" caveat could be tested despite — never by fabricating one AT would accept (impossible from
// this machine), but by proving the WIRING: that `buildPtAtClient`'s configured PKCS#12 really reaches
// the TLS handshake, that a missing/wrong certificate really fails, and that a bad passphrase really
// fails loudly. What this can NEVER prove is that the real AT accepts OUR specific production
// certificate — see `pt-at-client.ts`'s own header, "mTLS" bullet, for that line drawn explicitly.
//
// Certs are generated in-memory with `node-forge`, the exact shape
// `transports/sdi/sdicoop-client.spec.ts#generateSelfSignedCert`/`buildClientPfx` already use for the
// identical "no real certificate is ever committed" reasoning — never openssl-on-disk, so there is no
// throwaway file to clean up and no dependency on an `openssl` binary being present in CI.
// ---------------------------------------------------------------------------

interface GeneratedCert {
  certPem: string;
  keyPem: string;
  cert: forge.pki.Certificate;
  keys: forge.pki.rsa.KeyPair;
}

function generateSelfSignedCert(commonName: string, opts: { subjectAltIp?: string } = {}): GeneratedCert {
  // 2048, not 1024: a REAL TLS handshake is negotiated below — modern OpenSSL's default security
  // level rejects a 1024-bit key for a live handshake ("ee key too small"), the same discovery
  // `sdicoop-client.spec.ts`'s own `generateSelfSignedCert` already documents.
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
 *  `clientCertificateBase64` carries. */
function buildClientPfx(clientCert: GeneratedCert, password: string): string {
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(clientCert.keys.privateKey, [clientCert.cert], password);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary').toString('base64');
}

interface StubServer {
  url: string;
  serverCertPem: string;
  close(): Promise<void>;
  /** The last request's peer certificate CN, and whether Node itself verified it against the `ca` this
   *  server was configured with — set by the handler right before it responds. `undefined` when the
   *  TLS handshake never reached the request handler at all (the no-certificate case). */
  lastPeer: { authorized: boolean; commonName: string | undefined } | undefined;
  setResponse(status: number, body: string): void;
}

/** A local, self-signed, mTLS-REQUIRING HTTPS server standing in for the AT `fatcorews` endpoint.
 *  `requestCert: true, rejectUnauthorized: true` — exactly the posture this task's own brief asks for,
 *  and the realistic posture for a real government endpoint (a LENIENT server would still complete
 *  the handshake with no/a wrong certificate, proving nothing about either failure mode below). */
async function startStubServer(clientCertPem: string): Promise<StubServer> {
  const server0 = generateSelfSignedCert('Test AT fatcorews Stub', { subjectAltIp: '127.0.0.1' });
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
      requestCert: true,
      rejectUnauthorized: true,
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
  state.url = `https://127.0.0.1:${port}/fatcorews/ws/`;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}

const REGISTER_INVOICE_RESPONSE_XML = (codigoResposta: number) =>
  '<RegisterInvoiceResponse xmlns="http://factemi.at.min_financas.pt/documents">' +
  `<CodigoResposta>${codigoResposta}</CodigoResposta>` +
  '<Mensagem>Operação efetuada com sucesso.</Mensagem>' +
  '<DataOperacao>2026-09-19T10:00:00</DataOperacao></RegisterInvoiceResponse>';

describe('buildPtAtClient — mTLS against a local stub server (node:https, requestCert+rejectUnauthorized)', () => {
  const CLIENT_CN = 'Test Invoicerr Subutilizador';
  const CLIENT_PFX_PASSWORD = 'test-pfx-password-not-real';
  let clientCert: GeneratedCert;
  let clientPfxBase64: string;
  let stub: StubServer;

  beforeAll(async () => {
    clientCert = generateSelfSignedCert(CLIENT_CN);
    clientPfxBase64 = buildClientPfx(clientCert, CLIENT_PFX_PASSWORD);
    stub = await startStubServer(clientCert.certPem);
  });

  afterAll(async () => {
    await stub.close();
  });

  function credentialsWith(overrides: Partial<PtAtCredentials>): PtAtCredentials {
    return {
      username: '599999993/37',
      password: 'correct horse battery staple',
      authPublicKeyPem: AT_PUBLIC_KEY_PEM,
      clientCertificateBase64: clientPfxBase64,
      clientCertificatePassword: CLIENT_PFX_PASSWORD,
      ...overrides,
    };
  }

  it('1. a request carrying the correct PKCS#12 and passphrase completes, and the server SEES the client certificate', async () => {
    stub.setResponse(200, REGISTER_INVOICE_RESPONSE_XML(0));
    const client = buildPtAtClient(credentialsWith({}), stub.url, { ca: stub.serverCertPem });

    const result = await client.registerInvoice({ 'doc:TaxRegistrationNumber': '222222222' });

    expect(result.codigoResposta).toBe(0);
    // THE proof this is genuine mTLS, not merely "some TLS handshake succeeded": the server verified
    // the presented certificate against the exact `ca` it was configured with, AND that certificate's
    // own CN is the one this test built — never a coincidental pass.
    expect(stub.lastPeer?.authorized).toBe(true);
    expect(stub.lastPeer?.commonName).toBe(CLIENT_CN);
  });

  it('2. a request with NO certificate is rejected at the TLS layer, with a clear error naming the cause — never a generic socket hang-up', async () => {
    // No `clientCertificateBase64` at all — `buildPtAtClient` then presents no `pfx`, so the strict
    // stub server (`rejectUnauthorized: true`) refuses the TLS handshake itself, before the request
    // handler (and therefore `stub.lastPeer`) is ever reached.
    const client = buildPtAtClient(
      credentialsWith({ clientCertificateBase64: undefined, clientCertificatePassword: undefined }),
      stub.url,
      { ca: stub.serverCertPem },
    );

    await expect(client.registerInvoice({ 'doc:TaxRegistrationNumber': '222222222' })).rejects.toThrow(
      // OpenSSL's own TLS alert for "no client certificate presented to a server that required one" —
      // e.g. "certificate required" (TLS 1.3) — surfaced verbatim inside this client's own
      // "AT mTLS/HTTPS request failed: …" wrapper (`postPtAtSoap`'s `req.on('error', …)`), never
      // collapsed into an undiagnosable bare "socket hang up".
      /AT mTLS\/HTTPS request failed:.*certificate/i,
    );
  });

  it('3. a wrong passphrase throws synchronously at agent construction, and is caught with an error naming the cause', async () => {
    // The WRONG passphrase against the client's OWN correct PKCS#12 — Node parses `pfx`/`passphrase`
    // into a TLS secure context SYNCHRONOUSLY as part of `https.request()` itself (see
    // `postPtAtSoap`'s own header comment), throwing "mac verify failure" before any socket is even
    // opened — proven here by pointing at the SAME strict stub the other two cases use and observing
    // the identical, immediate failure regardless of whether the stub is even reachable.
    const client = buildPtAtClient(
      credentialsWith({ clientCertificatePassword: 'definitely-the-wrong-password' }),
      stub.url,
      { ca: stub.serverCertPem },
    );

    await expect(client.registerInvoice({ 'doc:TaxRegistrationNumber': '222222222' })).rejects.toThrow(
      /AT mTLS\/HTTPS request failed:.*mac verify failure/i,
    );
  });

  it('4. a genuinely corrupt PKCS#12 archive fails the exact same synchronous way as a wrong passphrase', async () => {
    const client = buildPtAtClient(
      credentialsWith({ clientCertificateBase64: Buffer.from('not a pkcs12 archive').toString('base64') }),
      stub.url,
      { ca: stub.serverCertPem },
    );

    await expect(client.registerInvoice({ 'doc:TaxRegistrationNumber': '222222222' })).rejects.toThrow(
      /AT mTLS\/HTTPS request failed:/,
    );
  });
});
