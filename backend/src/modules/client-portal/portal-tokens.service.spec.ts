import { NotFoundException } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';

import { PortalTokensService } from './portal-tokens.service';

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

function buildService(sendMail: jest.Mock): PortalTokensService {
  return new PortalTokensService({ sendMail } as unknown as MailService);
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
    expect(sendMail).toHaveBeenCalledWith(
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
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never fails the create when the email send itself throws — the token is still returned', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP down'));
    const service = buildService(sendMail);

    const result = await service.create('company-1', 'client-1');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.emailed).toBe(false);
  });

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
});
