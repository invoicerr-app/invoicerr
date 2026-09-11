/**
 * `buildPtAtDeclarationProvider` against a REAL local HTTP stub standing in for the AT webservice —
 * same "never an in-process mock of the HTTP layer" discipline `nav-declaration-provider.spec.ts`/
 * `mydata-declaration-provider.spec.ts` already hold: this proves the FULL flow (WS-Security header
 * construction → HTTP POST → response parsing → `DeclarationResult` shaping), with the stub itself
 * independently RE-DECRYPTING the Nonce/Password/Created fields server-side (the same "the stub
 * checks it, not just the client's own internal consistency" discipline `nav-declaration-provider.
 * spec.ts#startNavStub` already holds for NAV's own requestSignature) — never that AT itself accepts
 * any of this, see `pt-at-client.ts`'s own header.
 */
import * as http from 'node:http';
import {
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  constants as cryptoConstants,
} from 'node:crypto';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError, DeclaredInvoice } from '../declaration-provider';
import { buildPtAtDeclarationProvider, PT_AT_PROVIDER_ID } from './pt-declaration-provider';
import { PtAtApiError } from './pt-at-client';
import { firstByLocalName, parseXml, textOf } from '../../transports/sdi/xml-helpers';

const { publicKey: AT_PUBLIC_KEY_PEM, privateKey: AT_PRIVATE_KEY_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const CREDENTIALS = {
  username: '222222222/1',
  password: 'S3cretPFPassw0rd!',
  authPublicKeyPem: AT_PUBLIC_KEY_PEM,
  clientCertificateBase64: 'ZmFrZS1jZXJ0',
  clientCertificatePassword: 'fake-passphrase',
};

const FIXTURE_INVOICE: DeclaredInvoice = {
  documentId: 'doc-1',
  typeId: 'invoice',
  number: 'FT 1/1',
  issueDate: '2026-09-11',
  currency: 'EUR',
  seller: {
    name: 'Acme Lda.',
    countryCode: 'PT',
    vatNumber: 'PT222222222',
    legalId: undefined,
    address: 'Rua Principal 1',
    city: 'Lisboa',
    postalCode: '1000-001',
  },
  buyer: {
    name: 'Cliente Lda.',
    countryCode: 'PT',
    vatNumber: 'PT111111111',
    legalId: undefined,
    address: 'Avenida Central 2',
    city: 'Porto',
    postalCode: '4000-001',
  },
  lines: [
    {
      description: 'Serviço',
      quantity: 1,
      unitPrice: 100,
      vatRatePercent: 23,
      netAmount: 100,
      vatAmount: 23,
      grossAmount: 123,
    },
  ],
  netTotal: 100,
  vatTotal: 23,
  grossTotal: 123,
};

interface PtAtStub {
  baseUrl: string;
  close: () => Promise<void>;
  lastBody?: string;
  /** Set by the request handler once it has independently decrypted the WS-Security fields — see
   *  this file's own header. `undefined` if decryption itself failed (a real bug in the client's own
   *  construction would show up here, not just as an assertion on the outgoing XML shape). */
  lastDecrypted?: { username: string; password: string; created: string };
}

type StubScenario = 'success' | 'business-rejection' | 'auth-rejection';

function decryptField(base64: string, symmetricKey: Buffer): string {
  const decipher = createDecipheriv('aes-128-ecb', symmetricKey, null);
  return Buffer.concat([decipher.update(Buffer.from(base64, 'base64')), decipher.final()]).toString('utf8');
}

/** A real local server standing in for the AT `fatcorews` endpoint — decrypts the WS-Security fields
 *  with the matching AT private key (mirroring what a real AT server would do with its own private
 *  half of `authPublicKeyPem`) and returns a canned `RegisterInvoiceResponse` per `scenario`. */
function startPtAtStub(scenario: StubScenario = 'success'): Promise<PtAtStub> {
  return new Promise((resolvePromise, reject) => {
    const state: { lastBody?: string; lastDecrypted?: PtAtStub['lastDecrypted'] } = {};
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        state.lastBody = body;
        try {
          const { doc } = parseXml(body);
          const username = textOf(firstByLocalName(doc, 'Username')) ?? '';
          const nonceB64 = (textOf(firstByLocalName(doc, 'Nonce')) ?? '').replace(/\s+/g, '');
          const passwordB64 = textOf(firstByLocalName(doc, 'Password')) ?? '';
          const createdB64 = textOf(firstByLocalName(doc, 'Created')) ?? '';

          const symmetricKey = privateDecrypt(
            { key: AT_PRIVATE_KEY_PEM, padding: cryptoConstants.RSA_PKCS1_PADDING },
            Buffer.from(nonceB64, 'base64'),
          );
          state.lastDecrypted = {
            username,
            password: decryptField(passwordB64, symmetricKey),
            created: decryptField(createdB64, symmetricKey),
          };
        } catch {
          // Left undefined — a test asserting `lastDecrypted` would then fail loudly, which is the
          // point: a broken WS-Security construction must never pass silently.
        }

        res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' });
        if (scenario === 'business-rejection') {
          res.end(
            '<RegisterInvoiceResponse xmlns="http://factemi.at.min_financas.pt/documents">' +
              '<CodigoResposta>-7</CodigoResposta>' +
              '<Mensagem>Documento inválido por valores anómalos.</Mensagem>' +
              '<DataOperacao>2026-09-11T10:00:00</DataOperacao></RegisterInvoiceResponse>',
          );
          return;
        }
        if (scenario === 'auth-rejection') {
          res.end(
            '<RegisterInvoiceResponse xmlns="http://factemi.at.min_financas.pt/documents">' +
              '<CodigoResposta>99</CodigoResposta>' +
              '<Mensagem>Erro na validação da senha (Senha errada, acesso suspenso, etc.).</Mensagem>' +
              '<DataOperacao>2026-09-11T10:00:00</DataOperacao></RegisterInvoiceResponse>',
          );
          return;
        }
        res.end(
          '<RegisterInvoiceResponse xmlns="http://factemi.at.min_financas.pt/documents">' +
            '<CodigoResposta>0</CodigoResposta><Mensagem>Operação efetuada com sucesso.</Mensagem>' +
            '<DataOperacao>2026-09-11T10:00:00</DataOperacao></RegisterInvoiceResponse>',
        );
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('AT stub did not bind'));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
        get lastBody() {
          return state.lastBody;
        },
        get lastDecrypted() {
          return state.lastDecrypted;
        },
      });
    });
  });
}

function channelCredentialsFor(
  baseUrl: string,
  overrides: Record<string, unknown> = {},
): ChannelCredentialsService {
  return {
    resolveActive: jest.fn().mockResolvedValue({
      providerId: PT_AT_PROVIDER_ID,
      channel: 'PT_AT',
      environment: 'TEST',
      isActive: true,
      config: { ...CREDENTIALS, baseUrl, ...overrides },
    }),
  } as unknown as ChannelCredentialsService;
}

describe('buildPtAtDeclarationProvider — the full WS-Security → HTTP → RegisterInvoiceResponse flow', () => {
  let stub: PtAtStub;

  afterEach(async () => {
    await stub?.close();
  });

  it('declares successfully: ACCEPTED, with a non-empty SYNTHESIZED authorityId (never mistaken for an AT-minted one)', async () => {
    stub = await startPtAtStub('success');
    const provider = buildPtAtDeclarationProvider({
      channelCredentials: channelCredentialsFor(stub.baseUrl),
    });

    const result = await provider.declare('company-1', FIXTURE_INVOICE);

    expect(result.statusCode).toBe('ACCEPTED');
    expect(result.authorityId.length).toBeGreaterThan(0);
    // Synthesized, not authority-minted (see pt-declaration-provider.ts's own header) — this bridge's
    // OWN prefix makes that origin unmistakable in the raw event timeline.
    expect(result.authorityId).toMatch(/^pt-at-synth:/);
    expect(result.authorityId).toContain('FT_1_1'); // the invoice's own number, sanitized
    expect(result.rawPayload).toEqual(expect.objectContaining({ codigoResposta: 0 }));
  });

  it('the outgoing WS-Security header genuinely round-trips: the stub independently decrypts the real password/username', async () => {
    stub = await startPtAtStub('success');
    const provider = buildPtAtDeclarationProvider({
      channelCredentials: channelCredentialsFor(stub.baseUrl),
    });

    await provider.declare('company-1', FIXTURE_INVOICE);

    expect(stub.lastDecrypted?.username).toBe(CREDENTIALS.username);
    expect(stub.lastDecrypted?.password).toBe(CREDENTIALS.password);
    expect(stub.lastDecrypted?.created).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(stub.lastBody).toContain('<doc:RegisterInvoiceRequest');
    // The seller's own NIF, WITHOUT the "PT" prefix (see stripPtNifPrefix's own header).
    expect(stub.lastBody).toContain('<doc:TaxRegistrationNumber>222222222</doc:TaxRegistrationNumber>');
    expect(stub.lastBody).toContain('<doc:CustomerTaxID>111111111</doc:CustomerTaxID>');
  });

  it('a document-level rejection (CodigoResposta -7) returns REJECTED with the AT message as reason — never thrown', async () => {
    stub = await startPtAtStub('business-rejection');
    const provider = buildPtAtDeclarationProvider({
      channelCredentials: channelCredentialsFor(stub.baseUrl),
    });

    const result = await provider.declare('company-1', FIXTURE_INVOICE);

    expect(result.statusCode).toBe('REJECTED');
    expect(result.reason).toBe('Documento inválido por valores anómalos.');
    expect(result.authorityId.length).toBeGreaterThan(0);
    expect(result.rawPayload).toEqual(expect.objectContaining({ codigoResposta: -7 }));
  });

  it('an authentication-layer rejection (CodigoResposta 99) propagates as a named PtAtApiError, never a silent success', async () => {
    stub = await startPtAtStub('auth-rejection');
    const provider = buildPtAtDeclarationProvider({
      channelCredentials: channelCredentialsFor(stub.baseUrl),
    });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(PtAtApiError);
    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(/99/);
  });

  it('no pt-at channel connected: declare() throws ChannelNotConnectedError, never attempts an HTTP call', async () => {
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue(null),
    } as unknown as ChannelCredentialsService;
    const provider = buildPtAtDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(ChannelNotConnectedError);
  });

  it('an incomplete pt-at config (missing authPublicKeyPem) is treated the same as not connected', async () => {
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue({
        providerId: PT_AT_PROVIDER_ID,
        channel: 'PT_AT',
        environment: 'TEST',
        isActive: true,
        config: { username: 'x', password: 'y' },
      }),
    } as unknown as ChannelCredentialsService;
    const provider = buildPtAtDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(ChannelNotConnectedError);
  });

  it('an incomplete pt-at config (missing the mTLS client certificate) is ALSO treated as not connected', async () => {
    const channelCredentials = {
      resolveActive: jest.fn().mockResolvedValue({
        providerId: PT_AT_PROVIDER_ID,
        channel: 'PT_AT',
        environment: 'TEST',
        isActive: true,
        config: { username: 'x', password: 'y', authPublicKeyPem: AT_PUBLIC_KEY_PEM },
      }),
    } as unknown as ChannelCredentialsService;
    const provider = buildPtAtDeclarationProvider({ channelCredentials });

    await expect(provider.declare('company-1', FIXTURE_INVOICE)).rejects.toThrow(ChannelNotConnectedError);
  });
});
