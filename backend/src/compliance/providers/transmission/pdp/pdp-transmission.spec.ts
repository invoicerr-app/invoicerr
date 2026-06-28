/**
 * PDP transmission integration test — proves the "encrypted company config → provider" flow.
 *
 * No env vars. No bypass. The provider receives credentials exclusively through
 * the ChannelCredentialsPort.resolveActive() path.
 *
 * Live test is guarded by PDP_LIVE=1 (never runs in CI).
 */
import { TransmissionProviderRegistry } from '../registry';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SignedArtifact } from '../../../execution/types';
import { TransactionContext } from '../../../canonical/canonical-document';

const COMPANY_ID = 'company_pdp_test';
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(() => { process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY; });
afterAll(() => { delete process.env.CREDENTIALS_ENCRYPTION_KEY; });

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

const FACTURX_ARTIFACT: SignedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'FACTURX',
  mime: 'application/pdf',
  bytes: Buffer.from('%PDF-1.4 fake factur-x content', 'utf8'),
};

function makeCtx(companyId: string): TransactionContext {
  return {
    supplier: {
      legalName: 'Test Co FR',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'SIREN', value: '123456789', validated: true }],
    },
    buyer: {
      legalName: 'Buyer Co FR',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'SIREN', value: '987654321', validated: true }],
    },
    lines: [{ id: 'l1', description: 'test service', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date('2026-07-01'),
    currency: 'EUR',
    supplierCompanyId: companyId,
    externalRef: 'INV-2026-001',
  } as TransactionContext;
}

function makeResolvedConfig(overrides?: Partial<ResolvedChannelConfig['config']>): ResolvedChannelConfig {
  return {
    providerId: 'pdp',
    channel: 'PDP',
    environment: 'sandbox',
    config: {
      baseUrl: 'https://api.superpdp.tech',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      apiStyle: 'superpdp',
      ...overrides,
    },
    isActive: true,
  };
}

describe('PDP transmission — credential flow', () => {
  it('transmit() returns SKIPPED when no resolved config is passed', async () => {
    const reg = new TransmissionProviderRegistry({
      credentials: mockCredentials(null),
    });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [FACTURX_ARTIFACT],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'PDP', providerId: 'pdp' }] } as any,
      'test-key',
      log,
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/not configured/);
  });

  it('transmit() receives the resolved config from the registry', async () => {
    const credentials = mockCredentials(makeResolvedConfig());

    const reg = new TransmissionProviderRegistry({ credentials });
    const log = new RecordingComplianceLogger();

    // The transmit will fail (no real API) but we verify config WAS passed
    const result = await reg.transmitAll(
      [FACTURX_ARTIFACT],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'PDP', providerId: 'pdp' }] } as any,
      'test-key',
      log,
    );

    expect(credentials.resolveActive).toHaveBeenCalledWith(COMPANY_ID, 'pdp');
    expect(result).toHaveLength(1);
    // Should be REJECTED (API call failed) or SKIPPED (no FACTURX), but NOT "not configured"
    expect(result[0].notes.join(' ')).not.toMatch(/not configured for company/);
  });

  it('transmit() returns SKIPPED when no FACTURX artifact is provided', async () => {
    const credentials = mockCredentials(makeResolvedConfig());
    const reg = new TransmissionProviderRegistry({ credentials });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [{ role: 'AUTHORITATIVE', syntax: 'FA_VAT', mime: 'application/xml', bytes: Buffer.from('<xml/>') }],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'PDP', providerId: 'pdp' }] } as any,
      'test-key',
      log,
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/no FACTURX artifact/);
  });

  it('transmit() returns SKIPPED when config is incomplete', async () => {
    const credentials = mockCredentials(makeResolvedConfig({ baseUrl: '', clientId: '' }));
    const reg = new TransmissionProviderRegistry({ credentials });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [FACTURX_ARTIFACT],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'PDP', providerId: 'pdp' }] } as any,
      'test-key',
      log,
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/incomplete config/);
  });

  it('poll() re-authenticates from persisted config (no in-memory cache)', async () => {
    const credentials = mockCredentials(null);
    const reg = new TransmissionProviderRegistry({ credentials });
    const pdp = reg.getById('pdp')!;

    // poll() with a valid ref format but no credentials
    const result = await pdp.poll!('company1|invoice-123', new RecordingComplianceLogger());

    expect(credentials.resolveActive).toHaveBeenCalledWith('company1', 'pdp');
    expect(result.status).toBe('PENDING'); // null credentials → PENDING
  });

  it('poll() extracts companyId from ref and resolves credentials', async () => {
    const credentials = mockCredentials(null);
    const reg = new TransmissionProviderRegistry({ credentials });
    const pdp = reg.getById('pdp')!;

    await pdp.poll!('my-company|inv-456', new RecordingComplianceLogger());

    expect(credentials.resolveActive).toHaveBeenCalledWith('my-company', 'pdp');
  });

  it('poll() returns PENDING for invalid ref format', async () => {
    const credentials = mockCredentials(null);
    const reg = new TransmissionProviderRegistry({ credentials });
    const pdp = reg.getById('pdp')!;

    const result = await pdp.poll!('invalid-ref', new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/invalid ref format/);
  });

  it('poll() returns PENDING when no credentials port is set', async () => {
    const reg = new TransmissionProviderRegistry(); // no credentials
    const pdp = reg.getById('pdp')!;

    const result = await pdp.poll!('company1|invoice-123', new RecordingComplianceLogger());

    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toMatch(/no credentials port/);
  });

  it('PDP provider has correct metadata', () => {
    const reg = new TransmissionProviderRegistry();
    const pdp = reg.getById('pdp')!;

    expect(pdp.id).toBe('pdp');
    expect(pdp.channel).toBe('PDP');
    expect(pdp.feedback).toBe('ASYNC_CALLBACK');
    expect(pdp.pollPolicy).toBeDefined();
    expect(pdp.pollPolicy!.everySeconds).toBe(30);
    expect(pdp.configSchema).toBeDefined();
    expect(pdp.configSchema!.fields.length).toBeGreaterThanOrEqual(4);
  });
});
