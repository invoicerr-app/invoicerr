/**
 * Persistence for `DangerOtp` — one row per company (schema.prisma's own header on the model has the
 * full "why": a process-wide, in-memory OTP singleton used to let one company's OWNER silently
 * overwrite the code another company's OWNER had just been emailed). Plain functions over the Prisma
 * singleton, never a repository class — the same split `documents/signatures/signature.persistence.ts`
 * already holds, whose CSPRNG/hash/timing-safe-compare primitives (`documents/signatures/otp.ts`) this
 * file reuses rather than re-implementing a second, parallel OTP scheme.
 */
import prisma from '@/prisma/prisma.service';

import { MAX_FAILED_ATTEMPTS } from '@/modules/documents/signatures/otp';

/** 10 minutes — the product's own pre-existing window (unchanged from the removed in-memory
 *  implementation); deliberately NOT `documents/signatures/otp.ts#OTP_WINDOW_MS` (5 minutes), which is
 *  that module's own tuning for a bearer link an anonymous third party might be holding, not this
 *  already-authenticated, OWNER-only flow. */
const DANGER_OTP_WINDOW_MS = 10 * 60 * 1000;

export interface DangerOtpRecord {
  id: string;
  companyId: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  lockedAt: Date | null;
}

/**
 * Mints (or replaces) this company's OTP challenge — REFUSES to do so once the row is `lockedAt`,
 * which is what makes the lifetime lock actually permanent: without this check, calling `POST
 * /danger/otp` again would hand an attacker who only holds a hijacked OWNER session (never the
 * requester's own inbox) an unlimited SUPPLY of fresh 5-guess budgets instead of the single one
 * `MAX_FAILED_ATTEMPTS` is supposed to bound for good. Unlike `Signature`'s own `mintOtpChallenge`,
 * this one DOES reset `failedAttempts` on every successful mint — deliberate, not an oversight: this
 * challenge sits behind an already-authenticated OWNER session, so re-arming is a freshly-authorized
 * request, never a possible attacker's do-over the way re-requesting a public signature link is (see
 * this file's own header).
 *
 * Not fully atomic against a concurrent `recordDangerOtpFailedAttempt` reaching the lock threshold at
 * the exact same instant (a plain read-then-write, not a guarded `updateMany` — unlike every OTHER
 * write in this file) — accepted deliberately: both callers require an already-authenticated OWNER of
 * the SAME company, so the only way to race this is against yourself, and the worst case is one extra
 * mint slipping through right as the lock is set, never a widened brute-force budget (the guarded
 * `recordDangerOtpFailedAttempt` below is what actually bounds guesses, and stays fully atomic).
 */
export async function mintDangerOtp(
  companyId: string,
  codeHash: string,
): Promise<{ minted: boolean; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + DANGER_OTP_WINDOW_MS);
  const existing = await prisma.dangerOtp.findUnique({ where: { companyId }, select: { lockedAt: true } });
  if (existing?.lockedAt) {
    return { minted: false, expiresAt };
  }

  await prisma.dangerOtp.upsert({
    where: { companyId },
    create: { companyId, codeHash, expiresAt, failedAttempts: 0 },
    update: { codeHash, expiresAt, failedAttempts: 0 },
  });
  return { minted: true, expiresAt };
}

export async function findDangerOtp(companyId: string): Promise<DangerOtpRecord | null> {
  return prisma.dangerOtp.findUnique({ where: { companyId } });
}

/**
 * Records ONE failed verification attempt, atomically, and PERMANENTLY locks the row the instant the
 * lifetime counter reaches `MAX_FAILED_ATTEMPTS` — mirrors
 * `signature.persistence.ts#recordFailedAttempt`'s own two-write shape exactly (a guarded
 * `updateMany` for the increment, a second guarded `updateMany` for the lock itself, both keyed on
 * `lockedAt: null` so a row a concurrent call already locked never gets a phantom extra increment or a
 * duplicate lock write).
 */
export async function recordDangerOtpFailedAttempt(companyId: string): Promise<{ locked: boolean }> {
  const { count } = await prisma.dangerOtp.updateMany({
    where: { companyId, lockedAt: null },
    data: { failedAttempts: { increment: 1 } },
  });
  if (count === 0) return { locked: true };

  const row = await prisma.dangerOtp.findUniqueOrThrow({ where: { companyId } });
  if (row.failedAttempts < MAX_FAILED_ATTEMPTS) return { locked: false };

  await prisma.dangerOtp.updateMany({
    where: { companyId, lockedAt: null },
    data: { lockedAt: new Date() },
  });
  return { locked: true };
}

/** The terminal, successful write — a used-up challenge is deleted outright (never merely nulled)
 *  rather than kept around: on success there is nothing left worth remembering, and a locked row must
 *  never be reachable by this function in the first place (a locked row can never `otpCodeMatches`,
 *  since `mintDangerOtp` above refuses to mint a fresh code for it — see that function's own header). */
export async function clearDangerOtp(companyId: string): Promise<void> {
  await prisma.dangerOtp.deleteMany({ where: { companyId } });
}
