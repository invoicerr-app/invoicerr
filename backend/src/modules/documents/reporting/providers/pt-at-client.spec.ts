/**
 * `pt-at-client.ts`'s own wire-level pieces — proves the STRUCTURE this client builds (the
 * WS-Security header's four fields exist, are base64-well-formed, and actually decrypt back to what
 * was encrypted; the right endpoint is picked per environment; a `RegisterInvoiceResponse` parses
 * into the right `CodigoResposta`/`Mensagem`/`DataOperacao`). This NEVER asserts AT itself accepts any
 * of it — see `pt-at-client.ts`'s own header, "implemented to the documented AT contract, awaiting
 * accreditation": a live round-trip (`pt-declaration-provider.live.spec.ts`, gated `PT_AT_LIVE=1`) is
 * the only thing that could prove that.
 */
import {
  privateDecrypt,
  generateKeyPairSync,
  createDecipheriv,
  constants as cryptoConstants,
} from 'node:crypto';

import {
  AT_CODIGO_RESPOSTA_MEANINGS,
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

/** Decrypts what THIS client encrypted, using the matching private key — the same "the stub
 *  independently re-derives and checks" discipline `nav-declaration-provider.spec.ts#startNavStub`
 *  already holds for NAV's own `requestSignature`. Proves the round-trip is internally consistent
 *  (client encrypts with the public key exactly the way a real server would decrypt with the private
 *  half), never that AT's OWN key/padding expectations match — see `pt-at-client.ts`'s own header on
 *  the RSA padding scheme being ⚠ UNVERIFIED against a real AT key. */
function decryptNonce(nonceBase64: string): Buffer {
  return privateDecrypt(
    { key: AT_PRIVATE_KEY_PEM, padding: cryptoConstants.RSA_PKCS1_PADDING },
    Buffer.from(nonceBase64, 'base64'),
  );
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
