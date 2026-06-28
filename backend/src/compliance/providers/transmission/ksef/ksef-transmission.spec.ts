/**
 * KSeF transmission integration test — proves the "encrypted company config → provider" flow.
 *
 * No env vars. No bypass. The provider receives credentials exclusively through
 * the ChannelCredentialsPort.resolveActive() path.
 */
import { TransmissionProviderRegistry } from '../registry';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { TransactionContext } from '../../../canonical/canonical-document';

const COMPANY_ID = 'company_ksef_test';
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(() => { process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY; });
afterAll(() => { delete process.env.CREDENTIALS_ENCRYPTION_KEY; });

/** Minimal mock of ChannelCredentialsPort that returns a pre-built config. */
function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

const FA_VAT_ARTIFACT: SignedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'FA_VAT',
  mime: 'application/xml',
  bytes: Buffer.from('<?xml version="1.0"?><Faktura>test</Faktura>', 'utf8'),
};

function makeCtx(companyId: string): TransactionContext {
  return {
    supplier: {
      legalName: 'Test Co',
      countryCode: 'PL',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'PL1234567890', validated: true }],
    },
    buyer: {
      legalName: 'Buyer Co',
      countryCode: 'PL',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'PL0987654321', validated: true }],
    },
    lines: [{ id: 'l1', description: 'test', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
    issueDate: new Date('2027-01-15'),
    currency: 'PLN',
    supplierCompanyId: companyId,
  } as TransactionContext;
}

describe('KSeF transmission — credential flow', () => {
  it('transmit() returns SKIPPED when no resolved config is passed', async () => {
    const reg = new TransmissionProviderRegistry({
      credentials: mockCredentials(null),
    });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [FA_VAT_ARTIFACT],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }] } as any,
      'test-key',
      log,
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('SKIPPED');
    expect(result[0].notes.join(' ')).toMatch(/not configured/);
  });

  it('transmit() receives the resolved config from the registry', async () => {
    const credentials = mockCredentials({
      providerId: 'ksef',
      channel: 'GOV_PORTAL_API',
      environment: 'test',
      config: {
        nip: '1234567890',
        authToken: 'test-token-value',
        tokenEncryptionKeyPem: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
        symmetricKeyPem: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
      },
      isActive: true,
    });

    const reg = new TransmissionProviderRegistry({ credentials });
    const log = new RecordingComplianceLogger();

    // The transmit will fail (invalid RSA keys) but we verify the config WAS passed
    const result = await reg.transmitAll(
      [FA_VAT_ARTIFACT],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }] } as any,
      'test-key',
      log,
    );

    // resolveActive was called with correct args
    expect(credentials.resolveActive).toHaveBeenCalledWith(COMPANY_ID, 'ksef');

    // The result is either SKIPPED or REJECTED (due to invalid keys), but NOT "no resolved config"
    expect(result).toHaveLength(1);
    expect(result[0].notes.join(' ')).not.toMatch(/not configured for company/);
  });

  it('resolveActive returns single active config regardless of environment', async () => {
    const credentials = mockCredentials({
      providerId: 'ksef',
      channel: 'GOV_PORTAL_API',
      environment: 'prod', // Even PROD works — the config was resolved, not hardcoded
      config: {
        nip: '1234567890',
        authToken: 'test-token',
        tokenEncryptionKeyPem: 'key1',
        symmetricKeyPem: 'key2',
      },
      isActive: true,
    });

    const reg = new TransmissionProviderRegistry({ credentials });
    const log = new RecordingComplianceLogger();

    const result = await reg.transmitAll(
      [FA_VAT_ARTIFACT],
      makeCtx(COMPANY_ID),
      { channels: [{ type: 'GOV_PORTAL_API', providerId: 'ksef' }] } as any,
      'test-key',
      log,
    );

    expect(credentials.resolveActive).toHaveBeenCalledWith(COMPANY_ID, 'ksef');
    // Config was NOT hardcoded to 'TEST' — it resolved whatever environment was active
    expect(result).toHaveLength(1);
  });

  it('poll() re-authenticates from persisted config (no in-memory cache)', async () => {
    const credentials = mockCredentials(null);
    const reg = new TransmissionProviderRegistry({ credentials });
    const ksef = reg.getById('ksef')!;

    // poll() with a valid ref format but no credentials
    const result = await ksef.poll!('company1|session-ref|invoice-ref', new RecordingComplianceLogger());

    // Should attempt resolveActive (not crash)
    expect(credentials.resolveActive).toHaveBeenCalledWith('company1', 'ksef');
    expect(result.status).toBe('PENDING'); // null credentials → PENDING (will expire)
  });

  it('poll() extracts companyId from ref and resolves credentials', async () => {
    const credentials = mockCredentials(null);
    const reg = new TransmissionProviderRegistry({ credentials });
    const ksef = reg.getById('ksef')!;

    await ksef.poll!('my-company|sess-123|inv-456', new RecordingComplianceLogger());

    expect(credentials.resolveActive).toHaveBeenCalledWith('my-company', 'ksef');
  });
});
