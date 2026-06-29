/**
 * Malaysia MyInvois client — mocked HTTP tests.
 * All HTTP calls go through the injectable MyInvoisHttpPort — no real network.
 * Live integration proof deferred (no public sandbox credentials available).
 */
import {
  MyInvoisClient,
  MyInvoisClientConfig,
  MyInvoisHttpPort,
  MyInvoisTokenResponse,
  MyInvoisSubmissionResponse,
  MyInvoisDocumentDetails,
} from './myinvois-client';

const TEST_CONFIG: MyInvoisClientConfig = {
  environment: 'preprod',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tin: 'C12345678900',
};

const MOCK_TOKEN: MyInvoisTokenResponse = {
  access_token: 'test-bearer-token',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'InvoicingAPI',
};

const MOCK_SUBMISSION: MyInvoisSubmissionResponse = {
  submissionUID: 'SUBM-2025-0001',
  acceptedDocuments: [
    { uuid: 'doc-uuid-1234', invoiceCodeNumber: 'INV-MY-001' },
  ],
  rejectedDocuments: [],
};

const MOCK_DOC_DETAILS: MyInvoisDocumentDetails = {
  uuid: 'doc-uuid-1234',
  submissionUID: 'SUBM-2025-0001',
  longId: 'https://myinvois.hasil.gov.my/doc/doc-uuid-1234',
  internalId: 'INV-MY-001',
  typeName: 'Invoice',
  typeVersionName: '1.0',
  issuerTin: 'C12345678900',
  receiverId: 'C98765432100',
  receiverName: 'Buyer Sdn Bhd',
  dateTimeIssued: '2025-04-01T10:00:00Z',
  dateTimeReceived: '2025-04-01T10:00:05Z',
  dateTimeValidated: '2025-04-01T10:01:00Z',
  totalSales: 10000,
  totalDiscount: 0,
  netAmount: 10000,
  total: 10800,
  status: 'Valid',
};

function mockHttp(overrides?: Partial<MyInvoisHttpPort>): MyInvoisHttpPort {
  return {
    getToken: jest.fn().mockResolvedValue(MOCK_TOKEN),
    submitDocuments: jest.fn().mockResolvedValue(MOCK_SUBMISSION),
    getDocumentDetails: jest.fn().mockResolvedValue(MOCK_DOC_DETAILS),
    ...overrides,
  };
}

describe('MyInvoisClient (mocked HTTP — live-deferred)', () => {
  it('getToken() authenticates against preprod URL with client_credentials', async () => {
    const http = mockHttp();
    const client = new MyInvoisClient(http, TEST_CONFIG);
    const token = await client.getToken();
    expect(http.getToken).toHaveBeenCalledWith(
      expect.stringContaining('preprod.myinvois.hasil.gov.my/connect/token'),
      'test-client-id',
      'test-client-secret',
      'InvoicingAPI',
    );
    expect(token).toBe('test-bearer-token');
  });

  it('getToken() uses prod URL in production environment', async () => {
    const http = mockHttp();
    const client = new MyInvoisClient(http, { ...TEST_CONFIG, environment: 'prod' });
    await client.getToken();
    expect(http.getToken).toHaveBeenCalledWith(
      expect.stringContaining('myinvois.hasil.gov.my/connect/token'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
    // Prod URL must NOT contain "preprod"
    const call = (http.getToken as jest.Mock).mock.calls[0][0] as string;
    expect(call).not.toContain('preprod');
  });

  it('getToken() caches the token to avoid redundant auth calls', async () => {
    const http = mockHttp();
    const client = new MyInvoisClient(http, TEST_CONFIG);
    await client.getToken();
    await client.getToken();
    // Should only call getToken once (cached)
    expect(http.getToken).toHaveBeenCalledTimes(1);
  });

  it('submit() calls submitDocuments with bearer token and document list', async () => {
    const http = mockHttp();
    const client = new MyInvoisClient(http, TEST_CONFIG);
    const docs = [{
      format: 'XML' as const,
      documentHash: 'abc123',
      codeNumber: 'INV-MY-001',
      document: 'PHhtbD4...',
    }];
    const resp = await client.submit(docs);
    expect(http.submitDocuments).toHaveBeenCalledWith(
      expect.stringContaining('preprod.myinvois.hasil.gov.my/api/v1.0'),
      'test-bearer-token',
      { documents: docs },
    );
    expect(resp.submissionUID).toBe('SUBM-2025-0001');
    expect(resp.acceptedDocuments).toHaveLength(1);
    expect(resp.rejectedDocuments).toHaveLength(0);
  });

  it('getStatus() polls document by UUID', async () => {
    const http = mockHttp();
    const client = new MyInvoisClient(http, TEST_CONFIG);
    const details = await client.getStatus('doc-uuid-1234');
    expect(http.getDocumentDetails).toHaveBeenCalledWith(
      expect.stringContaining('preprod.myinvois.hasil.gov.my/api/v1.0'),
      'test-bearer-token',
      'doc-uuid-1234',
    );
    expect(details.status).toBe('Valid');
    expect(details.longId).toContain('myinvois.hasil.gov.my');
  });

  it('submitInvoice() hashes UBL bytes and submits with correct structure', async () => {
    const http = mockHttp();
    const client = new MyInvoisClient(http, TEST_CONFIG);
    const ublBytes = new TextEncoder().encode('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">');
    const resp = await client.submitInvoice(ublBytes, 'INV-MY-001');
    expect(http.submitDocuments).toHaveBeenCalledWith(
      expect.any(String),
      'test-bearer-token',
      expect.objectContaining({
        documents: expect.arrayContaining([
          expect.objectContaining({
            format: 'XML',
            codeNumber: 'INV-MY-001',
            documentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            document: expect.stringMatching(/^[A-Za-z0-9+/=]+$/), // base64
          }),
        ]),
      }),
    );
    expect(resp.acceptedDocuments[0].uuid).toBe('doc-uuid-1234');
  });

  it('propagates auth errors', async () => {
    const http = mockHttp({
      getToken: jest.fn().mockRejectedValue(new Error('MyInvois: invalid client credentials')),
    });
    const client = new MyInvoisClient(http, TEST_CONFIG);
    await expect(client.getToken()).rejects.toThrow('invalid client credentials');
  });

  it('propagates submission rejection', async () => {
    const http = mockHttp({
      submitDocuments: jest.fn().mockResolvedValue({
        submissionUID: 'SUBM-FAIL',
        acceptedDocuments: [],
        rejectedDocuments: [
          { invoiceCodeNumber: 'INV-MY-BAD', error: { code: 'E001', message: 'Invalid TIN' } },
        ],
      }),
    });
    const client = new MyInvoisClient(http, TEST_CONFIG);
    const resp = await client.submit([
      { format: 'XML', documentHash: 'x', codeNumber: 'INV-MY-BAD', document: 'Ww==' },
    ]);
    expect(resp.rejectedDocuments).toHaveLength(1);
    expect(resp.rejectedDocuments[0].error.message).toBe('Invalid TIN');
  });
});

describe('MyInvoisClient.computeDocumentHash()', () => {
  it('returns a 64-char hex SHA-256 string', () => {
    const bytes = new TextEncoder().encode('<Invoice>test</Invoice>');
    const hash = MyInvoisClient.computeDocumentHash(bytes);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it('is deterministic for the same bytes', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(MyInvoisClient.computeDocumentHash(bytes)).toBe(
      MyInvoisClient.computeDocumentHash(bytes),
    );
  });

  it('differs for different document content', () => {
    const a = new TextEncoder().encode('<Invoice>1</Invoice>');
    const b = new TextEncoder().encode('<Invoice>2</Invoice>');
    expect(MyInvoisClient.computeDocumentHash(a)).not.toBe(
      MyInvoisClient.computeDocumentHash(b),
    );
  });
});
