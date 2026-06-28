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
    it('POSTs to /auth/challenge with no body', async () => {
      const http = mockHttp((req) => ({
        status: 200,
        body: {
          challenge: '20260628-CR-2FDC223000-C2BFC98A9C-4E',
          timestamp: '2026-06-28T12:00:00.000Z',
          timestampMs: 1751112000000,
          clientIp: '1.2.3.4',
        },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authChallenge();

      expect(result.challenge).toBe('20260628-CR-2FDC223000-C2BFC98A9C-4E');
      expect(result.timestampMs).toBe(1751112000000);
      expect(result.clientIp).toBe('1.2.3.4');
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: expect.stringContaining('/auth/challenge'),
          body: undefined,
        }),
      );
    });
  });

  describe('authKsefToken()', () => {
    it('POSTs to /auth/ksef-token with NIP context identifier (returns 202)', async () => {
      const http = mockHttp((req) => ({
        status: 202,
        body: {
          referenceNumber: '20260628-AU-2FDC223000-C2BFC98A9C-4E',
          authenticationToken: { token: 'eyJhbGciOiJSUzI1NiJ9.auth-tok', validUntil: '2026-06-28T12:30:00.000Z' },
        },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authKsefToken('20260628-CR-2FDC223000-C2BFC98A9C-4E', 1751112000000);

      expect(result.referenceNumber).toBe('20260628-AU-2FDC223000-C2BFC98A9C-4E');
      expect(result.authenticationToken.token).toContain('eyJ');
      const body = (http.request as jest.Mock).mock.calls[0][0].body;
      expect(body.contextIdentifier).toEqual({ type: 'Nip', value: '1234567890' });
      expect(body.challenge).toBe('20260628-CR-2FDC223000-C2BFC98A9C-4E');
      expect(typeof body.encryptedToken).toBe('string');
      expect(body.encryptedToken.length).toBeGreaterThan(0);
    });
  });

  describe('authStatus()', () => {
    it('GETs /auth/{ref} with Bearer token', async () => {
      const http = mockHttp(() => ({
        status: 200,
        body: {
          startDate: '2026-06-28T12:00:00.000Z',
          authenticationMethod: 'Token',
          authenticationMethodInfo: { category: 'Token', code: 'token', displayName: 'Token KSeF' },
          status: { code: 200, description: 'Uwierzytelnianie zakończone sukcesem' },
          isTokenRedeemed: false,
        },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authStatus('20260628-AU-123', 'my-bearer-token');

      expect(result.status.code).toBe(200);
      expect(result.authenticationMethodInfo?.category).toBe('Token');
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: expect.stringContaining('/auth/20260628-AU-123'),
          headers: { Authorization: 'Bearer my-bearer-token' },
        }),
      );
    });

    it('returns code 100 when auth is still in progress', async () => {
      const http = mockHttp(() => ({
        status: 200,
        body: {
          startDate: '2026-06-28T12:00:00.000Z',
          authenticationMethod: 'Token',
          status: { code: 100, description: 'Uwierzytelnianie w toku' },
        },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authStatus('ref', 'token');
      expect(result.status.code).toBe(100);
    });
  });

  describe('authRedeem()', () => {
    it('POSTs to /auth/token/redeem with no body', async () => {
      const http = mockHttp(() => ({
        status: 200,
        body: {
          accessToken: { token: 'access-jwt', validUntil: '2026-06-28T12:10:00.000Z' },
          refreshToken: { token: 'refresh-jwt', validUntil: '2026-07-05T12:00:00.000Z' },
        },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.authRedeem('auth-token');

      expect(result.accessToken.token).toBe('access-jwt');
      expect(result.refreshToken.token).toBe('refresh-jwt');
      const req = (http.request as jest.Mock).mock.calls[0][0];
      expect(req.body).toBeUndefined();
      expect(req.headers).toEqual({ Authorization: 'Bearer auth-token' });
    });
  });

  describe('openOnlineSession()', () => {
    it('POSTs to /sessions/online with formCode and encryption (returns 201)', async () => {
      const http = mockHttp((req) => ({
        status: 201,
        body: { referenceNumber: '20260628-SN-ABCDEF1234-567890AB-CDEF', validUntil: '2026-06-28T14:00:00.000Z' },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const key = { aesKey: Buffer.alloc(32, 0x42), iv: Buffer.alloc(16, 0x24) };
      const result = await client.openOnlineSession('access-token', key);

      expect(result.referenceNumber).toBe('20260628-SN-ABCDEF1234-567890AB-CDEF');
      const body = (http.request as jest.Mock).mock.calls[0][0].body;
      expect(body.formCode).toEqual({ systemCode: 'FA (2)', schemaVersion: '1-0E', value: 'FA' });
      expect(body.encryption).toBeDefined();
      expect(typeof body.encryption.encryptedSymmetricKey).toBe('string');
      // The IV sent at session open MUST be the caller's key IV (same key reused for sendInvoice).
      expect(body.encryption.initializationVector).toBe(key.iv.toString('base64'));
    });
  });

  describe('sendInvoice()', () => {
    it('POSTs to /sessions/online/{ref}/invoices with 5 required fields (returns 202)', async () => {
      const http = mockHttp((req) => ({
        status: 202,
        body: { referenceNumber: '20260628-IN-INV123456-ABCDEF01-23' },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const key = { aesKey: Buffer.alloc(32, 0x42), iv: Buffer.alloc(16, 0x24) };
      const result = await client.sendInvoice('session-ref', 'access-token', '<xml>test</xml>', key);

      expect(result.referenceNumber).toBe('20260628-IN-INV123456-ABCDEF01-23');
      const body = (http.request as jest.Mock).mock.calls[0][0].body;
      expect(typeof body.invoiceHash).toBe('string');
      expect(typeof body.encryptedInvoiceHash).toBe('string');
      expect(typeof body.encryptedInvoiceContent).toBe('string');
      expect(body.invoiceSize).toBeGreaterThan(0);
      expect(body.encryptedInvoiceSize).toBeGreaterThan(0);
    });
  });

  describe('closeSession()', () => {
    it('POSTs to /sessions/online/{ref}/close with no body (returns 204)', async () => {
      const http = mockHttp(() => ({ status: 204, body: undefined }));
      const client = new KsefClient(http, TEST_CONFIG);
      await client.closeSession('session-ref', 'access-token');

      const req = (http.request as jest.Mock).mock.calls[0][0];
      expect(req.method).toBe('POST');
      expect(req.path).toContain('/sessions/online/session-ref/close');
      expect(req.body).toBeUndefined();
    });
  });

  describe('invoiceStatus()', () => {
    it('GETs /sessions/{sRef}/invoices/{iRef} with full status shape', async () => {
      const http = mockHttp(() => ({
        status: 200,
        body: {
          ordinalNumber: 1,
          referenceNumber: 'inv-ref',
          invoiceHash: 'abc123==',
          invoicingDate: '2026-06-28T00:00:00.000Z',
          status: { code: 200, description: 'Sukces' },
          ksefNumber: '20260628-FA-123456789-20260628-1A2B3C-DEF456-78',
          invoiceNumber: 'FV/2026/001',
        },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      const result = await client.invoiceStatus('session-ref', 'inv-ref', 'access-token');

      expect(result.status.code).toBe(200);
      expect(result.ksefNumber).toBe('20260628-FA-123456789-20260628-1A2B3C-DEF456-78');
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', path: expect.stringContaining('/sessions/session-ref/invoices/inv-ref') }),
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

    it('throws KsefError on 500 responses', async () => {
      const http = mockHttp(() => ({
        status: 500,
        body: { code: 500, message: 'Internal error' },
      }));
      const client = new KsefClient(http, TEST_CONFIG);
      await expect(client.authChallenge()).rejects.toThrow('KSeF API error 500');
    });
  });
});
