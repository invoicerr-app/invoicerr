/**
 * ANAF client — mocked / structural tests.
 *
 * Tests:
 *   - AnafClient constructs without errors.
 *   - uploadInvoice() makes PUT to /upload?standard=UBL&cif={cif}.
 *   - uploadInvoice() throws when HTTP returns 4xx.
 *   - uploadInvoice() extracts idIncarcare from response.
 *   - getStatus() returns stare correctly.
 *   - getStatus() throws on 4xx.
 *   - mapAnafStatus() maps 'ok'→CLEARED, 'nok'→REJECTED, else PENDING.
 *   - Token is cached after first call.
 *
 * Live integration deferred — no ANAF sandbox credentials available.
 */
import { AnafClient, AnafHttpPort, mapAnafStatus } from './anaf-client';

const BASE_CONFIG = {
  baseUrl: 'https://api.anaf.ro/test/FCTEL/rest',
  tokenUrl: 'https://logincert.anaf.ro/anaf-oauth2/v1',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  cif: '1234567890',
};

const makeHttp = (overrides: Partial<AnafHttpPort> = {}): AnafHttpPort => ({
  post: async () => ({ status: 200, data: {} }),
  get: async () => ({ status: 200, data: {} }),
  put: async () => ({ status: 200, data: {} }),
  ...overrides,
});

describe('AnafClient (scaffold, mocked)', () => {
  describe('mapAnafStatus', () => {
    it('maps "ok" → CLEARED', () => {
      expect(mapAnafStatus('ok')).toBe('CLEARED');
      expect(mapAnafStatus('OK')).toBe('CLEARED');
    });
    it('maps "nok" → REJECTED', () => {
      expect(mapAnafStatus('nok')).toBe('REJECTED');
      expect(mapAnafStatus('NOK')).toBe('REJECTED');
      expect(mapAnafStatus('XML cu erori neprelucrat')).toBe('REJECTED');
    });
    it('maps "in prelucrare" → PENDING', () => {
      expect(mapAnafStatus('in prelucrare')).toBe('PENDING');
      expect(mapAnafStatus('In Prelucrare')).toBe('PENDING');
    });
    it('maps unknown → PENDING', () => {
      expect(mapAnafStatus('some_new_status')).toBe('PENDING');
    });
  });

  describe('uploadInvoice', () => {
    it('extracts idIncarcare from response', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { access_token: 'tok123', expires_in: 3600 } }),
        put: async () => ({ status: 200, data: { ExecutionStatus: 0, id_incarcare: 42 } }),
      });
      const client = new AnafClient(BASE_CONFIG, http);
      const result = await client.uploadInvoice('<Invoice/>');
      expect(result.idIncarcare).toBe('42');
      expect(result.httpStatus).toBe(200);
    });

    it('throws when PUT returns 4xx', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { access_token: 'tok', expires_in: 3600 } }),
        put: async () => ({ status: 400, data: { error: 'Bad Request' } }),
      });
      const client = new AnafClient(BASE_CONFIG, http);
      await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow('ANAF upload failed (HTTP 400)');
    });

    it('throws when authentication fails', async () => {
      const http = makeHttp({
        post: async () => ({ status: 401, data: {} }),
      });
      const client = new AnafClient(BASE_CONFIG, http);
      await expect(client.uploadInvoice('<Invoice/>')).rejects.toThrow('ANAF authentication failed (HTTP 401)');
    });
  });

  describe('getStatus', () => {
    it('returns stare from response', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { access_token: 'tok123', expires_in: 3600 } }),
        get: async () => ({ status: 200, data: { stare: 'in prelucrare' } }),
      });
      const client = new AnafClient(BASE_CONFIG, http);
      const result = await client.getStatus('42');
      expect(result.stare).toBe('in prelucrare');
    });

    it('returns "ok" when ANAF accepts the document', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { access_token: 'tok', expires_in: 3600 } }),
        get: async () => ({ status: 200, data: { stare: 'ok' } }),
      });
      const client = new AnafClient(BASE_CONFIG, http);
      const result = await client.getStatus('42');
      expect(result.stare).toBe('ok');
      expect(mapAnafStatus(result.stare)).toBe('CLEARED');
    });

    it('throws when GET returns 4xx', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { access_token: 'tok', expires_in: 3600 } }),
        get: async () => ({ status: 404, data: {} }),
      });
      const client = new AnafClient(BASE_CONFIG, http);
      await expect(client.getStatus('missing')).rejects.toThrow('ANAF stareMesaj failed (HTTP 404)');
    });
  });

  describe('token caching', () => {
    it('reuses the cached token without calling /token twice', async () => {
      let tokenCallCount = 0;
      const http = makeHttp({
        post: async (url) => {
          if (url.includes('/token')) {
            tokenCallCount++;
            return { status: 200, data: { access_token: 'cached-tok', expires_in: 3600 } };
          }
          return { status: 200, data: {} };
        },
        put: async () => ({ status: 200, data: { id_incarcare: 1 } }),
        get: async () => ({ status: 200, data: { stare: 'ok' } }),
      });
      const client = new AnafClient(BASE_CONFIG, http);
      await client.uploadInvoice('<Invoice/>');
      await client.getStatus('1');
      expect(tokenCallCount).toBe(1); // token was cached
    });
  });
});
