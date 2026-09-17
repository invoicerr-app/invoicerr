/**
 * F-011 / F-012 — an operation must not report success it did not perform, and the code
 * authorising a destructive action must reach the person requesting it.
 *
 * Also covers the OTP hardening this service used to be missing relative to
 * `documents/signatures/otp.ts` (the model this now reuses instead of a second, home-grown scheme):
 * per-company scoping (one company's mint must never affect another's), a lifetime failed-attempt
 * lock, and the code never being readable back in the clear once stored.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { NO_MAIL_SERVER_CONFIGURED_MESSAGE } from '@/mail/mail.service';
import { DangerService } from './danger.service';

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

let fakeTable: ReturnType<typeof fakeDangerOtpTable>;

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  get default() {
    return {
      dangerOtp: fakeTable,
      company: { deleteMany: jest.fn() },
      mailTemplate: { deleteMany: jest.fn() },
      client: { deleteMany: jest.fn() },
    };
  },
}));
jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const USER = { id: 'u1', email: 'requester@example.test' } as never;

function build() {
  fakeTable = fakeDangerOtpTable();
  const mailService = { sendForCompany: jest.fn().mockResolvedValue(undefined) };
  return { service: new DangerService(mailService as never), mailService };
}

async function requestAndExtractOtp(
  service: DangerService,
  mailService: { sendForCompany: jest.Mock },
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
    // The body must not announce a delivery that did not happen.
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
      const mailService = {
        sendForCompany: jest
          .fn()
          .mockRejectedValue(new BadRequestException(NO_MAIL_SERVER_CONFIGURED_MESSAGE)),
      };
      fakeTable = fakeDangerOtpTable();
      const service = new DangerService(mailService as never);

      const action = service.requestOtp(USER, 'co-1');

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow(NO_MAIL_SERVER_CONFIGURED_MESSAGE);
    },
  );

  it('collapses any OTHER provider error into the generic message — never the raw provider error', async () => {
    const mailService = { sendForCompany: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    fakeTable = fakeDangerOtpTable();
    const service = new DangerService(mailService as never);

    await expect(service.requestOtp(USER, 'co-1')).rejects.toThrow(
      'Failed to send OTP email. Please check your SMTP configuration.',
    );
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
    await expect(service.resetAll(USER, 'company-a', codeA)).rejects.toBeInstanceOf(NotImplementedException);
  });

  it("refuses company B's OTP when checked against company A — no cross-tenant replay", async () => {
    const { service, mailService } = build();
    await requestAndExtractOtp(service, mailService, 'company-a');
    const codeB = await requestAndExtractOtp(service, mailService, 'company-b');

    await expect(service.resetAll(USER, 'company-a', codeB)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('locks the company out permanently after MAX_FAILED_ATTEMPTS wrong guesses', async () => {
    const { service, mailService } = build();
    await requestAndExtractOtp(service, mailService, 'co-1');

    // Five wrong guesses (MAX_FAILED_ATTEMPTS, documents/signatures/otp.ts) exhaust the lifetime budget.
    for (let i = 0; i < 5; i++) {
      await expect(service.resetAll(USER, 'co-1', '00000000')).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(fakeTable.rows.get('co-1')!.lockedAt).not.toBeNull();

    // A fresh, correctly-typed code can no longer be minted at all for this company.
    await expect(service.requestOtp(USER, 'co-1')).rejects.toThrow(/Too many failed attempts/);
  });

  it('does not count a SUCCESSFUL verification toward the failed-attempt budget', async () => {
    const { service, mailService } = build();
    const code = await requestAndExtractOtp(service, mailService, 'co-1');
    await service.resetAll(USER, 'co-1', code).catch(() => undefined); // NotImplementedException, but consumes the code

    expect(fakeTable.rows.has('co-1')).toBe(false); // cleared, not locked
  });
});

describe('DangerService — F-011: resetAll does not claim a deletion it never performs', () => {
  it('throws NotImplementedException instead of returning success', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');

    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('still rejects an invalid code before anything else', async () => {
    const { service } = build();
    await expect(service.resetAll(USER, 'co-1', '00000000')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes the code: a second use of the same OTP is refused', async () => {
    const { service, mailService } = build();
    const otp = await requestAndExtractOtp(service, mailService, 'co-1');

    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(NotImplementedException);
    // resetAll clears the OTP before throwing, so replaying it must now fail the code check.
    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(BadRequestException);
  });
});
