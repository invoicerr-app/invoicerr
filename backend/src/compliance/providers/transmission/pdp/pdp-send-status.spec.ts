/**
 * PDP sendStatus — mocked unit tests.
 *
 * LIVE PROOF: DEFERRED — requires SuperPDP sandbox credentials and a live deposited
 * invoice. The real sendStatus() calls POST /v1.beta/invoices/{id}/lifecycle_events.
 * These tests use a mocked PdpClient to verify:
 *   - Correct credentials resolution via ChannelCredentialsPort
 *   - Correct PDP lifecycle code mapping (encaissée → fr:212, acceptée → fr:205, etc.)
 *   - ref parsing (companyId|invoiceId)
 *   - Error handling: invalid ref, missing credentials, API error
 */
import { PdpTransmissionProvider } from '../providers';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { RecordingComplianceLogger } from '../../../execution/logger';

const COMPANY_ID = 'company_pdp_test';
const INVOICE_ID = 89123;
const REF = `${COMPANY_ID}|${INVOICE_ID}`;

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

function makeResolvedConfig(overrides: Partial<Record<string, unknown>> = {}): ResolvedChannelConfig {
  return {
    providerId: 'pdp',
    channel: 'PDP',
    environment: 'TEST',
    config: {
      baseUrl: 'https://api.superpdp.tech',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiStyle: 'superpdp',
      ...overrides,
    },
    isActive: true,
  };
}

// Mock the dynamic import of PdpClient
jest.mock('../pdp/pdp-client', () => {
  const mockPushLifecycleStatus = jest.fn().mockResolvedValue(undefined);
  const mockAuthenticate = jest.fn().mockResolvedValue('mock-token');
  const mockClearToken = jest.fn();

  const MockPdpClient = jest.fn().mockImplementation(() => ({
    authenticate: mockAuthenticate,
    clearToken: mockClearToken,
    pushLifecycleStatus: mockPushLifecycleStatus,
  }));

  return {
    PdpClient: MockPdpClient,
    _mockPushLifecycleStatus: mockPushLifecycleStatus,
    _mockAuthenticate: mockAuthenticate,
  };
});

// Helper to access mocked client methods after import
async function getMocks() {
  const mod = await import('../pdp/pdp-client.js');
  return mod as unknown as {
    PdpClient: jest.MockedClass<any>;
    _mockPushLifecycleStatus: jest.MockedFunction<any>;
    _mockAuthenticate: jest.MockedFunction<any>;
  };
}

describe('PdpTransmissionProvider.sendStatus — mocked', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns QUEUED when ref is malformed', async () => {
    const provider = new PdpTransmissionProvider(mockCredentials(makeResolvedConfig()));
    const log = new RecordingComplianceLogger();

    const result = await provider.sendStatus('bad-ref', 'encaissée', {} as any, {} as any, log);

    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/invalid ref/);
  });

  it('returns QUEUED when no credentials port', async () => {
    const provider = new PdpTransmissionProvider(); // no credentials
    const log = new RecordingComplianceLogger();

    const result = await provider.sendStatus(REF, 'encaissée', {} as any, {} as any, log);

    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/no credentials port/);
  });

  it('returns QUEUED when credentials no longer active', async () => {
    const provider = new PdpTransmissionProvider(mockCredentials(null));
    const log = new RecordingComplianceLogger();

    const result = await provider.sendStatus(REF, 'encaissée', {} as any, {} as any, log);

    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/no longer active/);
  });

  it('maps "encaissée" to fr:212 and returns SENT on success', async () => {
    const provider = new PdpTransmissionProvider(mockCredentials(makeResolvedConfig()));
    const log = new RecordingComplianceLogger();
    const mocks = await getMocks();

    const result = await provider.sendStatus(REF, 'encaissée', {} as any, {} as any, log);

    expect(result.status).toBe('SENT');
    expect(result.ref).toBe(REF);
    expect(result.notes.join(' ')).toContain('fr:212');
    expect(mocks._mockPushLifecycleStatus).toHaveBeenCalledWith(INVOICE_ID, 'fr:212');
  });

  it('maps "accepted" to fr:205', async () => {
    const provider = new PdpTransmissionProvider(mockCredentials(makeResolvedConfig()));
    const log = new RecordingComplianceLogger();
    const mocks = await getMocks();

    await provider.sendStatus(REF, 'accepted', {} as any, {} as any, log);

    expect(mocks._mockPushLifecycleStatus).toHaveBeenCalledWith(INVOICE_ID, 'fr:205');
  });

  it('maps "refused" to fr:210', async () => {
    const provider = new PdpTransmissionProvider(mockCredentials(makeResolvedConfig()));
    const log = new RecordingComplianceLogger();
    const mocks = await getMocks();

    await provider.sendStatus(REF, 'refused by buyer', {} as any, {} as any, log);

    expect(mocks._mockPushLifecycleStatus).toHaveBeenCalledWith(INVOICE_ID, 'fr:210');
  });

  it('returns QUEUED and does not throw when API call fails', async () => {
    const mocks = await getMocks();
    mocks._mockPushLifecycleStatus.mockRejectedValueOnce(new Error('HTTP 500 server error'));

    const provider = new PdpTransmissionProvider(mockCredentials(makeResolvedConfig()));
    const log = new RecordingComplianceLogger();

    const result = await provider.sendStatus(REF, 'encaissée', {} as any, {} as any, log);

    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/sendStatus error/);
  });

  it('returns QUEUED (AFNOR deferred) when apiStyle is afnor', async () => {
    const provider = new PdpTransmissionProvider(mockCredentials(makeResolvedConfig({ apiStyle: 'afnor' })));
    const log = new RecordingComplianceLogger();

    const result = await provider.sendStatus(`${COMPANY_ID}|flow-abc`, 'encaissée', {} as any, {} as any, log);

    expect(result.status).toBe('QUEUED');
    expect(result.notes.join(' ')).toMatch(/AFNOR sendStatus deferred/);
  });
});
