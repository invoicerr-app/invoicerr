import { vi, type Mock } from 'vitest';

import { HttpException } from '@nestjs/common';

import { MAX_FAILED_ATTEMPTS, OTP_CODE_SPACE } from '@/modules/documents/signatures/otp';

import { DANGER_OTP_LOCKED, DangerService } from './danger.service';
import { DANGER_OTP_LOCKOUT_HOURS, DANGER_OTP_LOCKOUT_MS, findDangerOtp } from './danger-otp.persistence';
import { verifyAndConsumeDangerOtp } from '@/modules/company/transfer/danger-otp-check';

/**
 * The failed-attempt lockout, from both sides: it must still SLAM SHUT on the same number of wrong
 * codes it always did, and it must now OPEN again on its own once the cooldown has run — because the
 * routes it gates include deleting the company, which is the customer's own way out. A lock with no
 * door on that route does not just block an action, it blocks the exit, and no one else can open it
 * for them (see `danger-otp.persistence.ts#DANGER_OTP_LOCKOUT_HOURS` for why time, and not an
 * operator, is the unlock).
 *
 * Deliberately separate from `danger.service.spec.ts`: that file proves what the danger zone DOES,
 * this one proves only what the lock does, and it drives the real persistence layer
 * (`danger-otp.persistence.ts`) through a faithful in-memory `dangerOtp` table rather than stubbing
 * the lock decisions it is supposed to be testing.
 */

interface FakeDangerOtpRow {
  id: string;
  companyId: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  lockedAt: Date | null;
}

/** Just enough of `prisma.dangerOtp`'s own API for `danger-otp.persistence.ts` to run unmodified,
 *  with REAL semantics for the two things this spec turns on: the `WHERE lockedAt: null` guard
 *  (so a locked row genuinely stops taking increments) and `increment` (so five failures really is
 *  five). A hand-waved mock would let a broken lock look correct here. */
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

function emptyScopedTable() {
  return {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

let fakeTable: ReturnType<typeof fakeDangerOtpTable>;
let prismaMock: Record<string, unknown>;

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  get default() {
    return prismaMock;
  },
}));

// `vi.hoisted` because `vi.mock`'s factory is hoisted above this file's own top-level bindings — a
// plain `const` here is still in its temporal dead zone when the factory runs.
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/logger/logger.service', () => ({ logger: loggerMock }));

vi.mock('@/modules/documents/archive/storage', () => ({
  deleteArchivedArtifacts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/modules/documents/received-invoices/storage', () => ({
  deleteInboundFilesForCompany: vi.fn().mockResolvedValue(undefined),
}));

const deleteCompanyPermanentlyNow = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/billing/deletion', async () => {
  const actual = await vi.importActual('@/modules/billing/deletion');
  return {
    ...actual,
    deleteCompanyPermanentlyNow: (...args: unknown[]) => deleteCompanyPermanentlyNow(...args),
  };
});

const USER = { id: 'u1', email: 'owner@example.test' } as never;
const COMPANY = 'co-1';
const WRONG_CODE = '00000000';

function build() {
  fakeTable = fakeDangerOtpTable();
  prismaMock = {
    dangerOtp: fakeTable,
    company: { findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp', language: 'en' }) },
    documentArchive: { ...emptyScopedTable(), findMany: vi.fn().mockResolvedValue([]) },
    pendingStorageErasure: emptyScopedTable(),
    documentInstance: emptyScopedTable(),
    documentSchedule: emptyScopedTable(),
    documentNumberSequence: emptyScopedTable(),
    client: emptyScopedTable(),
    article: emptyScopedTable(),
    project: emptyScopedTable(),
    timeEntry: emptyScopedTable(),
    bankStatement: emptyScopedTable(),
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prismaMock)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  deleteCompanyPermanentlyNow.mockClear().mockResolvedValue(undefined);
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();

  const mailService = { sendForCompany: vi.fn().mockResolvedValue(undefined) };
  const exportService = { buildCompanyZip: vi.fn().mockResolvedValue(Buffer.from('zip-bytes')) };
  return {
    service: new DangerService(mailService as never, exportService as never),
    mailService,
    exportService,
  };
}

/** Requests a code and reads it back out of the mail the service just sent — the ONLY place a
 *  plaintext code is ever observable, which is the point: nothing else in this flow may expose it. */
async function requestAndReadCode(
  service: DangerService,
  mailService: { sendForCompany: Mock },
  companyId = COMPANY,
): Promise<string> {
  await service.requestOtp(USER, companyId);
  const call = mailService.sendForCompany.mock.calls.at(-1)!;
  return (call[1].text as string).match(/is: (\d+)/)![1];
}

/** Burns exactly `MAX_FAILED_ATTEMPTS` wrong confirmations — the whole budget, which is what stamps
 *  `lockedAt`. Every one of them must be refused. */
async function burnTheBudget(service: DangerService, companyId = COMPANY) {
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    await expect(service.resetCompanyData(USER, companyId, WRONG_CODE)).rejects.toThrow(
      'Invalid or expired OTP',
    );
  }
}

describe('the danger-zone OTP lockout — it must still close, and it must now open again', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T08:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  describe('it still closes — nothing here buys an attacker a cheaper guess', () => {
    it(`does not lock before the ${MAX_FAILED_ATTEMPTS}th wrong code — a fourth failure still leaves the door open`, async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);

      for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
        await expect(service.resetCompanyData(USER, COMPANY, WRONG_CODE)).rejects.toThrow();
      }

      expect(fakeTable.rows.get(COMPANY)!.failedAttempts).toBe(MAX_FAILED_ATTEMPTS - 1);
      expect(fakeTable.rows.get(COMPANY)!.lockedAt).toBeNull();
    });

    it(`locks on the ${MAX_FAILED_ATTEMPTS}th wrong code, exactly as before`, async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);

      await burnTheBudget(service);

      expect(fakeTable.rows.get(COMPANY)!.lockedAt).not.toBeNull();
    });

    it('refuses a fresh code for the WHOLE window — including one second before it lifts', async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);
      const mailsBefore = mailService.sendForCompany.mock.calls.length;

      const lockedAt = fakeTable.rows.get(COMPANY)!.lockedAt!.getTime();
      for (const at of [
        lockedAt + 1,
        lockedAt + DANGER_OTP_LOCKOUT_MS / 2,
        lockedAt + DANGER_OTP_LOCKOUT_MS - 1000,
      ]) {
        vi.setSystemTime(new Date(at));
        await expect(service.requestOtp(USER, COMPANY)).rejects.toThrow(/Too many failed attempts/);
      }

      // Not one extra code was minted or mailed while the window ran.
      expect(mailService.sendForCompany.mock.calls.length).toBe(mailsBefore);
      expect(fakeTable.rows.get(COMPANY)!.lockedAt).not.toBeNull();
    });

    it('refuses every gated action while locked — reset, delete, and the ownership transfer that shares this challenge', async () => {
      const { service, mailService } = build();
      const code = await requestAndReadCode(service, mailService);
      await burnTheBudget(service);

      // Even the code that WAS valid before the lock is dead now — the lock kills the challenge, it
      // does not merely stop new ones being minted.
      await expect(service.resetCompanyData(USER, COMPANY, code)).rejects.toThrow('Invalid or expired OTP');
      await expect(service.deleteCompany(USER, COMPANY, code, 'Acme Corp')).rejects.toThrow(
        'Invalid or expired OTP',
      );
      await expect(verifyAndConsumeDangerOtp(COMPANY, code)).rejects.toThrow('Invalid or expired OTP');
      expect(deleteCompanyPermanentlyNow).not.toHaveBeenCalled();
    });

    it('guessing THROUGH the lockout neither unlocks it nor refills the budget', async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);
      const lockedAt = fakeTable.rows.get(COMPANY)!.lockedAt!;

      for (let i = 0; i < 50; i++) {
        await expect(service.resetCompanyData(USER, COMPANY, WRONG_CODE)).rejects.toThrow();
      }

      expect(fakeTable.rows.get(COMPANY)!.lockedAt).toEqual(lockedAt);
      expect(fakeTable.rows.get(COMPANY)!.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    });

    it('re-arms with a FULL fresh lockout after the door reopens — the cooldown is not a budget refill', async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);

      vi.setSystemTime(new Date(Date.now() + DANGER_OTP_LOCKOUT_MS));
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);

      // Locked again on the same five, and the new window is measured from the NEW lock, not the old.
      expect(fakeTable.rows.get(COMPANY)!.lockedAt).toEqual(new Date(Date.now()));
      await expect(service.requestOtp(USER, COMPANY)).rejects.toThrow(/Too many failed attempts/);
    });

    it('never puts a code in the refusal or in a log line', async () => {
      const { service, mailService } = build();
      const code = await requestAndReadCode(service, mailService);
      await burnTheBudget(service);

      const refusal = await service.requestOtp(USER, COMPANY).catch((error: HttpException) => error);
      const serialised = JSON.stringify({
        refusal: (refusal as HttpException).getResponse(),
        logs: [loggerMock.info.mock.calls, loggerMock.warn.mock.calls, loggerMock.error.mock.calls],
      });
      expect(serialised).not.toContain(code);
      expect(serialised).not.toMatch(/\b\d{8}\b/);
    });
  });

  describe('it now opens — the owner can get back in, alone and without asking anyone', () => {
    it(`mints again once ${DANGER_OTP_LOCKOUT_HOURS}h have passed, clearing the stamp and the counter`, async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);

      vi.setSystemTime(new Date(Date.now() + DANGER_OTP_LOCKOUT_MS));
      await expect(service.requestOtp(USER, COMPANY)).resolves.toMatchObject({
        message: 'OTP sent successfully',
      });

      const row = await findDangerOtp(COMPANY);
      expect(row!.lockedAt).toBeNull();
      expect(row!.failedAttempts).toBe(0);
    });

    it('lets a locked-out OWNER actually reach the EXIT — deleting the company after the wait', async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);

      vi.setSystemTime(new Date(Date.now() + DANGER_OTP_LOCKOUT_MS));
      const freshCode = await requestAndReadCode(service, mailService);

      await expect(service.deleteCompany(USER, COMPANY, freshCode, 'Acme Corp')).resolves.toMatchObject({
        message: 'Company deleted successfully',
      });
      expect(deleteCompanyPermanentlyNow).toHaveBeenCalledWith(COMPANY);
    });

    it('lets the company-data reset through too, once the wait is over', async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);

      vi.setSystemTime(new Date(Date.now() + DANGER_OTP_LOCKOUT_MS));
      const freshCode = await requestAndReadCode(service, mailService);

      await expect(service.resetCompanyData(USER, COMPANY, freshCode)).resolves.toMatchObject({
        message: 'Company data reset successfully',
      });
    });

    it('tells the owner WHEN, so the wait is a wait and not a dead end', async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);
      const lockedAt = fakeTable.rows.get(COMPANY)!.lockedAt!;

      const refusal = (await service.requestOtp(USER, COMPANY).catch((e) => e)) as HttpException;
      const body = refusal.getResponse() as { code: string; retryAfterSeconds: number; retryAt: string };

      expect(refusal.getStatus()).toBe(429);
      expect(body.code).toBe(DANGER_OTP_LOCKED);
      expect(body.retryAt).toBe(new Date(lockedAt.getTime() + DANGER_OTP_LOCKOUT_MS).toISOString());
      expect(body.retryAfterSeconds).toBe(DANGER_OTP_LOCKOUT_MS / 1000);
    });

    it('counts the wait down as it passes — never restarts it because the owner kept asking', async () => {
      const { service, mailService } = build();
      await requestAndReadCode(service, mailService);
      await burnTheBudget(service);
      const lockedAt = fakeTable.rows.get(COMPANY)!.lockedAt!.getTime();

      const retryAfter = async () => {
        const refusal = (await service.requestOtp(USER, COMPANY).catch((e) => e)) as HttpException;
        return (refusal.getResponse() as { retryAfterSeconds: number }).retryAfterSeconds;
      };

      const first = await retryAfter();
      vi.setSystemTime(new Date(lockedAt + 6 * 60 * 60 * 1000));
      const later = await retryAfter();

      expect(later).toBe(first - 6 * 60 * 60);
      // The refused request left the stamp exactly where it was — an owner clicking the button every
      // hour must not push their own release further away each time.
      expect(fakeTable.rows.get(COMPANY)!.lockedAt!.getTime()).toBe(lockedAt);
    });
  });

  describe('the guarantee the cooldown has to keep', () => {
    /**
     * Turning the permanent lock into a cooldown turns a fixed lifetime budget into a RATE, so the
     * bound has to be restated as one: `MAX_FAILED_ATTEMPTS` guesses per lockout, one lockout per
     * `DANGER_OTP_LOCKOUT_MS`, sustained for a full year without pause. Recomputed from the real
     * exported constants — shortening the window or raising the attempt budget fails this test and
     * therefore CI. The ceiling is the same 0.01 % `documents/signatures/otp.ts`'s own "the guarantee"
     * pins for the signature OTP; the actual figure is 0.0018 %.
     */
    it('a year of uninterrupted guessing stays under the 0.01% ceiling the signature OTP already pins', () => {
      const lockoutsPerYear = (365 * 24 * 60 * 60 * 1000) / DANGER_OTP_LOCKOUT_MS;
      const fraction = (MAX_FAILED_ATTEMPTS * lockoutsPerYear) / OTP_CODE_SPACE;

      expect(fraction).toBeLessThanOrEqual(0.0001);
      // Pinned to the current figure too — 5 × 365 / 10^8 — so a change to either constant is visible
      // here even while it still technically clears the ceiling above.
      expect(fraction).toBeCloseTo(0.00001825, 10);
    });

    it('the window is a whole day, not a token pause', () => {
      expect(DANGER_OTP_LOCKOUT_HOURS).toBe(24);
      expect(DANGER_OTP_LOCKOUT_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
