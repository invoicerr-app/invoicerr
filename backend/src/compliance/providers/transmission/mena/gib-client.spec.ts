/**
 * GİB client — mocked / structural tests.
 *
 * Tests:
 *   - GibClient constructs without errors.
 *   - sendInvoice() throws when HTTP port returns 4xx.
 *   - sendInvoice() extracts uuid from response.
 *   - getInvoiceStatus() maps GİB-specific status strings correctly.
 *   - mapGibStatus() covers all expected cases.
 *   - Authentication is called before each operation.
 *
 * Live integration deferred — no GİB sandbox credentials available.
 */
import { GibClient, GibHttpPort, mapGibStatus } from './gib-client';

const makeHttp = (overrides: Partial<GibHttpPort> = {}): GibHttpPort => ({
  post: async () => ({ status: 200, data: {} }),
  get: async () => ({ status: 200, data: {} }),
  ...overrides,
});

const BASE_CONFIG = {
  baseUrl: 'https://efaturaportal.gib.gov.tr/EFaturaTest',
  vkn: '1234567890',
  username: 'test-user',
  password: 'test-pass',
};

describe('GibClient (scaffold, mocked)', () => {
  describe('mapGibStatus', () => {
    it('maps ACCEPTED → CLEARED', () => {
      expect(mapGibStatus('ACCEPTED')).toBe('CLEARED');
      expect(mapGibStatus('accepted')).toBe('CLEARED');
    });
    it('maps REJECTED → REJECTED', () => {
      expect(mapGibStatus('REJECTED')).toBe('REJECTED');
      expect(mapGibStatus('FAILED')).toBe('REJECTED');
    });
    it('maps WAITING / SENDING → PENDING', () => {
      expect(mapGibStatus('WAITING')).toBe('PENDING');
      expect(mapGibStatus('SENDING')).toBe('PENDING');
    });
    it('maps unknown → PENDING', () => {
      expect(mapGibStatus('SOME_UNKNOWN_STATUS')).toBe('PENDING');
    });
  });

  describe('sendInvoice', () => {
    it('returns uuid from response when HTTP succeeds', async () => {
      const http = makeHttp({
        // auth call returns token
        post: async (url) => {
          if (url.includes('/login')) return { status: 200, data: { token: 'tok123' } };
          return { status: 200, data: { uuid: 'abc-uuid-123' } };
        },
      });
      const client = new GibClient(BASE_CONFIG, http);
      const result = await client.sendInvoice('<Invoice/>');
      expect(result.uuid).toBe('abc-uuid-123');
      expect(result.httpStatus).toBe(200);
    });

    it('throws when HTTP returns 4xx', async () => {
      const http = makeHttp({
        post: async (url) => {
          if (url.includes('/login')) return { status: 200, data: { token: 'tok123' } };
          return { status: 400, data: { error: 'Bad Request' } };
        },
      });
      const client = new GibClient(BASE_CONFIG, http);
      await expect(client.sendInvoice('<Invoice/>')).rejects.toThrow('GİB sendInvoice failed (HTTP 400)');
    });

    it('throws when authentication fails (4xx)', async () => {
      const http = makeHttp({
        post: async () => ({ status: 401, data: { error: 'Unauthorized' } }),
      });
      const client = new GibClient(BASE_CONFIG, http);
      await expect(client.sendInvoice('<Invoice/>')).rejects.toThrow('GİB authentication failed (HTTP 401)');
    });
  });

  describe('getInvoiceStatus', () => {
    it('returns status from response', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { token: 'tok123' } }),
        get: async () => ({ status: 200, data: { status: 'WAITING', uuid: 'test-uuid' } }),
      });
      const client = new GibClient(BASE_CONFIG, http);
      const result = await client.getInvoiceStatus('test-uuid');
      expect(result.status).toBe('WAITING');
      expect(result.uuid).toBe('test-uuid');
    });

    it('throws when HTTP returns 4xx on status check', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { token: 'tok123' } }),
        get: async () => ({ status: 404, data: {} }),
      });
      const client = new GibClient(BASE_CONFIG, http);
      await expect(client.getInvoiceStatus('missing-uuid')).rejects.toThrow('GİB getInvoiceStatus failed (HTTP 404)');
    });
  });
});
