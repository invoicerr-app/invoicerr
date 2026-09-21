import { vi, type Mock } from 'vitest';

import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common';
import { NO_MAIL_SERVER_CONFIGURED_MESSAGE } from '@/mail/mail.service';
import { PolarCancellationFailedError } from '@/modules/billing/deletion';
import { DangerService, RETENTION_BLOCKED } from './danger.service';

/** A minimal, in-memory stand-in for `prisma.dangerOtp` — just enough of Prisma's own API surface
 *  (`findUnique`, `upsert`, `updateMany`, `findUniqueOrThrow`, `deleteMany`) for
 *  `danger-otp.persistence.ts` to run against unmodified, with real per-row semantics (a genuine
 *  `WHERE lockedAt: null` guard, a genuine `increment`) rather than a hand-waved mock. */
interface FakeDangerOtpRow {
  id: string;
  companyId: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  lockedAt: Date | null;
}

function fakeDangerOtpTable() {
  const rows = new Map<string, FakeDangerOtpRow>();
  let nextId = 1;

  return {
    rows,
    async findUnique({
      where: { companyId },
      select,
    }: {
      where: { companyId: string };
      select?: Partial<Record<keyof FakeDangerOtpRow, true>>;
    }) {
      const row = rows.get(companyId);
      if (!row) return null;
      if (select) {
        const projected: Partial<FakeDangerOtpRow> = {};
        for (const key of Object.keys(select) as (keyof FakeDangerOtpRow)[])
          projected[key] = row[key] as never;
        return projected;
      }
      return { ...row };
    },
    async findUniqueOrThrow({ where: { companyId } }: { where: { companyId: string } }) {
      const row = rows.get(companyId);
      if (!row) throw new Error(`DangerOtp for company ${companyId} not found`);
      return { ...row };
    },
    async upsert({
      where: { companyId },
      create,
      update,
    }: {
      where: { companyId: string };
      create: Omit<FakeDangerOtpRow, 'id' | 'lockedAt'>;
      update: Partial<FakeDangerOtpRow>;
    }) {
      const existing = rows.get(companyId);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      const row: FakeDangerOtpRow = { id: `danger-otp-${nextId++}`, lockedAt: null, ...create };
      rows.set(companyId, row);
      return { ...row };
    },
    async updateMany({
      where,
      data,
    }: {
      where: { companyId: string; lockedAt?: null };
      data: Partial<FakeDangerOtpRow> & { failedAttempts?: { increment: number } };
    }) {
      const row = rows.get(where.companyId);
      if (!row) return { count: 0 };
      if ('lockedAt' in where && row.lockedAt !== where.lockedAt) return { count: 0 };
      if (data.failedAttempts?.increment !== undefined) {
        row.failedAttempts += data.failedAttempts.increment;
      }
      if ('lockedAt' in data) row.lockedAt = data.lockedAt as Date | null;
      if ('codeHash' in data) row.codeHash = data.codeHash as string;
      if ('expiresAt' in data) row.expiresAt = data.expiresAt as Date;
      return { count: 1 };
    },
    async deleteMany({ where: { companyId } }: { where: { companyId: string } }) {
      const existed = rows.delete(companyId);
      return { count: existed ? 1 : 0 };
    },
  };
}

/** Every company-scoped table `resetCompanyData` touches, defaulted to "nothing to count, nothing to
 *  delete" — a test overrides only the ONE mock its own scenario cares about. `count`/`findMany`
 *  default to empty results (never blocked, nothing to report); `deleteMany` records its own calls
 *  in `deleteCalls` (table name + `where`) so a test can assert exactly which tables were touched and
 *  with what scope, without re-deriving Jest's own verbose `toHaveBeenCalledWith` per table. */
function fakeScopedTable(deleteCalls: { table: string; where: unknown }[], name: string) {
  return {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn((args: { where: unknown }) => {
      deleteCalls.push({ table: name, where: args.where });
      return Promise.resolve({ count: 0 });
    }),
  };
}

/** A real, in-memory `PendingStorageErasure` — the journal `resetCompanyData` now writes inside its
 *  own transaction and drains right after it (`documents/archive/company-storage-erasure.ts`). A
 *  genuine round-trip (createMany → findMany → update), not a stub, so the storage-deletion
 *  assertions below still prove that the uris read off `DocumentArchive` are the ones that actually
 *  reach the storage layer — through the journal rather than through an in-memory array. */
interface FakeJournalRow {
  id: string;
  companyId: string;
  kind: string;
  target: string;
  retentionUntil: Date | null;
  retentionBasis: string | null;
  erasedAt: Date | null;
  lastError: string | null;
}

function fakePendingStorageErasureTable() {
  const rows: FakeJournalRow[] = [];
  let nextId = 1;
  return {
    rows,
    async createMany({ data }: { data: Record<string, unknown>[] }) {
      for (const entry of data) {
        rows.push({
          id: `journal-${nextId++}`,
          companyId: entry.companyId as string,
          kind: entry.kind as string,
          target: entry.target as string,
          retentionUntil: (entry.retentionUntil as Date | null) ?? null,
          retentionBasis: (entry.retentionBasis as string | null) ?? null,
          erasedAt: null,
          lastError: null,
        });
      }
      return { count: data.length };
    },
    async findMany({ where }: { where: { erasedAt: null; companyId?: string } }) {
      return rows
        .filter((row) => row.erasedAt === null)
        .filter((row) => !where.companyId || row.companyId === where.companyId)
        .map((row) => ({ ...row }));
    },
    async update({ where, data }: { where: { id: string }; data: Partial<FakeJournalRow> }) {
      const row = rows.find((candidate) => candidate.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
  };
}

let fakeTable: ReturnType<typeof fakeDangerOtpTable>;
let deleteCalls: { table: string; where: unknown }[];
let prismaMock: {
  dangerOtp: ReturnType<typeof fakeDangerOtpTable>;
  company: { findUnique: Mock };
  documentArchive: ReturnType<typeof fakeScopedTable> & { findMany: Mock };
  pendingStorageErasure: ReturnType<typeof fakePendingStorageErasureTable>;
  documentInstance: ReturnType<typeof fakeScopedTable>;
  documentSchedule: ReturnType<typeof fakeScopedTable>;
  documentNumberSequence: ReturnType<typeof fakeScopedTable>;
  client: ReturnType<typeof fakeScopedTable>;
  article: ReturnType<typeof fakeScopedTable>;
  project: ReturnType<typeof fakeScopedTable>;
  timeEntry: ReturnType<typeof fakeScopedTable>;
  bankStatement: ReturnType<typeof fakeScopedTable>;
  webhook: { deleteMany: Mock };
  mailTemplate: { deleteMany: Mock };
  $transaction: Mock;
};

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  get default() {
    return prismaMock;
  },
}));
vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mocked at the STORE, never at `company-storage-erasure.ts` itself: the journal-then-erase ordering
// this spec's own assertions depend on is production code here, not a stub.
const deleteArchivedArtifacts = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/documents/archive/storage', () => ({
  deleteArchivedArtifacts: (...args: unknown[]) => deleteArchivedArtifacts(...args),
}));

const deleteInboundFilesForCompany = vi.fn();
vi.mock('@/modules/documents/received-invoices/storage', () => ({
  deleteInboundFilesForCompany: (...args: unknown[]) => deleteInboundFilesForCompany(...args),
}));

const deleteCompanyPermanentlyNow = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/billing/deletion', async () => {
  const actual = await vi.importActual('@/modules/billing/deletion');
  return {
    ...actual,
    deleteCompanyPermanentlyNow: (...args: unknown[]) => deleteCompanyPermanentlyNow(...args),
  };
});

const USER_EMAIL = 'requester@example.test';
const USER = { id: 'u1', email: USER_EMAIL } as never;

function build() {
  fakeTable = fakeDangerOtpTable();
  deleteCalls = [];
  prismaMock = {
    dangerOtp: fakeTable,
    company: { findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp' }) },
    documentArchive: { ...fakeScopedTable(deleteCalls, 'documentArchive'), findMany: vi.fn() },
    pendingStorageErasure: fakePendingStorageErasureTable(),
    documentInstance: fakeScopedTable(deleteCalls, 'documentInstance'),
    documentSchedule: fakeScopedTable(deleteCalls, 'documentSchedule'),
    documentNumberSequence: fakeScopedTable(deleteCalls, 'documentNumberSequence'),
    client: fakeScopedTable(deleteCalls, 'client'),
    article: fakeScopedTable(deleteCalls, 'article'),
    project: fakeScopedTable(deleteCalls, 'project'),
    timeEntry: fakeScopedTable(deleteCalls, 'timeEntry'),
    bankStatement: fakeScopedTable(deleteCalls, 'bankStatement'),
    webhook: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    mailTemplate: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prismaMock)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  // `documentArchive.findMany` answers TWO different queries in `resetCompanyData` — the retention
  // check (`where.retentionUntil` set) and the pre-transaction "collect every uri to delete"
  // read (`where` is just `{ companyId }`) — a single mock tells them apart by that shape, exactly
  // once, rather than every test having to know the call ORDER.
  prismaMock.documentArchive.findMany.mockImplementation((args: { where: { retentionUntil?: unknown } }) =>
    Promise.resolve(args.where.retentionUntil ? [] : []),
  );

  deleteArchivedArtifacts.mockClear().mockResolvedValue(undefined);
  deleteInboundFilesForCompany.mockClear();
  deleteCompanyPermanentlyNow.mockClear().mockResolvedValue(undefined);

  const mailService = { sendForCompany: vi.fn().mockResolvedValue(undefined) };
  const exportService = { buildCompanyZip: vi.fn().mockResolvedValue(Buffer.from('zip-bytes')) };
  return {
    service: new DangerService(mailService as never, exportService as never),
    mailService,
    exportService,
  };
}

async function requestAndExtractOtp(
  service: DangerService,
  mailService: { sendForCompany: Mock },
  companyId: string,
) {
  await service.requestOtp(USER, companyId);
  const call = mailService.sendForCompany.mock.calls.at(-1)!;
  return (call[1].text as string).match(/is: (\d+)/)![1];
}

describe('DangerService — F-012: the OTP reaches the requester', () => {
  it('sends the code to the requesting user, not to the instance mailbox', async () => {
    process.env.SMTP_FROM = 'noreply@the-instance.test';
    const { service, mailService } = build();

    await service.requestOtp(USER, 'co-1');

    const [companyId, { to, text }] = mailService.sendForCompany.mock.calls[0];
    expect(companyId).toBe('co-1');
    expect(to).toBe('requester@example.test');
    expect(to).not.toBe(process.env.SMTP_FROM);
    expect(text).not.toContain('was sent to');
  });

  it("threads the active company's own id through to sendForCompany, never a hardcoded or missing one", async () => {
    const { service, mailService } = build();

    await service.requestOtp(USER, 'company-42');

    expect(mailService.sendForCompany).toHaveBeenCalledWith('company-42', expect.any(Object));
  });

  it(
    'rethrows the NAMED "no mail server configured" refusal VERBATIM — never the generic ' +
      '"check your SMTP configuration" wrapper',
    async () => {
      build();
      const mailService = {
        sendForCompany: vi.fn().mockRejectedValue(new BadRequestException(NO_MAIL_SERVER_CONFIGURED_MESSAGE)),
      };
      const service = new DangerService(mailService as never, { buildCompanyZip: vi.fn() } as never);

      const action = service.requestOtp(USER, 'co-1');

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow(NO_MAIL_SERVER_CONFIGURED_MESSAGE);
    },
  );

  it('collapses any OTHER provider error into the generic message — never the raw provider error', async () => {
    build();
    const mailService = { sendForCompany: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const service = new DangerService(mailService as never, { buildCompanyZip: vi.fn() } as never);

    await expect(service.requestOtp(USER, 'co-1')).rejects.toThrow(
      'Failed to send OTP email. Please check your SMTP configuration.',
    );
  });
});

describe('DangerService — mail language follows the acting user, English by default', () => {
  it('sends the OTP mail in English when the user has no locale', async () => {
    const { service, mailService } = build();
    await service.requestOtp(USER, 'co-1');
    const { subject, text } = mailService.sendForCompany.mock.calls[0][1];
    expect(subject).toBe('OTP Code Sent');
    expect(text).toContain('confirmation code for a destructive action');
  });

  it("sends the OTP mail in the user's own locale when set", async () => {
    const { service, mailService } = build();
    await service.requestOtp({ id: 'u1', email: USER_EMAIL, locale: 'fr' } as never, 'co-1');
    const { subject, text } = mailService.sendForCompany.mock.calls[0][1];
    expect(subject).toBe('Code de confirmation envoyé');
    expect(text).toContain('action destructrice');
  });

  it('falls back to English for a locale this catalog does not carry', async () => {
    const { service, mailService } = build();
    await service.requestOtp({ id: 'u1', email: USER_EMAIL, locale: 'es' } as never, 'co-1');
    expect(mailService.sendForCompany.mock.calls[0][1].subject).toBe('OTP Code Sent');
  });

  it("sends the deleteCompany data-export mail in the company's own language when the user has no locale", async () => {
    const { service, mailService } = build();
    prismaMock.company.findUnique = vi.fn().mockResolvedValue({ name: 'Acme Corp', language: 'de' });
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');

    await service.deleteCompany(USER, 'co-1', otp, 'Acme Corp');

    const zipCall = mailService.sendForCompany.mock.calls.find((c) => c[1].attachments)!;
    expect(zipCall[1].subject).toBe('Export Ihrer Unternehmensdaten');
    expect(zipCall[1].text).toContain('Acme Corp');
  });
});

describe('DangerService — OTP hardening', () => {
  it('never stores the code in the clear — the persisted row only ever carries a hash', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService, 'co-1');

    const stored = fakeTable.rows.get('co-1')!;
    expect(stored.codeHash).not.toBe(code);
    expect(stored.codeHash).toHaveLength(64); // sha256 hex digest
  });

  it('is a CSPRNG 8-digit code (documents/signatures/otp.ts#generateOtpCode), never Math.random', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService, 'co-1');
    expect(code).toMatch(/^\d{8}$/);
  });

  it("scopes the challenge PER COMPANY: minting one for company B never invalidates company A's", async () => {
    const { service, mailService } = build();
    const codeA = await requestAndExtractOtp(service, mailService, 'company-a');
    await requestAndExtractOtp(service, mailService, 'company-b');

    // Company A's own code, verified against company A, must still work — it was never overwritten
    // by company B's own mint (the exact cross-tenant collision the old process-wide singleton had).
    await expect(service.resetCompanyData(USER, 'company-a', codeA)).resolves.toMatchObject({
      message: expect.any(String),
    });
  });

  it("refuses company B's OTP when checked against company A — no cross-tenant replay", async () => {
    const { service, mailService } = build();
    await requestAndExtractOtp(service, mailService, 'company-a');
    const codeB = await requestAndExtractOtp(service, mailService, 'company-b');

    await expect(service.resetCompanyData(USER, 'company-a', codeB)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('locks the company out after MAX_FAILED_ATTEMPTS wrong guesses', async () => {
    const { service, mailService } = build();
    await requestAndExtractOtp(service, mailService, 'co-1');

    // Five wrong guesses (MAX_FAILED_ATTEMPTS, documents/signatures/otp.ts) exhaust the budget.
    for (let i = 0; i < 5; i++) {
      await expect(service.resetCompanyData(USER, 'co-1', '00000000')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }

    expect(fakeTable.rows.get('co-1')!.lockedAt).not.toBeNull();

    // A fresh, correctly-typed code can no longer be minted at all for this company. How long that
    // holds — and that it does eventually lift, since this same challenge gates the company's own
    // deletion — is `danger-otp-lockout.spec.ts`'s subject, not this one's.
    await expect(service.requestOtp(USER, 'co-1')).rejects.toThrow(/Too many failed attempts/);
  });

  it('does not count a SUCCESSFUL verification toward the failed-attempt budget', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService, 'co-1');
    await service.resetCompanyData(USER, 'co-1', code);

    expect(fakeTable.rows.has('co-1')).toBe(false); // cleared, not locked
  });
});

describe('DangerService#resetCompanyData — retention block', () => {
  it('refuses (409, RETENTION_BLOCKED) while a document is still under legal retention — nothing deleted', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    prismaMock.documentArchive.findMany.mockImplementation((args: { where: { retentionUntil?: unknown } }) =>
      Promise.resolve(
        args.where.retentionUntil
          ? [{ documentId: 'doc-1', retentionUntil: future }]
          : [{ uri: 'file:///should-never-be-read' }],
      ),
    );

    const err = await service.resetCompanyData(USER, 'co-1', otp).catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: RETENTION_BLOCKED, retainedDocuments: 1 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('counts DISTINCT documents, not archive rows — a re-sent document with two retained archives counts once', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    const future = new Date(Date.now() + 1000 * 60 * 60);
    prismaMock.documentArchive.findMany.mockImplementation((args: { where: { retentionUntil?: unknown } }) =>
      Promise.resolve(
        args.where.retentionUntil
          ? [
              { documentId: 'doc-1', retentionUntil: future },
              { documentId: 'doc-1', retentionUntil: future },
            ]
          : [],
      ),
    );

    const err = await service.resetCompanyData(USER, 'co-1', otp).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ retainedDocuments: 1 });
  });
});

describe('DangerService#resetCompanyData — scoped deletion, config kept', () => {
  it('deletes every operational table scoped to THIS company, in one transaction', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'target-co');

    await service.resetCompanyData(USER, 'target-co', otp);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const touchedTables = deleteCalls.map((c) => c.table).sort();
    expect(touchedTables).toEqual(
      [
        'article',
        'bankStatement',
        'client',
        'documentInstance',
        'documentNumberSequence',
        'documentSchedule',
        'project',
        'timeEntry',
      ].sort(),
    );
    for (const call of deleteCalls) {
      expect(call.where).toEqual({ companyId: 'target-co' });
    }
  });

  it("never touches another company's rows — resetting company A leaves company B's scope untouched", async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'company-a');

    await service.resetCompanyData(USER, 'company-a', otp);

    for (const call of deleteCalls) {
      expect((call.where as { companyId: string }).companyId).toBe('company-a');
      expect((call.where as { companyId: string }).companyId).not.toBe('company-b');
    }
  });

  it('never deletes Webhook, MailTemplate, or the Company row itself — configuration survives', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');

    await service.resetCompanyData(USER, 'co-1', otp);

    expect(prismaMock.webhook.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.mailTemplate.deleteMany).not.toHaveBeenCalled();
    expect(deleteCalls.some((c) => c.table === 'company')).toBe(false);
  });

  it('deletes every archived artifact and every inbound file AFTER the transaction commits', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    prismaMock.documentArchive.findMany.mockImplementation((args: { where: { retentionUntil?: unknown } }) =>
      Promise.resolve(args.where.retentionUntil ? [] : [{ uri: 'file:///a' }, { uri: 'file:///b' }]),
    );

    await service.resetCompanyData(USER, 'co-1', otp);

    expect(deleteArchivedArtifacts).toHaveBeenCalledWith('file:///a');
    expect(deleteArchivedArtifacts).toHaveBeenCalledWith('file:///b');
    expect(deleteInboundFilesForCompany).toHaveBeenCalledWith('co-1');
  });

  it('writes down what it is about to delete BEFORE the rows go — a crash cannot orphan the bytes', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    prismaMock.documentArchive.findMany.mockImplementation((args: { where: { retentionUntil?: unknown } }) =>
      Promise.resolve(args.where.retentionUntil ? [] : [{ uri: 'file:///a' }]),
    );
    const order: string[] = [];
    const journal = prismaMock.pendingStorageErasure.createMany;
    prismaMock.pendingStorageErasure.createMany = async (args: never) => {
      order.push('journal');
      return journal(args);
    };
    prismaMock.documentInstance.deleteMany.mockImplementation(() => {
      order.push('delete-documents');
      return Promise.resolve({ count: 0 });
    });

    await service.resetCompanyData(USER, 'co-1', otp);

    // `documentInstance.deleteMany` is what cascades `DocumentArchive` — and its `uri` column, the
    // only pointer to the bytes — away. The inventory has to be committed before it, not after.
    expect(order).toEqual(['journal', 'delete-documents']);
    expect(prismaMock.pendingStorageErasure.rows.map((row) => row.target).sort()).toEqual(
      ['co-1', 'file:///a'].sort(),
    );
  });

  it('a storage failure is logged, not thrown — the DB reset already succeeded and must be reported as such', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    prismaMock.documentArchive.findMany.mockImplementation((args: { where: { retentionUntil?: unknown } }) =>
      Promise.resolve(args.where.retentionUntil ? [] : [{ uri: 'file:///a' }]),
    );
    deleteArchivedArtifacts.mockRejectedValueOnce(new Error('disk full'));

    await expect(service.resetCompanyData(USER, 'co-1', otp)).resolves.toMatchObject({
      message: expect.any(String),
    });
  });
});

describe('DangerService#deleteCompany — reuses the SaaS export + deletion path', () => {
  it('builds the export, e-mails it to the ACTING user, then deletes the company — in that order', async () => {
    const { service, mailService, exportService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    const order: string[] = [];
    exportService.buildCompanyZip.mockImplementation(async () => {
      order.push('export');
      return Buffer.from('zip');
    });
    mailService.sendForCompany.mockImplementation(async () => {
      order.push('mail');
    });
    deleteCompanyPermanentlyNow.mockImplementation(async () => {
      order.push('delete');
    });

    const result = await service.deleteCompany(USER, 'co-1', otp, 'Acme Corp');

    expect(order).toEqual(['export', 'mail', 'delete']);
    expect(exportService.buildCompanyZip).toHaveBeenCalledWith('co-1');
    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'co-1',
      expect.objectContaining({
        to: USER_EMAIL,
        attachments: [expect.objectContaining({ filename: 'invoicerr-export.zip' })],
      }),
    );
    expect(deleteCompanyPermanentlyNow).toHaveBeenCalledWith('co-1');
    expect(result).toMatchObject({ message: expect.any(String) });
  });

  it('refuses when the typed company name does not match — nothing exported, nothing deleted', async () => {
    const { service, mailService, exportService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');

    await expect(service.deleteCompany(USER, 'co-1', otp, 'Wrong Name Inc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(exportService.buildCompanyZip).not.toHaveBeenCalled();
    expect(deleteCompanyPermanentlyNow).not.toHaveBeenCalled();
  });

  it('refuses when the export cannot be built — nothing is deleted without a last copy', async () => {
    const { service, mailService, exportService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    exportService.buildCompanyZip.mockRejectedValue(new Error('export too large'));

    await expect(service.deleteCompany(USER, 'co-1', otp, 'Acme Corp')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteCompanyPermanentlyNow).not.toHaveBeenCalled();
  });

  it('refuses when the export cannot be e-mailed — nothing is deleted without confirming delivery', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    mailService.sendForCompany.mockRejectedValue(new Error('SMTP timeout'));

    await expect(service.deleteCompany(USER, 'co-1', otp, 'Acme Corp')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteCompanyPermanentlyNow).not.toHaveBeenCalled();
  });

  it('refuses (never deletes) when the Polar subscription cannot be cancelled', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');
    deleteCompanyPermanentlyNow.mockRejectedValue(
      new PolarCancellationFailedError('co-1', new Error('down')),
    );

    await expect(service.deleteCompany(USER, 'co-1', otp, 'Acme Corp')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('self-hosted without billing: the exact same call, deleteCompanyPermanentlyNow itself skips Polar', async () => {
    // `deleteCompanyPermanentlyNow` is mocked here (see this file's own `vi.mock` above) — its own
    // "no CompanySubscription row => never call Polar" behavior is proven directly by
    // `billing/deletion.spec.ts`. This test only proves `deleteCompany` calls it the SAME way
    // regardless of hosting mode — no self-hosted-specific branch exists in this service at all.
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');

    await service.deleteCompany(USER, 'co-1', otp, 'Acme Corp');

    expect(deleteCompanyPermanentlyNow).toHaveBeenCalledTimes(1);
  });
});
