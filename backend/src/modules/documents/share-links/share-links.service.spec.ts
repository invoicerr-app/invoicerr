import { vi, type Mock } from 'vitest';

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ActionExtensionRegistry } from '../actions/action-extensions';
import { ActionRegistry } from '../actions/action-registry';
import { ContributionRegistry } from '../contributions/contribution-registry';
import * as countryPolicy from '../country-policy/country-policy';
import { buildExpenseDescriptor } from '../descriptors/expense.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from '../descriptors/field-kinds';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { DocumentsService } from '../documents.service';
import * as persistence from '../persistence';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { TransportRegistry } from '../transports/transport-registry';
import { hashShareLinkToken } from './share-link-token';
import { ShareLinksService } from './share-links.service';

vi.mock('../persistence');
vi.mock('../country-policy/country-policy');

type ShareLinkRow = {
  id: string;
  tokenHash: string;
  typeId: string;
  documentId: string;
  companyId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
};

/**
 * `@/prisma/prisma.service` is mocked with a tiny IN-MEMORY table, not a bare `vi.fn()` per
 * method — the same "mock the module boundary, not a re-implementation of Prisma" discipline
 * `documents.service.formats.spec.ts`'s own header already documents for the identical situation.
 * This is what lets `create` -> `list` -> `revoke` -> `resolvePublicToken` be exercised as a REAL
 * round trip through the actual `share-link.persistence.ts` module (only the database itself is
 * fake), rather than four separate tests each trusting a different hand-wired mock to agree with
 * the others.
 */
vi.mock('@/prisma/prisma.service', () => {
  const rows: ShareLinkRow[] = [];
  let nextId = 1;
  return {
    __esModule: true,
    default: {
      documentDownloadToken: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `token-${nextId++}`,
            createdAt: new Date(),
            revokedAt: null,
            ...data,
          } as (typeof rows)[number];
          rows.push(row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
          return rows.find((r) => r.tokenHash === where.tokenHash) ?? null;
        }),
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; companyId: string; documentId: string } }) => {
            return (
              rows.find(
                (r) =>
                  r.id === where.id && r.companyId === where.companyId && r.documentId === where.documentId,
              ) ?? null
            );
          },
        ),
        findMany: vi.fn(async ({ where }: { where: { companyId: string; documentId: string } }) => {
          return rows
            .filter((r) => r.companyId === where.companyId && r.documentId === where.documentId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`no DocumentDownloadToken "${where.id}"`);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error(`no DocumentDownloadToken "${where.id}"`);
          Object.assign(row, data);
          return row;
        }),
      },
    },
    // Exposed ONLY so this spec file can insert a row directly (an already-expired token, backdated
    // — see the "expired" test below) without going through `ShareLinksService.create`, which always
    // stamps `expiresAt` 30 days out. Not part of the real module's surface.
    __rows: rows,
  };
});

// Resolved once, in `beforeAll` — the same "vi.importMock, not Jest's synchronous require-the-mock
// helper" reasoning `documents.service.formats.spec.ts`'s own header now documents for the identical
// situation. Every requireMock('@/prisma/prisma.service') call site below becomes a read of this
// single, already-resolved reference instead.
let mockedPrismaService: { default: { documentDownloadToken: Record<string, Mock> }; __rows: ShareLinkRow[] };
beforeAll(async () => {
  mockedPrismaService = await vi.importMock('@/prisma/prisma.service');
});

function buildDocumentsService(): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  // "expense" declares NO "share-link" action at all (never numbered, never leaves "draft" — see
  // expense.descriptor.ts) — the fixture the 404 test below needs.
  typeRegistry.register(buildExpenseDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

function buildService(): ShareLinksService {
  return new ShareLinksService(buildDocumentsService());
}

const SENT_INSTANCE = {
  id: 'doc-1',
  typeId: 'invoice',
  status: 'sent',
  data: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  displayNumber: 'INV-2026-0001',
};

describe('ShareLinksService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrismaService.__rows.length = 0;
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({ allowed: true });
  });

  describe('create', () => {
    it('mints a high-entropy token, persists ONLY its hash, and the hash never equals the token', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);

      const service = buildService();
      const result = await service.create('company-1', 'invoice', 'doc-1');

      // >= 32 bytes of entropy, hex-encoded -> at least 64 hex chars (share-link-token.ts's own
      // TOKEN_BYTES = 32).
      expect(result.token).toMatch(/^[0-9a-f]{64,}$/);
      expect(result.path).toBe(`/api/public/documents/${result.token}/pdf`);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const rows = mockedPrismaService.__rows;
      expect(rows).toHaveLength(1);
      // THE assertion the mutation test has to break: the stored value is a DIGEST, not
      // the token itself, and it is computed the same way `resolvePublicToken` looks it up.
      expect(rows[0].tokenHash).not.toBe(result.token);
      expect(rows[0].tokenHash).toBe(hashShareLinkToken(result.token));
      expect(rows[0]).not.toHaveProperty('token');
    });

    it('refuses a draft by name — no number, no legal existence yet to share', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({ ...SENT_INSTANCE, status: 'draft' });

      const service = buildService();
      await expect(service.create('company-1', 'invoice', 'doc-1')).rejects.toThrow(ConflictException);
      await expect(service.create('company-1', 'invoice', 'doc-1')).rejects.toThrow(/no legal existence/);
      expect(mockedPrismaService.__rows).toHaveLength(0);
    });

    it('403s, naming the reason, when the country policy forbids the action', async () => {
      (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({
        allowed: false,
        reason: 'no policy for this country',
      });
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);

      const service = buildService();
      await expect(service.create('company-1', 'invoice', 'doc-1')).rejects.toThrow(ForbiddenException);
      await expect(service.create('company-1', 'invoice', 'doc-1')).rejects.toThrow(
        /no policy for this country/,
      );
    });

    it('404s for a document type that never declared "share-link" at all', async () => {
      const service = buildService();
      await expect(service.create('company-1', 'expense', 'doc-1')).rejects.toThrow(NotFoundException);
      await expect(service.create('company-1', 'expense', 'doc-1')).rejects.toThrow(/no action "share-link"/);
    });

    it('404s for an unknown document (tenant-scoped, via DocumentsService.getDocument)', async () => {
      (persistence.findOwnedDocument as Mock).mockRejectedValue(new NotFoundException('nope'));
      const service = buildService();
      await expect(service.create('company-1', 'invoice', 'doc-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list — metadata only, the token is NEVER re-consultable', () => {
    it('shows id/createdAt/expiresAt/revokedAt/active but never the token or its hash', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);
      const service = buildService();

      const created = await service.create('company-1', 'invoice', 'doc-1');
      const list = await service.list('company-1', 'invoice', 'doc-1');

      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: created.id, revokedAt: null, active: true });
      expect(list[0]).not.toHaveProperty('token');
      expect(list[0]).not.toHaveProperty('tokenHash');
      // The one and only place the raw token ever appeared was `created.token` — nothing in the
      // list response, stringified, contains it.
      expect(JSON.stringify(list)).not.toContain(created.token);
    });
  });

  describe('revoke', () => {
    it('soft-revokes — sets revokedAt, the row still exists, and the public link stops resolving', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);
      const service = buildService();

      const created = await service.create('company-1', 'invoice', 'doc-1');
      expect(await service.resolvePublicToken(created.token)).not.toBeNull();

      const outcome = await service.revoke('company-1', 'invoice', 'doc-1', created.id);
      expect(outcome).toEqual({ revoked: true });

      const list = await service.list('company-1', 'invoice', 'doc-1');
      expect(list[0].revokedAt).not.toBeNull();
      expect(list[0].active).toBe(false);

      // A hard delete would ALSO make the row vanish from `list` — it does not: the row survives,
      // only its own `active` flag flips. See share-link.persistence.ts's own header on why.
      expect(list).toHaveLength(1);

      expect(await service.resolvePublicToken(created.token)).toBeNull();
    });

    it('404s for an unknown share link id', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);
      const service = buildService();
      await expect(service.revoke('company-1', 'invoice', 'doc-1', 'no-such-token')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolvePublicToken — unknown / expired / revoked answer the SAME null, indistinguishably', () => {
    it('returns null for a token that was never minted', async () => {
      const service = buildService();
      expect(await service.resolvePublicToken('never-existed')).toBeNull();
    });

    it('returns null for an EXPIRED token', async () => {
      const prismaMock = mockedPrismaService;
      const rawToken = 'a'.repeat(64);
      await prismaMock.default.documentDownloadToken.create({
        data: {
          tokenHash: hashShareLinkToken(rawToken),
          typeId: 'invoice',
          documentId: 'doc-1',
          companyId: 'company-1',
          expiresAt: new Date(Date.now() - 1000), // already in the past
        },
      });

      const service = buildService();
      expect(await service.resolvePublicToken(rawToken)).toBeNull();
    });

    it('returns null for a REVOKED token', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);
      const service = buildService();
      const created = await service.create('company-1', 'invoice', 'doc-1');
      await service.revoke('company-1', 'invoice', 'doc-1', created.id);

      expect(await service.resolvePublicToken(created.token)).toBeNull();
    });

    it('the three refusals are the exact same value — not merely all falsy', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);
      const service = buildService();

      const created = await service.create('company-1', 'invoice', 'doc-1');
      await service.revoke('company-1', 'invoice', 'doc-1', created.id);

      const prismaMock = mockedPrismaService;
      const expiredToken = 'b'.repeat(64);
      await prismaMock.default.documentDownloadToken.create({
        data: {
          tokenHash: hashShareLinkToken(expiredToken),
          typeId: 'invoice',
          documentId: 'doc-1',
          companyId: 'company-1',
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const unknown = await service.resolvePublicToken('never-existed-either');
      const expired = await service.resolvePublicToken(expiredToken);
      const revoked = await service.resolvePublicToken(created.token);

      expect(unknown).toBe(null);
      expect(expired).toBe(null);
      expect(revoked).toBe(null);
      expect([unknown, expired, revoked]).toEqual([null, null, null]);
    });

    it('resolves a valid, unexpired, non-revoked token to its company/type/document', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_INSTANCE);
      const service = buildService();

      const created = await service.create('company-1', 'invoice', 'doc-1');
      expect(await service.resolvePublicToken(created.token)).toEqual({
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
      });
    });
  });
});
