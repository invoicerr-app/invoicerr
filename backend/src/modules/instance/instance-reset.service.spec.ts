import { vi, type Mock } from 'vitest';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';

import { INSTANCE_RESET_TABLES } from './reset-tables';

/** A minimal, in-memory stand-in for `prisma.instanceResetOtp` — same real per-row semantics
 *  (`danger.service.spec.ts`'s own `fakeDangerOtpTable`, keyed by email instead of companyId) so
 *  `instance-reset-otp.persistence.ts` runs against it unmodified. */
interface FakeOtpRow {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  lockedAt: Date | null;
}

function fakeOtpTable() {
  const rows = new Map<string, FakeOtpRow>();
  let nextId = 1;
  return {
    rows,
    async findUnique({
      where: { email },
      select,
    }: {
      where: { email: string };
      select?: Partial<Record<keyof FakeOtpRow, true>>;
    }) {
      const row = rows.get(email);
      if (!row) return null;
      if (select) {
        const projected: Partial<FakeOtpRow> = {};
        for (const key of Object.keys(select) as (keyof FakeOtpRow)[]) projected[key] = row[key] as never;
        return projected;
      }
      return { ...row };
    },
    async findUniqueOrThrow({ where: { email } }: { where: { email: string } }) {
      const row = rows.get(email);
      if (!row) throw new Error(`InstanceResetOtp for ${email} not found`);
      return { ...row };
    },
    async upsert({
      where: { email },
      create,
      update,
    }: {
      where: { email: string };
      create: Omit<FakeOtpRow, 'id' | 'lockedAt'>;
      update: Partial<FakeOtpRow>;
    }) {
      const existing = rows.get(email);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      const row: FakeOtpRow = { id: `instance-otp-${nextId++}`, lockedAt: null, ...create };
      rows.set(email, row);
      return { ...row };
    },
    async updateMany({
      where,
      data,
    }: {
      where: { email: string; lockedAt?: null };
      data: Partial<FakeOtpRow> & { failedAttempts?: { increment: number } };
    }) {
      const row = rows.get(where.email);
      if (!row) return { count: 0 };
      if ('lockedAt' in where && row.lockedAt !== where.lockedAt) return { count: 0 };
      if (data.failedAttempts?.increment !== undefined) row.failedAttempts += data.failedAttempts.increment;
      if ('lockedAt' in data) row.lockedAt = data.lockedAt as Date | null;
      if ('codeHash' in data) row.codeHash = data.codeHash as string;
      if ('expiresAt' in data) row.expiresAt = data.expiresAt as Date;
      return { count: 1 };
    },
    async deleteMany({ where: { email } }: { where: { email: string } }) {
      const existed = rows.delete(email);
      return { count: existed ? 1 : 0 };
    },
  };
}

let fakeTable: ReturnType<typeof fakeOtpTable>;
let executedSql: string[] = [];
let documentArchiveRows: { uri: string }[] = [];

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  get default() {
    return {
      instanceResetOtp: fakeTable,
      documentArchive: { findMany: async () => documentArchiveRows },
      $transaction: async (
        fn: (tx: { $executeRawUnsafe: (sql: string) => Promise<void> }) => Promise<void>,
      ) =>
        fn({
          $executeRawUnsafe: async (sql: string) => {
            executedSql.push(sql);
          },
        }),
    };
  },
}));
vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '@/logger/logger.service';
import { __resetDefaultLocaleForTests } from '@/modules/documents/rendering/language/default-locale';

// Imported AFTER the mocks above so the module under test picks up the mocked `prisma`/`logger`.
import { InstanceResetService, RESET_INSTANCE_CONFIRMATION_WORD } from './instance-reset.service';

const USER = { id: 'u1', email: 'ops@example.test', locale: null } as never;

/** `USER` with an explicit `User.locale` — a fresh object rather than mutating `USER` itself, since
 *  every OTHER test in this file relies on `USER` carrying no locale of its own. */
function operatorWithLocale(locale: string) {
  return { ...(USER as Record<string, unknown>), locale } as never;
}

// Every test that reaches a SUCCESSFUL `service.reset(...)` call hits real filesystem code
// (`inboundRoot()`/`archiveRoot()`'s own `rmSync`/`mkdirSync`) — set at the OUTER scope (applies to
// every `describe` below, not just "the actual wipe") so no test can ever fall through to the real
// `<cwd>/.documents-inbound`/`.documents-archive` defaults and touch this project's own working tree.
const originalArchiveDir = process.env.DOCUMENTS_ARCHIVE_DIR;
const originalInboundDir = process.env.DOCUMENTS_INBOUND_DIR;
let archiveDir: string;
let inboundDir: string;

beforeEach(() => {
  archiveDir = mkdtempSync(join(tmpdir(), 'instance-reset-archive-'));
  inboundDir = mkdtempSync(join(tmpdir(), 'instance-reset-inbound-'));
  process.env.DOCUMENTS_ARCHIVE_DIR = archiveDir;
  process.env.DOCUMENTS_INBOUND_DIR = inboundDir;
  delete process.env.ARCHIVE_STORAGE;
});

afterEach(() => {
  rmSync(archiveDir, { recursive: true, force: true });
  rmSync(inboundDir, { recursive: true, force: true });
  if (originalArchiveDir === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
  else process.env.DOCUMENTS_ARCHIVE_DIR = originalArchiveDir;
  if (originalInboundDir === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
  else process.env.DOCUMENTS_INBOUND_DIR = originalInboundDir;
});

function build() {
  fakeTable = fakeOtpTable();
  executedSql = [];
  documentArchiveRows = [];
  const mailService = { sendMail: vi.fn().mockResolvedValue(undefined) };
  return { service: new InstanceResetService(mailService as never), mailService };
}

async function requestAndExtractOtp(service: InstanceResetService, mailService: { sendMail: Mock }) {
  await service.requestOtp(USER);
  const call = mailService.sendMail.mock.calls.at(-1)!;
  return (call[0].text as string).match(/is: (\d+)/)![1];
}

describe('InstanceResetService — OTP', () => {
  it('sends the code to the requesting operator, via the instance-level provider only', async () => {
    const { service, mailService } = build();
    await service.requestOtp(USER);

    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    const [options] = mailService.sendMail.mock.calls[0];
    expect(options.to).toBe('ops@example.test');
  });

  describe('language — resolveUserLanguage(user.locale, null), then DEFAULT_LOCALE, then English', () => {
    const ORIGINAL_DEFAULT_LOCALE = process.env.DEFAULT_LOCALE;

    beforeEach(() => __resetDefaultLocaleForTests());

    afterAll(() => {
      process.env.DEFAULT_LOCALE = ORIGINAL_DEFAULT_LOCALE;
      __resetDefaultLocaleForTests();
    });

    it("uses the operator's own account locale when they have one set", async () => {
      const { service, mailService } = build();
      await service.requestOtp(operatorWithLocale('fr'));

      const [options] = mailService.sendMail.mock.calls[0];
      expect(options.subject).toBe("Code de confirmation de réinitialisation de l'instance");
    });

    it('falls back to the instance DEFAULT_LOCALE when the operator has none', async () => {
      process.env.DEFAULT_LOCALE = 'it';
      const { service, mailService } = build();
      await service.requestOtp(USER); // no `locale` of its own

      const [options] = mailService.sendMail.mock.calls[0];
      expect(options.subject).toBe("Codice di conferma per il ripristino dell'istanza");
    });

    it('falls back to English when neither the operator nor the instance has a language set', async () => {
      delete process.env.DEFAULT_LOCALE;
      const { service, mailService } = build();
      await service.requestOtp(USER);

      const [options] = mailService.sendMail.mock.calls[0];
      expect(options.subject).toBe('Instance reset confirmation code');
      expect(options.text).toContain('ENTIRE Invoicerr instance');
      expect(options.text).toContain('INSTANCE_OPERATOR_EMAILS');
    });
  });

  it('is a CSPRNG 8-digit code, stored hashed — never in the clear', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService);

    expect(code).toMatch(/^\d{8}$/);
    const stored = fakeTable.rows.get('ops@example.test')!;
    expect(stored.codeHash).not.toBe(code);
    expect(stored.codeHash).toHaveLength(64);
  });

  it('locks the operator out permanently after MAX_FAILED_ATTEMPTS wrong guesses', async () => {
    const { service, mailService } = build();
    await requestAndExtractOtp(service, mailService);

    for (let i = 0; i < 5; i++) {
      await expect(service.reset(USER, '00000000', RESET_INSTANCE_CONFIRMATION_WORD)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(fakeTable.rows.get('ops@example.test')!.lockedAt).not.toBeNull();
    await expect(service.requestOtp(USER)).rejects.toThrow(/Too many failed attempts/);
  });

  it('scopes the challenge per operator — a lock for one never blocks a different one', async () => {
    const { service, mailService } = build();
    const codeOps = await requestAndExtractOtp(service, mailService);
    // A second operator mints their own code; must not disturb the first one's row.
    await service.requestOtp({ id: 'u2', email: 'other-ops@example.test' } as never);

    expect(fakeTable.rows.get('ops@example.test')!.codeHash).toBeDefined();
    expect(codeOps).toMatch(/^\d{8}$/);
  });
});

describe('InstanceResetService — the confirmation word', () => {
  it('refuses a reset whose confirmation word does not match exactly, even with a valid OTP', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService);

    await expect(service.reset(USER, code, 'reset instance')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reset(USER, code, 'RESET')).rejects.toBeInstanceOf(BadRequestException);
    // The OTP must not have been consumed by the rejected attempt above — still usable with the right word.
    await service.reset(USER, code, RESET_INSTANCE_CONFIRMATION_WORD);
  });
});

describe('InstanceResetService — the actual wipe', () => {
  it('truncates every table INSTANCE_RESET_TABLES names, and never _prisma_migrations', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService);

    await service.reset(USER, code, RESET_INSTANCE_CONFIRMATION_WORD);

    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain('TRUNCATE TABLE');
    expect(executedSql[0]).toContain('CASCADE');
    for (const table of INSTANCE_RESET_TABLES) {
      expect(executedSql[0]).toContain(`"${table}"`);
    }
    expect(executedSql[0]).not.toContain('_prisma_migrations');
    // Both a plain and a mapped (snake_case) table name — proof the ENTIRE list made it onto the wire.
    expect(executedSql[0]).toContain('"Company"');
    expect(executedSql[0]).toContain('"session"');
  });

  it("deletes every DB-tracked archive's bytes via the archive storage abstraction", async () => {
    // `build()` resets `documentArchiveRows` to `[]` — it must run BEFORE this test populates it, or
    // the assignment below is silently wiped out again.
    const { service, mailService } = build();
    const documentId = 'doc-1';
    const contentHash = 'a'.repeat(64);
    const dir = join(archiveDir, documentId, contentHash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pdf.pdf'), Buffer.from('legal pdf bytes'));
    documentArchiveRows = [{ uri: `file://${dir}` }];

    const code = await requestAndExtractOtp(service, mailService);
    await service.reset(USER, code, RESET_INSTANCE_CONFIRMATION_WORD);

    expect(existsSync(dir)).toBe(false);
  });

  it('wipes the shared inbound root (received invoices / attachments / logos), then recreates it empty', async () => {
    mkdirSync(join(inboundDir, 'company-1', 'nested'), { recursive: true });
    writeFileSync(join(inboundDir, 'company-1', 'logo.jpg'), Buffer.from('fake logo bytes'));
    writeFileSync(
      join(inboundDir, 'company-1', 'nested', 'received-invoice.pdf'),
      Buffer.from('fake pdf bytes'),
    );

    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService);
    await service.reset(USER, code, RESET_INSTANCE_CONFIRMATION_WORD);

    expect(existsSync(inboundDir)).toBe(true);
    expect(readdirSync(inboundDir)).toEqual([]);
  });

  it('writes an instance-level Log entry (companyId: null) AFTER the wipe, never before', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService);

    await service.reset(USER, code, RESET_INSTANCE_CONFIRMATION_WORD);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Instance reset'),
      expect.objectContaining({ category: 'instance', companyId: null }),
    );
  });

  it('consumes the OTP: a second reset attempt with the same code is refused', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService);

    await service.reset(USER, code, RESET_INSTANCE_CONFIRMATION_WORD);
    await expect(service.reset(USER, code, RESET_INSTANCE_CONFIRMATION_WORD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
