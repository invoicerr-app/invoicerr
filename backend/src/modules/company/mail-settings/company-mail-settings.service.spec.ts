/**
 * `CompanyMailSettingsService` — TODO_FEATURES.md entry G. Mocks `@/prisma/prisma.service` at its own
 * entry point (the same discipline `channels.service.spec.ts` already holds), so this proves this
 * SERVICE's own logic — the encryption round-trip through the REAL `ChannelCredentialsService`
 * (never mocked away), per-kind validation, and that `sendTest` propagates the REAL underlying error
 * rather than a generic one — never a real database.
 */
process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';

import { ChannelEnvironment } from '../../../../prisma/generated/prisma/client';
import { ChannelCredentialsService } from '../channels/channels.service';
import { CompanyMailSettingsService } from './company-mail-settings.service';
import { resolveCompanyMailSettings } from './company-mail-settings.resolver';

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
};

/** In-memory stand-in for the one `CompanyChannelConfig` row this feature ever writes, so `set()`
 *  followed by `getStatus()`/`resolveCompanyMailSettings()` exercises a REAL round-trip instead of
 *  each call being independently mocked. */
function wireInMemoryStore() {
  let row: {
    id: string;
    companyId: string;
    channel: string;
    providerId: string;
    environment: ChannelEnvironment;
    config: string;
    isActive: boolean;
  } | null = null;

  mockedPrisma.companyChannelConfig.updateMany.mockResolvedValue({ count: 0 });
  mockedPrisma.companyChannelConfig.upsert.mockImplementation(async ({ create }) => {
    row = { id: 'row-1', companyId: create.companyId, ...create };
    return row;
  });
  mockedPrisma.companyChannelConfig.findMany.mockImplementation(async () => (row ? [row] : []));
  mockedPrisma.companyChannelConfig.deleteMany.mockImplementation(async () => {
    const count = row ? 1 : 0;
    row = null;
    return { count };
  });
  return () => row;
}

describe('CompanyMailSettingsService', () => {
  let mailService: { sendForCompany: jest.Mock };
  let service: CompanyMailSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mailService = { sendForCompany: jest.fn() };
    service = new CompanyMailSettingsService(
      new ChannelCredentialsService(),
      mailService as unknown as MailService,
    );
  });

  describe('set / getStatus / resolveCompanyMailSettings — the encryption round-trip', () => {
    it('SMTP: stores ciphertext (never the plaintext password), status omits the secret, the resolver decrypts it back exactly', async () => {
      wireInMemoryStore();

      const status = await service.set('company-1', {
        kind: 'smtp',
        host: 'smtp.company.example.com',
        port: 587,
        secure: false,
        username: 'billing@company.example.com',
        password: 'super-secret-password',
        fromAddress: 'billing@company.example.com',
      });

      expect(status).toEqual({
        configured: true,
        kind: 'smtp',
        fromAddress: 'billing@company.example.com',
      });

      const storedConfig = mockedPrisma.companyChannelConfig.upsert.mock.calls[0][0].create.config;
      expect(storedConfig).not.toContain('super-secret-password');

      const resolved = await resolveCompanyMailSettings('company-1');
      expect(resolved).toEqual({
        kind: 'smtp',
        host: 'smtp.company.example.com',
        port: 587,
        secure: false,
        username: 'billing@company.example.com',
        password: 'super-secret-password',
        fromAddress: 'billing@company.example.com',
      });
    });

    it('Resend: stores ciphertext (never the plaintext API key), status omits the secret', async () => {
      wireInMemoryStore();

      const status = await service.set('company-1', {
        kind: 'resend',
        apiKey: 're_company_super_secret',
        fromAddress: 'billing@company.example.com',
      });

      expect(status).toEqual({
        configured: true,
        kind: 'resend',
        fromAddress: 'billing@company.example.com',
      });

      const storedConfig = mockedPrisma.companyChannelConfig.upsert.mock.calls[0][0].create.config;
      expect(storedConfig).not.toContain('re_company_super_secret');

      const resolved = await resolveCompanyMailSettings('company-1');
      expect(resolved).toEqual({
        kind: 'resend',
        apiKey: 're_company_super_secret',
        fromAddress: 'billing@company.example.com',
      });
    });

    it('getStatus reports unconfigured when nothing was ever written', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([]);
      await expect(service.getStatus('company-1')).resolves.toEqual({ configured: false });
    });
  });

  describe('validation', () => {
    it('rejects SMTP settings missing a required field', async () => {
      await expect(
        service.set('company-1', {
          kind: 'smtp',
          host: '',
          port: 587,
          secure: false,
          username: 'user',
          password: 'pass',
          fromAddress: 'from@example.com',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects Resend settings missing apiKey', async () => {
      await expect(
        service.set('company-1', { kind: 'resend', apiKey: '', fromAddress: 'from@example.com' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown kind', async () => {
      await expect(service.set('company-1', { kind: 'mailgun' } as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('clear', () => {
    it('reports deleted:true when a row existed, false otherwise', async () => {
      const getRow = wireInMemoryStore();
      await service.set('company-1', {
        kind: 'resend',
        apiKey: 're_key',
        fromAddress: 'from@example.com',
      });
      expect(getRow()).not.toBeNull();

      await expect(service.clear('company-1')).resolves.toEqual({ deleted: true });
      expect(getRow()).toBeNull();
      await expect(service.clear('company-1')).resolves.toEqual({ deleted: false });
    });
  });

  describe('sendTest — propagates the REAL error, never a generic one', () => {
    it('re-throws an HttpException from sendForCompany as-is', async () => {
      const refusal = new NotFoundException('No mail server is configured: ...');
      mailService.sendForCompany.mockRejectedValue(refusal);

      await expect(service.sendTest('company-1', 'me@example.com')).rejects.toBe(refusal);
    });

    it('wraps a raw provider Error in a BadRequestException carrying its EXACT message', async () => {
      mailService.sendForCompany.mockRejectedValue(
        new Error('Resend API returned HTTP 401: invalid API key'),
      );

      await expect(service.sendTest('company-1', 'me@example.com')).rejects.toThrow(
        'Resend API returned HTTP 401: invalid API key',
      );
    });

    it('sends to the given address with a recognizable subject on success', async () => {
      mailService.sendForCompany.mockResolvedValue({ message: 'Email sent successfully' });

      const result = await service.sendTest('company-1', 'me@example.com');

      expect(result).toEqual({ message: 'Email sent successfully' });
      expect(mailService.sendForCompany).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ to: 'me@example.com' }),
      );
    });
  });
});
