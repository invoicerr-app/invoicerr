/**
 * `CompanyMailSettingsService` — the write side of the mail-server cascade (company → instance →
 * named refusal). Mocks `@/prisma/prisma.service` at its own entry point (the same discipline
 * `channels.service.spec.ts` already holds), so this proves this
 * SERVICE's own logic — the encryption round-trip through the REAL `ChannelCredentialsService`
 * (never mocked away), per-kind validation, and which failures `sendTest` is allowed to report — never
 * a real database. The SSRF guard on the SMTP host/port, and what a failed send may say about the
 * network, are `company-mail-settings.ssrf.spec.ts`'s job.
 */

import { vi, type Mock } from 'vitest';

process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// `set()` now validates the SMTP endpoint against the shared SSRF guard before storing it, which
// RESOLVES the host for real. Nothing in this file is about that decision (its own spec, hermetic
// against a mocked resolver, is `company-mail-settings.ssrf.spec.ts`), and the example hostnames below
// deliberately do not exist — without this hatch every round-trip test here would depend on what the
// machine running the suite answers for them.
process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { MailDeliveryError } from '@/mail/mail-endpoint-guard';
import { MailService } from '@/mail/mail.service';

import { ChannelEnvironment } from '../../../../prisma/generated/prisma/client';
import { ChannelCredentialsService } from '../channels/channels.service';
import {
  CompanyMailSettingsService,
  UNEXPECTED_TEST_SEND_FAILURE_MESSAGE,
} from './company-mail-settings.service';
import { resolveCompanyMailSettings } from './company-mail-settings.resolver';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companyChannelConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    // Backs `Company.mailReplyTo` — a plain, unencrypted read/write (see that column's own
    // schema.prisma comment), unlike `companyChannelConfig` above.
    company: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  companyChannelConfig: {
    findUnique: Mock;
    findMany: Mock;
    upsert: Mock;
    update: Mock;
    updateMany: Mock;
    deleteMany: Mock;
  };
  company: {
    findUnique: Mock;
    update: Mock;
  };
};

/** In-memory stand-in for `Company.mailReplyTo`, so `setReplyTo()` followed by `getStatus()`
 *  exercises a real round-trip the same way `wireInMemoryStore()` below does for the mail-server
 *  override — independent state, since the two are independent settings. */
function wireInMemoryReplyTo(initial: string | null = null) {
  let value: string | null = initial;
  mockedPrisma.company.findUnique.mockImplementation(async () => ({ mailReplyTo: value }));
  mockedPrisma.company.update.mockImplementation(async ({ data }) => {
    value = (data.mailReplyTo as string | null) ?? null;
    return { mailReplyTo: value };
  });
  return () => value;
}

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
  let mailService: { sendForCompany: Mock };
  let service: CompanyMailSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mailService = { sendForCompany: vi.fn() };
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
        replyTo: null,
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
        replyTo: null,
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
      await expect(service.getStatus('company-1')).resolves.toEqual({
        configured: false,
        replyTo: null,
      });
    });
  });

  describe('setReplyTo / getStatus — the Reply-To override, independent of the mail-server one', () => {
    it('rejects an invalid e-mail address, never storing it', async () => {
      wireInMemoryReplyTo();

      await expect(service.setReplyTo('company-1', { replyTo: 'not-an-email' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockedPrisma.company.update).not.toHaveBeenCalled();
    });

    it('stores a valid address, trimmed, and getStatus reads it back', async () => {
      const getValue = wireInMemoryReplyTo();

      const status = await service.setReplyTo('company-1', { replyTo: '  support@company.example.com  ' });

      expect(getValue()).toBe('support@company.example.com');
      expect(status).toEqual({ configured: false, replyTo: 'support@company.example.com' });
    });

    it('null clears the override back to unset — never stored as an empty string', async () => {
      const getValue = wireInMemoryReplyTo('support@company.example.com');

      const status = await service.setReplyTo('company-1', { replyTo: null });

      expect(getValue()).toBeNull();
      expect(status.replyTo).toBeNull();
    });

    it('a blank string clears the override the same way null does', async () => {
      const getValue = wireInMemoryReplyTo('support@company.example.com');

      await service.setReplyTo('company-1', { replyTo: '   ' });

      expect(getValue()).toBeNull();
    });

    it('getStatus reports the Reply-To override even when no mail-server override exists at all', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([]);
      wireInMemoryReplyTo('support@company.example.com');

      await expect(service.getStatus('company-1')).resolves.toEqual({
        configured: false,
        replyTo: 'support@company.example.com',
      });
    });

    it("is unaffected by clearing the company's own mail server (DELETE never touches replyTo)", async () => {
      const getMailServer = wireInMemoryStore();
      const getReplyTo = wireInMemoryReplyTo();

      await service.set('company-1', { kind: 'resend', apiKey: 're_key', fromAddress: 'from@example.com' });
      await service.setReplyTo('company-1', { replyTo: 'support@company.example.com' });
      expect(getMailServer()).not.toBeNull();
      expect(getReplyTo()).toBe('support@company.example.com');

      await service.clear('company-1');

      expect(getMailServer()).toBeNull();
      expect(getReplyTo()).toBe('support@company.example.com');
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

  describe('sendTest — reports the real reason, as long as it is one this server vetted', () => {
    it('re-throws an HttpException from sendForCompany as-is', async () => {
      const refusal = new NotFoundException('No mail server is configured: ...');
      mailService.sendForCompany.mockRejectedValue(refusal);

      await expect(service.sendTest('company-1', 'me@example.com')).rejects.toBe(refusal);
    });

    it('wraps a MailDeliveryError in a BadRequestException carrying its EXACT message', async () => {
      // What `sendForCompany` actually raises for every mail outcome — a message already vetted as
      // safe to show a tenant (`mail-endpoint-guard.ts`). A test button whose failures all read
      // "check your configuration" would be useless, so this detail has to survive.
      mailService.sendForCompany.mockRejectedValue(
        new MailDeliveryError('Resend API returned HTTP 401: invalid API key'),
      );

      await expect(service.sendTest('company-1', 'me@example.com')).rejects.toThrow(
        'Resend API returned HTTP 401: invalid API key',
      );
    });

    it('replaces an error that is NOT a mail outcome — its text describes this server, not these settings', async () => {
      // A decryption fault, a database error: whatever it is, it did not come from the mail cascade,
      // so its message is about this server's internals and has no business on a settings screen.
      mailService.sendForCompany.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.42:5432'));

      const thrown = await service.sendTest('company-1', 'me@example.com').catch((error: Error) => error);

      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as Error).message).toBe(UNEXPECTED_TEST_SEND_FAILURE_MESSAGE);
      expect((thrown as Error).message).not.toContain('10.0.0.42');
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

    it('defaults to English when no language is given', async () => {
      mailService.sendForCompany.mockResolvedValue({ message: 'ok' });
      await service.sendTest('company-1', 'me@example.com');
      expect(mailService.sendForCompany).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ subject: 'Invoicerr — test email' }),
      );
    });

    it("uses the requester's own language when given", async () => {
      mailService.sendForCompany.mockResolvedValue({ message: 'ok' });
      await service.sendTest('company-1', 'me@example.com', 'pt');
      expect(mailService.sendForCompany).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ subject: 'Invoicerr — e-mail de teste' }),
      );
    });
  });
});
