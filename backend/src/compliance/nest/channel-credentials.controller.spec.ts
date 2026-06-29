import { ChannelSettingsService } from './channel-settings.service';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { encryptJson } from '@/utils/secret-crypto';
import type { PrismaService } from '@/prisma/prisma.service';

const COMPANY_ID = 'comp_test_001';
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(() => { process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY; });
afterAll(() => { delete process.env.CREDENTIALS_ENCRYPTION_KEY; });

const ksefProvider = {
  id: 'ksef',
  channel: 'GOV_PORTAL_API',
  configSchema: {
    fields: [
      { type: 'select' as const, name: 'environment', label: 'Env', options: [] },
      { type: 'text' as const, name: 'authToken', label: 'Token', secret: true },
      { type: 'text' as const, name: 'nip', label: 'NIP' },
    ],
  },
};

/** Minimal stub of PrismaService — only the methods the service touches. */
function mockPrisma(rows: any[]): PrismaService {
  return {
    companyChannelConfig: {
      findMany: jest.fn().mockResolvedValue(rows),
      upsert: jest.fn().mockImplementation(({ create }: any) =>
        Promise.resolve({ id: 'row_1', ...create }),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
}

describe('ChannelSettingsService — secret masking', () => {
  let encryptedBlob: string;
  let row: any;

  beforeAll(() => {
    encryptedBlob = encryptJson({
      authToken: 'super-secret-ksef-token-abc123',
      nip: '1234567890',
      environment: 'test',
    });
    row = {
      id: 'row_1',
      companyId: COMPANY_ID,
      channel: 'GOV_PORTAL_API',
      providerId: 'ksef',
      environment: 'TEST',
      config: encryptedBlob,
      isActive: true,
    };
  });

  it('masks secret fields in listCompanyChannels', async () => {
    const registry = new TransmissionProviderRegistry([ksefProvider as any]);
    const service = new ChannelSettingsService(mockPrisma([row]), registry);

    const result = await service.listCompanyChannels(COMPANY_ID);

    expect(result).toHaveLength(1);
    const config = result[0].config;
    expect(config.authToken).toBe('•••• set');
    expect(config.nip).toBe('1234567890');
    expect(config.environment).toBe('test');
  });

  it('masks secret fields in upsertChannelConfig response', async () => {
    const registry = new TransmissionProviderRegistry([ksefProvider as any]);
    const service = new ChannelSettingsService(mockPrisma([]), registry);

    const result = await service.upsertChannelConfig(COMPANY_ID, {
      providerId: 'ksef',
      environment: 'TEST',
      config: { authToken: 'another-secret-token', nip: '9999999999', environment: 'test' },
    });

    expect(result.config.authToken).toBe('•••• set');
    expect(result.config.nip).toBe('9999999999');
  });

  it('masks ALL fields when provider schema is unknown', async () => {
    const unknownRow = { ...row, providerId: 'unknown-provider' };
    const registry = new TransmissionProviderRegistry([]); // no matching provider
    const service = new ChannelSettingsService(mockPrisma([unknownRow]), registry);

    const result = await service.listCompanyChannels(COMPANY_ID);

    expect(result).toHaveLength(1);
    const config = result[0].config;
    expect(config.authToken).toBe('•••• set');
    expect(config.nip).toBe('•••• set');
    expect(config.environment).toBe('•••• set');
  });

  it('never returns decrypted secrets in the serialized output', async () => {
    const registry = new TransmissionProviderRegistry([ksefProvider as any]);
    const service = new ChannelSettingsService(mockPrisma([row]), registry);

    const result = await service.listCompanyChannels(COMPANY_ID);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret-ksef-token-abc123');
  });
});
