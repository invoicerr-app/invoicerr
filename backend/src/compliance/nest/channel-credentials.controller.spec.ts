import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ChannelSettingsService } from './channel-settings.service';
import { ChannelCredentialsController } from './channel-credentials.controller';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { encryptJson } from '@/utils/secret-crypto';
import type { PrismaService } from '@/prisma/prisma.service';
import { RolesGuard } from '@/guards/roles.guard';
import { CompanyRole } from '../../../prisma/generated/prisma/client';

const COMPANY_ID = 'comp_test_001';
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
});
afterAll(() => {
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
});

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
      upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'row_1', ...create })),
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

/**
 * IDOR regression — ChannelCredentialsController used to trust `@Param('id')` for the
 * company being read/written, so any authenticated user (any company, any role) could
 * read or overwrite another tenant's channel credentials just by putting that tenant's
 * company id in the URL. The fix scopes every handler to `@ActiveCompany()` (the caller's
 * session-derived active company) and gates mutations behind `@Roles(OWNER, ADMIN)`.
 *
 * This boots the REAL controller behind the REAL RolesGuard over actual HTTP, with a
 * test-only middleware standing in for AuthGuard (it just sets request.companyId/role from
 * headers, exactly like AuthGuard does from the session) — so the param-decorator wiring on
 * the controller is genuinely exercised, not re-implemented. Before the fix, test 1 would
 * observe the service being called with the URL's foreign company id, and test 2 would get
 * a 200 rather than 403 (no @Roles metadata existed on the mutation handlers).
 */
describe('ChannelCredentialsController — cross-tenant IDOR regression', () => {
  let app: INestApplication;
  let baseUrl: string;

  const channels = {
    listProviders: jest.fn(() => []),
    getRequiredChannels: jest.fn(async () => []),
    listCompanyChannels: jest.fn(async (companyId: string) => [{ companyId }]),
    upsertChannelConfig: jest.fn(async (companyId: string, body: unknown) => ({ companyId, body })),
    deleteChannelConfig: jest.fn(async () => ({ deleted: true })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChannelCredentialsController],
      providers: [
        { provide: ChannelSettingsService, useValue: channels },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Stand-in for AuthGuard: populates request.companyId/role from test-only headers so each
    // request can impersonate a different caller, without touching better-auth/Prisma.
    app.use((req: any, _res: any, next: any) => {
      req.companyId = req.headers['x-test-company-id'] ?? null;
      req.role = req.headers['x-test-role'] ?? null;
      req.companies = [];
      next();
    });
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('a company-B MEMBER reading /companies/company-A only ever sees company B (session), never A (URL)', async () => {
    const res = await fetch(`${baseUrl}/compliance/channels/companies/company-A`, {
      headers: { 'x-test-company-id': 'company-B', 'x-test-role': CompanyRole.MEMBER },
    });
    expect(res.status).toBe(200);
    expect(channels.listCompanyChannels).toHaveBeenCalledWith('company-B');
    expect(channels.listCompanyChannels).not.toHaveBeenCalledWith('company-A');
  });

  it('a company-B MEMBER cannot upsert a channel config at all (OWNER/ADMIN only) → 403', async () => {
    const res = await fetch(`${baseUrl}/compliance/channels/companies/company-A`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-test-company-id': 'company-B',
        'x-test-role': CompanyRole.MEMBER,
      },
      body: JSON.stringify({ providerId: 'ksef', config: {} }),
    });
    expect(res.status).toBe(403);
    expect(channels.upsertChannelConfig).not.toHaveBeenCalled();
  });

  it('a company-B OWNER upserting via /companies/company-A in the URL still only writes to company B', async () => {
    const res = await fetch(`${baseUrl}/compliance/channels/companies/company-A`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-test-company-id': 'company-B',
        'x-test-role': CompanyRole.OWNER,
      },
      body: JSON.stringify({ providerId: 'ksef', config: {} }),
    });
    expect(res.status).toBe(200);
    expect(channels.upsertChannelConfig).toHaveBeenCalledWith(
      'company-B',
      expect.objectContaining({ providerId: 'ksef' }),
    );
    expect(channels.upsertChannelConfig).not.toHaveBeenCalledWith('company-A', expect.anything());
  });

  it('a company-B MEMBER cannot delete company A\'s channel config → 403', async () => {
    const res = await fetch(`${baseUrl}/compliance/channels/companies/company-A/ksef`, {
      method: 'DELETE',
      headers: { 'x-test-company-id': 'company-B', 'x-test-role': CompanyRole.MEMBER },
    });
    expect(res.status).toBe(403);
    expect(channels.deleteChannelConfig).not.toHaveBeenCalled();
  });
});
