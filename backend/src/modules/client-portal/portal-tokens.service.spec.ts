import { NotFoundException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

import { MailService } from '@/mail/mail.service';
import { resolveCompanyMailSettings } from '@/modules/company/mail-settings/company-mail-settings.resolver';

import { PortalTokensService } from './portal-tokens.service';

// Only used by the "company → instance" cascade tests near the bottom of this file — every other
// test here keeps using a bare fake `{ sendForCompany: jest.fn() }`, never touching this at all.
jest.mock('@/modules/company/mail-settings/company-mail-settings.resolver', () => ({
  resolveCompanyMailSettings: jest.fn(),
}));
const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as jest.Mock;

/**
 * `@/prisma/prisma.service` mocked with a tiny IN-MEMORY table, the same "mock the module boundary,
 * not a re-implementation of Prisma" discipline `share-links.service.spec.ts` already documents —
 * lets `create` -> `list` -> `revoke` run as a REAL round trip through `portal-token.persistence.ts`,
 * only the database itself is fake.
 */
jest.mock('@/prisma/prisma.service', () => {
  const clients: Record<
    string,
    { id: string; companyId: string; name: string; contactEmail: string | null }
  > = {
    'client-1': {
      id: 'client-1',
      companyId: 'company-1',
      name: 'Acme Client',
      contactEmail: 'client@example.com',
    },
    'client-no-email': {
      id: 'client-no-email',
      companyId: 'company-1',
      name: 'No Email Client',
      contactEmail: null,
    },
  };
  const companies: Record<string, { id: string; name: string }> = {
    'company-1': { id: 'company-1', name: 'Acme Corp' },
  };
  const rows: Array<{
    id: string;
    tokenHash: string;
    clientId: string;
    companyId: string;
    expiresAt: Date;
    createdAt: Date;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
  }> = [];
  let nextId = 1;

  return {
    __esModule: true,
    default: {
      client: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
          const client = clients[where.id];
          return client && client.companyId === where.companyId ? client : null;
        }),
      },
      company: {
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
          const company = companies[where.id];
          if (!company) throw new Error(`no Company "${where.id}"`);
          return company;
        }),
      },
      clientPortalToken: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `token-${nextId++}`,
            createdAt: new Date(),
            revokedAt: null,
            lastUsedAt: null,
            ...data,
          } as (typeof rows)[number];
          rows.push(row);
          return row;
        }),
        findFirst: jest.fn(
          async ({ where }: { where: { id: string; companyId: string; clientId: string } }) => {
            return (
              rows.find(
                (r) => r.id === where.id && r.companyId === where.companyId && r.clientId === where.clientId,
              ) ?? null
            );
          },
        ),
        findMany: jest.fn(async ({ where }: { where: { companyId: string; clientId: string } }) => {
          return rows
            .filter((r) => r.companyId === where.companyId && r.clientId === where.clientId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }),
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`no ClientPortalToken "${where.id}"`);
          return row;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`no ClientPortalToken "${where.id}"`);
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(
          async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            let count = 0;
            for (const row of rows) {
              if (
                row.companyId === where.companyId &&
                row.clientId === where.clientId &&
                row.revokedAt === null
              ) {
                Object.assign(row, data);
                count++;
              }
            }
            return { count };
          },
        ),
      },
    },
    __rows: rows,
  };
});

function buildService(sendForCompany: jest.Mock): PortalTokensService {
  return new PortalTokensService({ sendForCompany } as unknown as MailService);
}

describe('PortalTokensService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (jest.requireMock('@/prisma/prisma.service').__rows as unknown[]).length = 0;
  });

  it('404s inviting a client that does not belong to this company', async () => {
    const service = buildService(jest.fn());
    await expect(service.create('other-company', 'client-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mints a high-entropy token, persists ONLY its hash, and emails the invite', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const service = buildService(sendMail);

    const result = await service.create('company-1', 'client-1');

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.path).toBe(`/portal/${result.token}`);
    expect(result.emailed).toBe(true);
    expect(result.emailStatus).toBe('sent');
    expect(sendMail).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ to: 'client@example.com', subject: expect.stringContaining('Acme Corp') }),
    );

    const rows = jest.requireMock('@/prisma/prisma.service').__rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(result.token);
  });

  it('still creates a usable invite, unemailed, when the client has no contactEmail', async () => {
    const sendMail = jest.fn();
    const service = buildService(sendMail);

    const result = await service.create('company-1', 'client-no-email');
    expect(result.emailed).toBe(false);
    expect(result.emailStatus).toBe('no_contact_email');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never fails the create when the email send itself throws — the token is still returned', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP down'));
    const service = buildService(sendMail);

    const result = await service.create('company-1', 'client-1');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.emailed).toBe(false);
    expect(result.emailStatus).toBe('send_failed');
  });

  it(
    'distinguishes "no email on file" from "send failed" via emailStatus — the frontend used to ' +
      'show the same message for both',
    async () => {
      const failingMail = jest.fn().mockRejectedValue(new Error('SMTP down'));
      const failed = await buildService(failingMail).create('company-1', 'client-1');
      expect(failed.emailed).toBe(false);
      expect(failed.emailStatus).toBe('send_failed');

      const unreachedMail = jest.fn();
      const noEmail = await buildService(unreachedMail).create('company-1', 'client-no-email');
      expect(noEmail.emailed).toBe(false);
      expect(noEmail.emailStatus).toBe('no_contact_email');
      expect(unreachedMail).not.toHaveBeenCalled();

      expect(failed.emailStatus).not.toBe(noEmail.emailStatus);
    },
  );

  it('lists what it created, then revoke turns it inactive — never deleted', async () => {
    const service = buildService(jest.fn().mockResolvedValue(undefined));
    const created = await service.create('company-1', 'client-1');

    const before = await service.list('company-1', 'client-1');
    expect(before).toHaveLength(1);
    expect(before[0].active).toBe(true);

    await service.revoke('company-1', 'client-1', created.id);

    const after = await service.list('company-1', 'client-1');
    expect(after).toHaveLength(1);
    expect(after[0].active).toBe(false);
    expect(after[0].revokedAt).not.toBeNull();
  });

  it('404s revoking a token that belongs to a different client', async () => {
    const service = buildService(jest.fn().mockResolvedValue(undefined));
    const created = await service.create('company-1', 'client-1');

    await expect(service.revoke('company-1', 'client-no-email', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('revokeAll deactivates every active invite for the client in one call', async () => {
    const service = buildService(jest.fn().mockResolvedValue(undefined));
    await service.create('company-1', 'client-1');
    await service.create('company-1', 'client-1');

    await service.revokeAll('company-1', 'client-1');

    const after = await service.list('company-1', 'client-1');
    expect(after.every((row) => !row.active)).toBe(true);
  });

  // The two tests below use a REAL `MailService` (only `resolveCompanyMailSettings` and
  // `nodemailer.createTransport` are mocked, the same doubles `mail.service.spec.ts` itself uses) —
  // every test above already proves the invite's OWN addressing/content against a fake
  // `sendForCompany`; this is the one place proving the invite genuinely reaches the right transport.
  describe('invite emails go through the société → instance → refus-nommé cascade', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
      jest.restoreAllMocks();
      mockedResolveCompanyMailSettings.mockReset();
      process.env = { ...ORIGINAL_ENV };
      delete process.env.MAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      delete process.env.SMTP_HOST;
    });

    afterAll(() => {
      process.env = ORIGINAL_ENV;
    });

    it("uses THIS company's own SMTP server when Settings → Mail has one configured", async () => {
      process.env.SMTP_HOST = 'instance-smtp.example.com'; // instance IS configured too — must be ignored
      mockedResolveCompanyMailSettings.mockResolvedValue({
        kind: 'smtp',
        host: 'company-smtp.example.com',
        port: 587,
        secure: false,
        username: 'user',
        password: 'pass',
        fromAddress: 'billing@company.example.com',
      });
      const sendMailMock = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

      const service = new PortalTokensService(new MailService());
      await service.create('company-1', 'client-1');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'company-smtp.example.com' }),
      );
    });

    it('falls back to the instance mail server when this company has none configured', async () => {
      process.env.SMTP_HOST = 'instance-smtp.example.com';
      mockedResolveCompanyMailSettings.mockResolvedValue(null);
      const sendMailMock = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

      const service = new PortalTokensService(new MailService());
      const result = await service.create('company-1', 'client-1');

      expect(result.emailStatus).toBe('sent');
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'instance-smtp.example.com' }),
      );
    });
  });
});
