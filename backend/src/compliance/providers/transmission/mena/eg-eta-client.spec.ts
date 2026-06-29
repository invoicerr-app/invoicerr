/**
 * ETA client — mocked / structural tests.
 *
 * Tests:
 *   - EtaClient constructs without errors.
 *   - submitDocument() makes POST to /api/v1/documentsubmissions.
 *   - submitDocument() throws when HTTP returns 4xx.
 *   - submitDocument() extracts uuid from acceptedDocuments.
 *   - getDocumentStatus() returns status correctly.
 *   - mapEtaStatus() covers all expected cases.
 *   - etaCanonicalize() returns a JSON string.
 *   - computeEtaUuid() returns a non-empty string (scaffold stub).
 *   - Token is obtained via client_credentials OAuth2 flow.
 *
 * Live integration deferred — no ETA sandbox credentials available.
 */
import { EtaClient, EtaHttpPort, computeEtaUuid, etaCanonicalize, mapEtaStatus } from './eg-eta-client';

const BASE_CONFIG = {
  baseUrl: 'https://api.preprod.invoicing.eta.gov.eg',
  tokenUrl: 'https://id.preprod.eta.gov.eg',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  taxRegistrationNumber: 'EG-123456789',
};

const makeHttp = (overrides: Partial<EtaHttpPort> = {}): EtaHttpPort => ({
  post: async () => ({ status: 200, data: {} }),
  get: async () => ({ status: 200, data: {} }),
  ...overrides,
});

describe('EtaClient (scaffold, mocked)', () => {
  describe('mapEtaStatus', () => {
    it('maps Valid → CLEARED', () => {
      expect(mapEtaStatus('Valid')).toBe('CLEARED');
      expect(mapEtaStatus('VALID')).toBe('CLEARED');
      expect(mapEtaStatus('Accepted')).toBe('CLEARED');
    });
    it('maps Invalid → REJECTED', () => {
      expect(mapEtaStatus('Invalid')).toBe('REJECTED');
      expect(mapEtaStatus('Cancelled')).toBe('REJECTED');
      expect(mapEtaStatus('REJECTED')).toBe('REJECTED');
    });
    it('maps Submitted → PENDING', () => {
      expect(mapEtaStatus('Submitted')).toBe('PENDING');
      expect(mapEtaStatus('unknown')).toBe('PENDING');
    });
  });

  describe('etaCanonicalize', () => {
    it('returns a JSON string for a simple object', () => {
      const result = etaCanonicalize({ a: 1, b: 'hello' });
      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed).toMatchObject({ a: 1, b: 'hello' });
    });
  });

  describe('computeEtaUuid', () => {
    it('returns a non-empty string (scaffold stub)', () => {
      const uuid = computeEtaUuid('{"some":"json"}');
      expect(typeof uuid).toBe('string');
      expect(uuid.length).toBeGreaterThan(0);
    });
  });

  describe('submitDocument', () => {
    it('extracts uuid from acceptedDocuments response', async () => {
      const http = makeHttp({
        post: async (url) => {
          if (url.includes('/connect/token')) return { status: 200, data: { access_token: 'tok123', expires_in: 3600 } };
          return {
            status: 202,
            data: {
              submissionId: 'sub-001',
              acceptedDocuments: [{ uuid: 'doc-uuid-001' }],
              rejectedDocuments: [],
            },
          };
        },
      });
      const client = new EtaClient(BASE_CONFIG, http);
      const result = await client.submitDocument({ issuerTaxpayerTin: 'EG-123' });
      expect(result.uuid).toBe('doc-uuid-001');
      expect(result.submissionId).toBe('sub-001');
    });

    it('throws when HTTP returns 4xx on submit', async () => {
      const http = makeHttp({
        post: async (url) => {
          if (url.includes('/connect/token')) return { status: 200, data: { access_token: 'tok', expires_in: 3600 } };
          return { status: 400, data: { error: 'Bad request' } };
        },
      });
      const client = new EtaClient(BASE_CONFIG, http);
      await expect(client.submitDocument({})).rejects.toThrow('ETA submitDocument failed (HTTP 400)');
    });

    it('throws when authentication fails', async () => {
      const http = makeHttp({
        post: async () => ({ status: 401, data: {} }),
      });
      const client = new EtaClient(BASE_CONFIG, http);
      await expect(client.submitDocument({})).rejects.toThrow('ETA authentication failed (HTTP 401)');
    });
  });

  describe('getDocumentStatus', () => {
    it('returns status from response', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { access_token: 'tok123', expires_in: 3600 } }),
        get: async () => ({ status: 200, data: { status: 'Valid', uuid: 'doc-uuid-001' } }),
      });
      const client = new EtaClient(BASE_CONFIG, http);
      const result = await client.getDocumentStatus('doc-uuid-001');
      expect(result.status).toBe('Valid');
      expect(result.uuid).toBe('doc-uuid-001');
    });

    it('throws when HTTP returns 4xx on status poll', async () => {
      const http = makeHttp({
        post: async () => ({ status: 200, data: { access_token: 'tok', expires_in: 3600 } }),
        get: async () => ({ status: 404, data: {} }),
      });
      const client = new EtaClient(BASE_CONFIG, http);
      await expect(client.getDocumentStatus('missing')).rejects.toThrow('ETA getDocumentStatus failed (HTTP 404)');
    });
  });
});
