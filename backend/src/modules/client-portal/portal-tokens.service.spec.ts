import { vi, type Mock } from 'vitest';

import { NotFoundException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

import { MailService } from '@/mail/mail.service';
import { resolveCompanyMailSettings } from '@/modules/company/mail-settings/company-mail-settings.resolver';

import { PortalTokensService } from './portal-tokens.service';

// Only used by the "company → instance" cascade tests near the bottom of this file — every other
// test here keeps using a bare fake `{ sendForCompany: vi.fn() }`, never touching this at all.
vi.mock('@/modules/company/mail-settings/company-mail-settings.resolver', () => ({
  resolveCompanyMailSettings: vi.fn(),
  // No test in this file exercises the Reply-To cascade itself (that is `mail.service.spec.ts`'s own
  // job) -- present only so `MailService#sendForCompany` (which now reads both resolvers) does not
  // throw "no such export" under Vitest's wholesale module mock.
  resolveCompanyReplyTo: vi.fn(),
}));
const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as Mock;

// Wholesale mock, deliberately: nothing in this file ever calls the REAL `createTransport` (both
// tests that need it below set their own `.mockReturnValue(...)` before exercising the SUT), and
// under Vitest a real ESM module's namespace object is frozen — `vi.spyOn(nodemailer,
// 'createTransport')` (what this file used under Jest, which could still monkey-patch the
// CJS-transpiled exports object) throws "Cannot redefine property: createTransport" here, same
// finding `mail.service.spec.ts` already documents. Mocking the module up front, then casting its
// export to `Mock` at each call site, is the Vitest-shaped equivalent.
vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

/**
 * `@/prisma/prisma.service` mocked with a tiny IN-MEMORY table, the same "mock the module boundary,
 * not a re-implementation of Prisma" discipline `share-links.service.spec.ts` already documents —
 * lets `create` -> `list` -> `revoke` run as a REAL round trip through `portal-token.persistence.ts`,
 * only the database itself is fake.
 */
vi.mock('@/prisma/prisma.service', () => {
  // #415: `contactEmail` moved off `Client` onto its `contacts` relation - this fake carries a
  // `contacts` array, exactly what a real `include: { contacts: ... }` query would return, so
  // `findOwnedClientOrThrow`'s own `withDerivedContactFields` resolves the SAME flat `contactEmail`
  // every test below still asserts on.
  const clients: Record<
    string,
    {
      id: string;
      companyId: string;
      name: string;
      contacts: { email: string | null; isPrimary: boolean }[];
      language?: string | null;
    }
  > = {
    'client-1': {
      id: 'client-1',
      companyId: 'company-1',
      name: 'Acme Client',
      contacts: [{ email: 'client@example.com', isPrimary: true }],
    },
    'client-no-email': {
      id: 'client-no-email',
      companyId: 'company-1',
      name: 'No Email Client',
      contacts: [],
    },
    // Multilingual client-facing mail (step 4 of the multilingual-mail plan) — a client with its own
    // `Client.language`, distinct from `company-1`'s (which never sets one below).
    'client-italian': {
      id: 'client-italian',
      companyId: 'company-1',
      name: 'Cliente Italiano',
      contacts: [{ email: 'cliente@example.it', isPrimary: true }],
      language: 'it',
    },
  };
  const companies: Record<string, { id: string; name: string; language?: string | null }> = {
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
        findFirst: vi.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
          const client = clients[where.id];
          return client && client.companyId === where.companyId ? client : null;
        }),
      },
      company: {
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const company = companies[where.id];
          if (!company) throw new Error(`no Company "${where.id}"`);
          return company;
        }),
      },
      clientPortalToken: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
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
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; companyId: string; clientId: string } }) => {
            return (
              rows.find(
                (r) => r.id === where.id && r.companyId === where.companyId && r.clientId === where.clientId,
              ) ?? null
            );
          },
        ),
        findMany: vi.fn(async ({ where }: { where: { companyId: string; clientId: string } }) => {
          return rows
            .filter((r) => r.companyId === where.companyId && r.clientId === where.clientId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`no ClientPortalToken "${where.id}"`);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`no ClientPortalToken "${where.id}"`);
          Object.assign(row, data);
          return row;
        }),
        updateMany: vi.fn(
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

// Just enough of the mocked module's `__rows` row shape for the two `vi.importMock` call sites below
// to type-check — the factory above has the full shape, this is only what those two sites read.
type MockedTokenRow = { tokenHash: string };

function buildService(sendForCompany: Mock): PortalTokensService {
  return new PortalTokensService({ sendForCompany } as unknown as MailService);
}

describe('PortalTokensService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // `jest.requireMock` had no async requirement; its Vitest equivalent, `vi.importMock`, resolves
    // the SAME cached manual-mock factory result (confirmed: `vi.mock('@/prisma/prisma.service', ...)`
    // above registers a "manual" mock in Vitest's module registry, and `importMock` returns that
    // registry entry's cached `resolve()` value rather than re-running or auto-mocking anything) —
    // just wrapped in a Promise, so every call site needs `await`.
    (await vi.importMock<{ __rows: MockedTokenRow[] }>('@/prisma/prisma.service')).__rows.length = 0;
  });

  it('404s inviting a client that does not belong to this company', async () => {
    const service = buildService(vi.fn());
    await expect(service.create('other-company', 'client-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mints a high-entropy token, persists ONLY its hash, and emails the invite', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
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

    const rows = (await vi.importMock<{ __rows: MockedTokenRow[] }>('@/prisma/prisma.service')).__rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(result.token);
  });

  // Multilingual client-facing mail (step 4 of the multilingual-mail plan) — proves the SERVICE
  // resolves `client.language` (falling back to `company.language`, per
  // `resolveRecipientLanguage`) and threads it into `buildPortalInviteEmail`, not just that the pure
  // builder itself can translate (already proven by portal-invite-email.spec.ts).
  it("emails the invite in the CLIENT's own language when Client.language is set", async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const service = buildService(sendMail);

    await service.create('company-1', 'client-italian');

    expect(sendMail).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        to: 'cliente@example.it',
        subject: expect.stringContaining('accedi al tuo portale clienti'),
        text: expect.stringContaining('Salve,'),
      }),
    );
  });

  it('falls back to English when neither the client nor the company set a language', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const service = buildService(sendMail);

    // `client-1`/`company-1` (this file's own default fixtures) set no `language` at all.
    await service.create('company-1', 'client-1');

    expect(sendMail).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ subject: expect.stringContaining('access your client portal') }),
    );
  });

  it('still creates a usable invite, unemailed, when the client has no contactEmail', async () => {
    const sendMail = vi.fn();
    const service = buildService(sendMail);

    const result = await service.create('company-1', 'client-no-email');
    expect(result.emailed).toBe(false);
    expect(result.emailStatus).toBe('no_contact_email');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never fails the create when the email send itself throws — the token is still returned', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('SMTP down'));
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
      const failingMail = vi.fn().mockRejectedValue(new Error('SMTP down'));
      const failed = await buildService(failingMail).create('company-1', 'client-1');
      expect(failed.emailed).toBe(false);
      expect(failed.emailStatus).toBe('send_failed');

      const unreachedMail = vi.fn();
      const noEmail = await buildService(unreachedMail).create('company-1', 'client-no-email');
      expect(noEmail.emailed).toBe(false);
      expect(noEmail.emailStatus).toBe('no_contact_email');
      expect(unreachedMail).not.toHaveBeenCalled();

      expect(failed.emailStatus).not.toBe(noEmail.emailStatus);
    },
  );

  it('lists what it created, then revoke turns it inactive — never deleted', async () => {
    const service = buildService(vi.fn().mockResolvedValue(undefined));
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
    const service = buildService(vi.fn().mockResolvedValue(undefined));
    const created = await service.create('company-1', 'client-1');

    await expect(service.revoke('company-1', 'client-no-email', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('revokeAll deactivates every active invite for the client in one call', async () => {
    const service = buildService(vi.fn().mockResolvedValue(undefined));
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
      vi.restoreAllMocks();
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
      // The company-SMTP branch validates its host against the shared SSRF guard before connecting,
      // which resolves it for real — and `company-smtp.example.com` deliberately does not exist.
      // WHICH addresses that guard refuses is proven in the mail-settings suite, not here.
      process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
      mockedResolveCompanyMailSettings.mockResolvedValue({
        kind: 'smtp',
        host: 'company-smtp.example.com',
        port: 587,
        secure: false,
        username: 'user',
        password: 'pass',
        fromAddress: 'billing@company.example.com',
      });
      const sendMailMock = vi.fn().mockResolvedValue(undefined);
      (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

      const service = new PortalTokensService(new MailService());
      await service.create('company-1', 'client-1');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'company-smtp.example.com' }),
      );
    });

    it('falls back to the instance mail server when this company has none configured', async () => {
      process.env.SMTP_HOST = 'instance-smtp.example.com';
      mockedResolveCompanyMailSettings.mockResolvedValue(null);
      const sendMailMock = vi.fn().mockResolvedValue(undefined);
      (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

      const service = new PortalTokensService(new MailService());
      const result = await service.create('company-1', 'client-1');

      expect(result.emailStatus).toBe('sent');
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'instance-smtp.example.com' }),
      );
    });
  });
});
