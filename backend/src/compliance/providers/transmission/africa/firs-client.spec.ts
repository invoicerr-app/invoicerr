/**
 * FIRS MBS client — mocked / structural tests.
 *
 * Live integration deferred — no FIRS MBS sandbox credentials available.
 */
import { computeFirsIrn, FirsClient, FirsAuthResponse, FirsIrnResponse, FirsSubmitResponse, FirsStatusResponse, FirsHttpPort } from './firs-client';
import { FirsTransmissionProvider } from './firs-transmission';
import { RecordingComplianceLogger } from '../../../execution/logger';

const MOCK_AUTH: FirsAuthResponse = {
  accessToken: 'mock-firs-token',
  tokenType: 'Bearer',
  expiresIn: 3600,
};

const MOCK_IRN_RESP: FirsIrnResponse = {
  irn: 'a'.repeat(64), // 64-char SHA-256 hex
  qrCode: 'data:image/png;base64,mock-qr',
  timestamp: '2026-06-29T10:00:00Z',
  status: 'GENERATED',
};

const MOCK_SUBMIT: FirsSubmitResponse = {
  irn: 'a'.repeat(64),
  status: 'SUBMITTED',
  message: 'Invoice submitted successfully',
};

const MOCK_STATUS: FirsStatusResponse = {
  irn: 'a'.repeat(64),
  status: 'CLEARED',
  clearedAt: '2026-06-29T10:05:00Z',
};

function buildMockHttp(): FirsHttpPort {
  return {
    authenticate: jest.fn().mockResolvedValue(MOCK_AUTH),
    generateIrn: jest.fn().mockResolvedValue(MOCK_IRN_RESP),
    submitInvoice: jest.fn().mockResolvedValue(MOCK_SUBMIT),
    getStatus: jest.fn().mockResolvedValue(MOCK_STATUS),
  };
}

describe('FirsClient (scaffold — mocked HTTP)', () => {
  const http = buildMockHttp();
  const client = new FirsClient(http, {
    environment: 'sandbox',
    clientId: '123456789012',
    clientSecret: 'secret',
    serviceId: '08-00-02-00',
  });

  const samplePayload = {
    businessName: 'Test Co Ltd',
    tinSupplier: '123456789012',
    tinBuyer: '987654321098',
    buyerName: 'Buyer Corp',
    buyerAddress: '1 Lagos Street',
    invoiceNumber: 'INV-2026-001',
    invoiceDate: '2026-06-29',
    currency: 'NGN',
    serviceId: '08-00-02-00',
    lines: [{
      lineId: 1,
      productDescription: 'Consulting services',
      quantity: 1,
      unitPrice: 100000,
      taxableAmount: 100000,
      vatRate: 7.5,
      vatAmount: 7500,
      totalAmount: 107500,
    }],
    taxableAmount: 100000,
    totalVat: 7500,
    totalAmount: 107500,
  };

  it('authenticate() returns an access token', async () => {
    const resp = await client.authenticate();
    expect(resp.accessToken).toBe('mock-firs-token');
    expect(resp.tokenType).toBe('Bearer');
  });

  it('generateIrn() returns irn (64 chars) + qrCode', async () => {
    const resp = await client.generateIrn('mock-token', samplePayload);
    expect(resp.irn).toHaveLength(64);
    expect(resp.qrCode).toBeTruthy();
    expect(resp.status).toBe('GENERATED');
  });

  it('submitInvoice() returns SUBMITTED status', async () => {
    const resp = await client.submitInvoice('mock-token', samplePayload, MOCK_IRN_RESP.irn);
    expect(resp.status).toBe('SUBMITTED');
    expect(resp.irn).toHaveLength(64);
  });

  it('getStatus() returns CLEARED for a known IRN', async () => {
    const resp = await client.getStatus('mock-token', MOCK_IRN_RESP.irn);
    expect(resp.status).toBe('CLEARED');
    expect(resp.clearedAt).toBeTruthy();
  });

  it('submitNew() full flow returns irn + qrCode', async () => {
    const result = await client.submitNew(samplePayload);
    expect(result.irn).toHaveLength(64);
    expect(result.qrCode).toBeTruthy();
    expect(result.status).toBe('SUBMITTED');
  });
});

describe('computeFirsIrn()', () => {
  it('returns a 64-char hex string', () => {
    const irn = computeFirsIrn('123456789012', 'INV-001', '08-00-02-00', '2026-06-29');
    expect(irn).toHaveLength(64);
    expect(irn).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = computeFirsIrn('TIN1', 'INV-001', 'SVC-01', '2026-06-01');
    const b = computeFirsIrn('TIN1', 'INV-001', 'SVC-01', '2026-06-01');
    expect(a).toBe(b);
  });

  it('differs for different invoice numbers', () => {
    const a = computeFirsIrn('TIN1', 'INV-001', 'SVC-01', '2026-06-01');
    const b = computeFirsIrn('TIN1', 'INV-002', 'SVC-01', '2026-06-01');
    expect(a).not.toBe(b);
  });
});

describe('FirsTransmissionProvider (scaffold)', () => {
  const log = new RecordingComplianceLogger();

  it('has id "firs" and GOV_PORTAL_API channel', () => {
    const p = new FirsTransmissionProvider();
    expect(p.id).toBe('firs');
    expect(p.channel).toBe('GOV_PORTAL_API');
  });

  it('is ASYNC_POLL with poll() exposed', () => {
    const p = new FirsTransmissionProvider();
    expect(p.feedback).toBe('ASYNC_POLL');
    expect(p.pollPolicy).toBeDefined();
    expect(p.poll).toBeDefined();
  });

  it('declares configSchema with environment + clientId + clientSecret', () => {
    const p = new FirsTransmissionProvider();
    expect(p.configSchema?.fields.length).toBeGreaterThanOrEqual(3);
    const names = p.configSchema!.fields.map((f) => f.name);
    expect(names).toContain('environment');
    expect(names).toContain('clientId');
    expect(names).toContain('clientSecret');
  });

  it('returns SKIPPED when no resolved config', async () => {
    const p = new FirsTransmissionProvider();
    const result = await p.transmit([], {} as never, {} as never, 'key', log, undefined);
    expect(result.status).toBe('SKIPPED');
    expect(result.notes.some((n) => n.includes('firs'))).toBe(true);
  });

  it('poll() returns PENDING when no credentials port', async () => {
    const p = new FirsTransmissionProvider();
    const result = await p.poll!('company1|' + 'a'.repeat(64), log);
    expect(result.status).toBe('PENDING');
  });

  it('poll() handles malformed ref', async () => {
    const p = new FirsTransmissionProvider();
    const result = await p.poll!('bad-ref-no-pipe', log);
    expect(result.status).toBe('PENDING');
    expect(result.notes.some((n) => n.includes('firs'))).toBe(true);
  });
});
