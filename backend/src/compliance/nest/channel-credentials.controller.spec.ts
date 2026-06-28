import { ChannelCredentialsController } from './channel-credentials.controller';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { encryptJson } from '@/utils/secret-crypto';

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

/**
 * Minimal mock of PrismaService — only the methods the controller touches.
 */
function mockPrisma(rows: any[]) {
  return {
    companyChannelConfig: {
      findMany: jest.fn().mockResolvedValue(rows),
      upsert: jest.fn().mockImplementation(({ create }: any) =>
        Promise.resolve({ id: 'row_1', ...create }),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('ChannelCredentialsController — secret masking', () => {
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
    const prisma = mockPrisma([row]);
    const registry = new TransmissionProviderRegistry([ksefProvider as any]);
    const controller = new ChannelCredentialsController(prisma as any, registry);

    const result = await controller.listCompanyChannels(COMPANY_ID);

    expect(result).toHaveLength(1);
    const config = result[0].config;
    // authToken is secret → masked
    expect(config.authToken).toBe('•••• set');
    // nip is NOT secret → visible
    expect(config.nip).toBe('1234567890');
    // environment is NOT secret → visible
    expect(config.environment).toBe('test');
  });

  it('masks secret fields in upsertChannelConfig response', async () => {
    const prisma = mockPrisma([]);
    const registry = new TransmissionProviderRegistry([ksefProvider as any]);
    const controller = new ChannelCredentialsController(prisma as any, registry);

    const result = await controller.upsertChannelConfig(COMPANY_ID, {
      providerId: 'ksef',
      environment: 'TEST',
      config: { authToken: 'another-secret-token', nip: '9999999999', environment: 'test' },
    });

    expect(result.config.authToken).toBe('•••• set');
    expect(result.config.nip).toBe('9999999999');
  });

  it('masks ALL fields when provider schema is unknown', async () => {
    const unknownRow = { ...row, providerId: 'unknown-provider' };
    const prisma = mockPrisma([unknownRow]);
    const registry = new TransmissionProviderRegistry([]); // no matching provider
    const controller = new ChannelCredentialsController(prisma as any, registry);

    const result = await controller.listCompanyChannels(COMPANY_ID);

    expect(result).toHaveLength(1);
    const config = result[0].config;
    // ALL values masked when schema is unavailable
    expect(config.authToken).toBe('•••• set');
    expect(config.nip).toBe('•••• set');
    expect(config.environment).toBe('•••• set');
  });

  it('never returns decrypted secrets in the serialized output', async () => {
    const prisma = mockPrisma([row]);
    const registry = new TransmissionProviderRegistry([ksefProvider as any]);
    const controller = new ChannelCredentialsController(prisma as any, registry);

    const result = await controller.listCompanyChannels(COMPANY_ID);
    const serialized = JSON.stringify(result);
    // The actual secret value must never appear in the serialized output
    expect(serialized).not.toContain('super-secret-ksef-token-abc123');
  });
});
