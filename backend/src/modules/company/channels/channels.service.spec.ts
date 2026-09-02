/**
 * ChannelCredentialsService in isolation — root TODO item 10 ("transports nationaux"). Mocks
 * `@/prisma/prisma.service` at its own entry point (the same discipline `company-transport.spec.ts`
 * already holds), so this proves the SERVICE's own logic (encryption round-trip, what a GET is and
 * is not allowed to carry, the "at most one active environment" invariant) — never a real database.
 *
 * `CREDENTIALS_ENCRYPTION_KEY` is set here, in-process, to a FIXED test value — the same pattern the
 * repère's own `pdp-live.spec.ts` used (`process.env.CREDENTIALS_ENCRYPTION_KEY ??= '...'`): this is
 * `utils/secret-crypto.ts`'s real AES-256-GCM, exercised for real, never mocked away.
 */
process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { ServiceUnavailableException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { encryptJson } from '@/utils/secret-crypto';
import { ChannelEnvironment } from '../../../../prisma/generated/prisma/client';
import { ChannelCredentialsService } from './channels.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companyChannelConfig: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    company: { findUnique: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  companyChannelConfig: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  company: { findUnique: jest.Mock };
};

describe('ChannelCredentialsService', () => {
  let service: ChannelCredentialsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChannelCredentialsService();
  });

  describe('upsertChannelConfig → resolve — the encryption round-trip', () => {
    it('encrypts on write, decrypts back to the EXACT same config on resolve()', async () => {
      const plainConfig = {
        baseUrl: 'https://api.superpdp.tech',
        clientId: 'id-1',
        clientSecret: 'shh-secret',
      };
      let storedEncrypted = '';

      mockedPrisma.companyChannelConfig.updateMany.mockResolvedValue({ count: 0 });
      mockedPrisma.companyChannelConfig.upsert.mockImplementation(async ({ create }) => {
        storedEncrypted = create.config;
        return {
          id: 'row-1',
          companyId: 'company-1',
          channel: create.channel,
          providerId: create.providerId,
          environment: create.environment,
          config: create.config,
          isActive: create.isActive,
        };
      });

      const status = await service.upsertChannelConfig('company-1', 'pdp', { config: plainConfig });

      // The RETURN VALUE of upsert is status-only — see the next describe block for the dedicated
      // proof; asserted again here in passing because a round-trip test that leaked the secret in
      // its own immediate response would be trivially misleading.
      expect(status).toEqual({
        providerId: 'pdp',
        channel: 'PDP',
        environment: ChannelEnvironment.TEST,
        isActive: true,
      });

      // What actually reached Prisma is CIPHERTEXT, never the plaintext secret verbatim.
      expect(storedEncrypted).not.toContain('shh-secret');
      expect(storedEncrypted).not.toEqual(JSON.stringify(plainConfig));

      // resolve() reads that SAME ciphertext back and decrypts it to the exact original object.
      mockedPrisma.companyChannelConfig.findUnique.mockResolvedValue({
        id: 'row-1',
        companyId: 'company-1',
        channel: 'PDP',
        providerId: 'pdp',
        environment: ChannelEnvironment.TEST,
        config: storedEncrypted,
        isActive: true,
      });

      const resolved = await service.resolve('company-1', 'pdp', 'TEST');
      expect(resolved).toEqual({
        providerId: 'pdp',
        channel: 'PDP',
        environment: ChannelEnvironment.TEST,
        config: plainConfig,
        isActive: true,
      });
    });

    it('resolve() returns null — never throws — for a row nobody ever created', async () => {
      mockedPrisma.companyChannelConfig.findUnique.mockResolvedValue(null);
      await expect(service.resolve('company-1', 'pdp', 'TEST')).resolves.toBeNull();
    });

    it('resolve() returns null for an INACTIVE row — a disconnect must never resolve', async () => {
      mockedPrisma.companyChannelConfig.findUnique.mockResolvedValue({
        id: 'row-1',
        companyId: 'company-1',
        channel: 'PDP',
        providerId: 'pdp',
        environment: ChannelEnvironment.TEST,
        config: 'irrelevant',
        isActive: false,
      });
      await expect(service.resolve('company-1', 'pdp', 'TEST')).resolves.toBeNull();
    });

    it('resolve()/resolveActive() are unavailable (not a crash) when the encryption key is absent', async () => {
      const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      try {
        await expect(service.resolve('company-1', 'pdp', 'TEST')).resolves.toBeNull();
        await expect(service.resolveActive('company-1', 'pdp')).resolves.toBeNull();
        expect(mockedPrisma.companyChannelConfig.findUnique).not.toHaveBeenCalled();
      } finally {
        process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    });
  });

  describe('resolveActive() — "exactly one active environment" invariant', () => {
    it('returns null when nothing is active', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([]);
      await expect(service.resolveActive('company-1', 'pdp')).resolves.toBeNull();
    });

    it('refuses (null, never a guess) when more than one environment is somehow active at once', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'a',
          companyId: 'company-1',
          channel: 'PDP',
          providerId: 'pdp',
          environment: 'TEST',
          config: '{}',
          isActive: true,
        },
        {
          id: 'b',
          companyId: 'company-1',
          channel: 'PDP',
          providerId: 'pdp',
          environment: 'PROD',
          config: '{}',
          isActive: true,
        },
      ]);
      await expect(service.resolveActive('company-1', 'pdp')).resolves.toBeNull();
    });

    it('upsertChannelConfig deactivates any OTHER environment when activating a new one — never two active', async () => {
      mockedPrisma.companyChannelConfig.updateMany.mockResolvedValue({ count: 1 });
      mockedPrisma.companyChannelConfig.upsert.mockResolvedValue({
        id: 'row-2',
        companyId: 'company-1',
        channel: 'PDP',
        providerId: 'pdp',
        environment: ChannelEnvironment.PROD,
        config: 'cipher',
        isActive: true,
      });

      await service.upsertChannelConfig('company-1', 'pdp', {
        environment: 'PROD',
        config: { baseUrl: 'x', clientId: 'y', clientSecret: 'z' },
      });

      expect(mockedPrisma.companyChannelConfig.updateMany).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          providerId: 'pdp',
          environment: { not: ChannelEnvironment.PROD },
          isActive: true,
        },
        data: { isActive: false },
      });
    });
  });

  describe('listCompanyChannels() — the GET the settings screen calls: STATUS ONLY', () => {
    it('never returns a "config" field, and never contains the secret value anywhere in its output', async () => {
      const secretMarker = 'THIS-MUST-NEVER-LEAK-be3f9c';
      const encrypted = encryptJson({
        baseUrl: 'https://api.superpdp.tech',
        clientId: 'id-1',
        clientSecret: secretMarker,
      });
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'PDP',
          providerId: 'pdp',
          environment: ChannelEnvironment.TEST,
          config: encrypted,
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');

      expect(rows).toEqual([
        { providerId: 'pdp', channel: 'PDP', environment: ChannelEnvironment.TEST, isActive: true },
      ]);
      for (const row of rows) {
        expect(Object.keys(row)).not.toContain('config');
      }
      // THE MUTATION PROOF (task mutation #2): if this method were changed to decrypt and return the
      // blob, this is the assertion that would catch it — the secret must not appear ANYWHERE in the
      // serialized response, not just absent from a named field.
      expect(JSON.stringify(rows)).not.toContain(secretMarker);
      expect(JSON.stringify(rows)).not.toContain(encrypted);
    });
  });

  describe('suggestedChannels() — reads the country file, never a hard-coded country check', () => {
    // Root TODO item 11 — France now MANDATES pdp (channel-policy/data/fr.json, mandatedFrom
    // 2026-09-01), not merely suggests it: this is the real, shipped shape, not a fixture, so the
    // test proves the SERVICE hands the mandate fields straight through, unmassaged.
    it("a French company's channel policy is pdp, MANDATED from 2026-09-01, with legal provenance", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      const facts = await service.suggestedChannels('company-1');
      expect(facts).toEqual([
        expect.objectContaining({
          providerId: 'pdp',
          requirement: 'mandated',
          mandatedFrom: '2026-09-01',
          provenance: expect.objectContaining({ kind: 'legal' }),
        }),
      ]);
    });

    it("a Polish company's channel policy is ksef, still merely SUGGESTED (no sourced mandate date yet)", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Poland', countryCode: 'PL' });
      const facts = await service.suggestedChannels('company-1');
      expect(facts).toEqual([
        expect.objectContaining({ providerId: 'ksef', requirement: 'suggested', effectiveNow: undefined }),
      ]);
    });

    it('a company whose country has no policy file gets an empty list, not a guess', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'United States', countryCode: 'US' });
      await expect(service.suggestedChannels('company-1')).resolves.toEqual([]);
    });
  });

  // Root TODO ("déclaration") — a NEW, categorically different concept from `suggestedChannels`
  // above: never a transport hint, always "declare this invoice's data to this authority". Reads
  // `documents/reporting/data/*.json`, the real, shipped files, not a fixture.
  describe('reportingObligations() — reads the country file, never a hard-coded country check', () => {
    it("a Hungarian company's reporting obligation is nav, with legal provenance", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Hungary', countryCode: 'HU' });
      const facts = await service.reportingObligations('company-1');
      expect(facts).toEqual([
        expect.objectContaining({
          providerId: 'nav',
          appliesTo: 'invoice',
          provenance: expect.objectContaining({ kind: 'legal' }),
        }),
      ]);
    });

    it("a Greek company's reporting obligation is mydata, honestly unverified", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Greece', countryCode: 'GR' });
      const facts = await service.reportingObligations('company-1');
      expect(facts).toEqual([
        expect.objectContaining({
          providerId: 'mydata',
          appliesTo: 'invoice',
          provenance: expect.objectContaining({ kind: 'unverified' }),
        }),
      ]);
    });

    it('a French company has no reporting obligation at all — not a guess', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      await expect(service.reportingObligations('company-1')).resolves.toEqual([]);
    });
  });

  describe('deleteChannelConfig() — disconnect', () => {
    it('reports deleted:true when a row actually existed', async () => {
      mockedPrisma.companyChannelConfig.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.deleteChannelConfig('company-1', 'pdp')).resolves.toEqual({ deleted: true });
    });

    it('reports deleted:false — not an error — when there was nothing to disconnect', async () => {
      mockedPrisma.companyChannelConfig.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteChannelConfig('company-1', 'pdp')).resolves.toEqual({ deleted: false });
    });
  });

  describe('upsertChannelConfig() — encryption unavailable', () => {
    it('throws ServiceUnavailableException rather than saving a secret in the clear', async () => {
      const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      try {
        await expect(
          service.upsertChannelConfig('company-1', 'pdp', { config: { clientSecret: 'x' } }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(mockedPrisma.companyChannelConfig.upsert).not.toHaveBeenCalled();
      } finally {
        process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    });
  });
});
