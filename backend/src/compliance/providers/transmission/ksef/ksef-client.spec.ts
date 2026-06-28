import { generateKeyPairSync } from 'crypto';
import { KsefClient, KsefHttpClient, HttpRequest, HttpResponse } from './ksef-client';

// Generate test RSA keys for the client config
function genRsaKey(): string {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return pair.publicKey;
}

const RSA_KEY = genRsaKey();

/** Simple mock HTTP client that records requests and returns pre-configured responses. */
function mockHttp(handler: (req: HttpRequest) => HttpResponse): KsefHttpClient {
  return {
    request: jest.fn().mockImplementation(async (req: HttpRequest) => handler(req)),
  };
}

const TEST_CONFIG = {
  environment: 'test' as const,
  nip: '1234567890',
  ksefToken: 'test-ksef-token',
  tokenEncryptionKeyPem: RSA_KEY,
  symmetricKeyPem: RSA_KEY,
};

describe('KsefClient', () => {
  describe('authChallenge()', () => {
    it('POSTs to /auth/challenge', async () => {
      const http = mockHttp((req) => ({
        status: 200,
        body: { challenge: 'uuid-123', timestamp: '2026-01-01T00:00:00Z', timestampMs: 1735689600000, clientIp: '1.2.3.4' },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authChallenge();

      expect(result.challenge).toBe('uuid-123');
      expect(result.timestampMs).toBe(1735689600000);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', path: '/auth/challenge' }),
      );
    });
  });

  describe('authKsefToken()', () => {
    it('POSTs to /auth/ksef-token with NIP context identifier', async () => {
      const http = mockHttp((req) => ({
        status: 202,
        body: { referenceNumber: 'ref-456', authenticationToken: { token: 'auth-tok', validUntil: '2026-01-01T01:00:00Z' } },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authKsefToken('challenge-uuid', 1735689600000);

      expect(result.referenceNumber).toBe('ref-456');
      const body = (http.request as jest.Mock).mock.calls[0][0].body;
      expect(body.contextIdentifier).toEqual({ type: 'Nip', value: '1234567890' });
      expect(body.challenge).toBe('challenge-uuid');
      expect(typeof body.encryptedToken).toBe('string');
    });
  });

  describe('authStatus()', () => {
    it('GETs /auth/{ref} with Bearer token', async () => {
      const http = mockHttp(() => ({
        status: 200,
        body: { startDate: '2026-01-01T00:00:00Z', authenticationMethod: 'Token', status: { code: 200, description: 'OK' } },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authStatus('auth-ref', 'my-bearer-token');

      expect(result.status.code).toBe(200);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/auth/auth-ref',
          headers: { Authorization: 'Bearer my-bearer-token' },
        }),
      );
    });
  });

  describe('authRedeem()', () => {
    it('POSTs to /auth/token/redeem', async () => {
      const http = mockHttp(() => ({
        status: 200,
        body: {
          accessToken: { token: 'access', validUntil: '2026-01-01T00:10:00Z' },
          refreshToken: { token: 'refresh', validUntil: '2026-01-08T00:00:00Z' },
        },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authRedeem('auth-token');

      expect(result.accessToken.token).toBe('access');
      expect(result.refreshToken.token).toBe('refresh');
    });
  });

  describe('openOnlineSession()', () => {
    it('POSTs to /sessions/online with formCode and encryption', async () => {
      const http = mockHttp((req) => ({
        status: 201,
        body: { referenceNumber: 'session-ref', validUntil: '2026-01-01T12:00:00Z' },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.openOnlineSession('access-token');

      expect(result.referenceNumber).toBe('session-ref');
      const body = (http.request as jest.Mock).mock.calls[0][0].body;
      expect(body.formCode).toEqual({ systemCode: 'FA', schemaVersion: '1-0E', value: 'FA' });
      expect(body.encryption).toBeDefined();
      expect(typeof body.encryption.encryptedSymmetricKey).toBe('string');
      expect(typeof body.encryption.initializationVector).toBe('string');
    });
  });

  describe('sendInvoice()', () => {
    it('POSTs to /sessions/online/{ref}/invoices with hashes and encrypted content', async () => {
      const http = mockHttp((req) => ({
        status: 202,
        body: { referenceNumber: 'invoice-ref' },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const key = { aesKey: Buffer.alloc(32, 0x42), iv: Buffer.alloc(16, 0x24) };
      const result = await client.sendInvoice('session-ref', 'access-token', '<xml>test</xml>', key);

      expect(result.referenceNumber).toBe('invoice-ref');
      const body = (http.request as jest.Mock).mock.calls[0][0].body;
      expect(typeof body.invoiceHash).toBe('string');
      expect(typeof body.encryptedInvoiceHash).toBe('string');
      expect(typeof body.encryptedInvoiceContent).toBe('string');
      expect(body.invoiceSize).toBeGreaterThan(0);
      expect(body.encryptedInvoiceSize).toBeGreaterThan(0);
    });
  });

  describe('closeSession()', () => {
    it('POSTs to /sessions/online/{ref}/close', async () => {
      const http = mockHttp(() => ({ status: 204, body: undefined }));
      const client = new KsefClient(http, TEST_CONFIG);
      await client.closeSession('session-ref', 'access-token');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', path: '/sessions/online/session-ref/close' }),
      );
    });
  });

  describe('invoiceStatus()', () => {
    it('GETs /sessions/{sRef}/invoices/{iRef}', async () => {
      const http = mockHttp(() => ({
        status: 200,
        body: { ordinalNumber: 1, referenceNumber: 'inv-ref', invoiceHash: 'abc', invoicingDate: '2026-01-01', status: { code: 100, description: 'Accepted' } },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.invoiceStatus('session-ref', 'inv-ref', 'access-token');

      expect(result.status.code).toBe(100);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', path: '/sessions/session-ref/invoices/inv-ref' }),
      );
    });
  });

  describe('error handling', () => {
    it('throws KsefError on 4xx responses', async () => {
      const http = mockHttp(() => ({
        status: 450,
        body: { code: 450, message: 'Bad token' },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      await expect(client.authStatus('ref', 'token')).rejects.toThrow('KSeF API error 450');
    });
  });
});
