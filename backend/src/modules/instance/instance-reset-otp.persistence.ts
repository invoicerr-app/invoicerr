/**
 * Persistence for `InstanceResetOtp` — one row per OPERATOR e-mail (see that model's own
 * `schema.prisma` header for why an e-mail, not a foreign key). Same shape as
 * `danger/danger-otp.persistence.ts` - plain functions over the Prisma singleton, reusing the SAME
 * CSPRNG/hash/timing-safe-compare primitives (`lib/otp.ts`) rather than a second, parallel OTP
 * scheme - with two differences: the key (`email` here, `companyId` there), and the lock. Here a
 * lockout is PERMANENT until the row is cleared; the danger challenge lifts its own after 24 hours
 * (`DANGER_OTP_LOCKOUT_HOURS`, whose header says why that route needs a door and this one does not).
 */
import prisma from '@/prisma/prisma.service';

import { MAX_FAILED_ATTEMPTS } from '@/lib/otp';

/** Same 10-minute window `danger-otp.persistence.ts#DANGER_OTP_WINDOW_MINUTES` uses - this is the
 *  identical "already-authenticated, human-only flow" shape, not the shorter 5-minute window
 *  `documents/signatures/otp.ts` gives an anonymous, bearer-link-held signature request. Exported in
 *  minutes because the e-mail quotes it (`instance-reset.service.ts`). */
export const INSTANCE_RESET_OTP_WINDOW_MINUTES = 10;
const INSTANCE_RESET_OTP_WINDOW_MS = INSTANCE_RESET_OTP_WINDOW_MINUTES * 60 * 1000;

export interface InstanceResetOtpRecord {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  lockedAt: Date | null;
}

/**
 * Mints (or replaces) this OPERATOR's OTP challenge - refuses once the row is `lockedAt`, the same
 * refusal `danger-otp.persistence.ts#mintDangerOtp` documents for its own per-company row (there it
 * lifts after 24 hours, here never): without this check, re-requesting would hand an attacker holding
 * only a hijacked operator session an unlimited supply of fresh 5-guess budgets instead of the single
 * one `MAX_FAILED_ATTEMPTS` bounds for good.
 */
export async function mintInstanceResetOtp(
  email: string,
  codeHash: string,
): Promise<{ minted: boolean; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + INSTANCE_RESET_OTP_WINDOW_MS);
  const existing = await prisma.instanceResetOtp.findUnique({ where: { email }, select: { lockedAt: true } });
  if (existing?.lockedAt) {
    return { minted: false, expiresAt };
  }

  await prisma.instanceResetOtp.upsert({
    where: { email },
    create: { email, codeHash, expiresAt, failedAttempts: 0 },
    update: { codeHash, expiresAt, failedAttempts: 0 },
  });
  return { minted: true, expiresAt };
}

export async function findInstanceResetOtp(email: string): Promise<InstanceResetOtpRecord | null> {
  return prisma.instanceResetOtp.findUnique({ where: { email } });
}

/**
 * Records ONE failed verification attempt, atomically, and PERMANENTLY locks the row the instant the
 * lifetime counter reaches `MAX_FAILED_ATTEMPTS` — same two-guarded-write shape as `danger-otp.
 * persistence.ts#recordDangerOtpFailedAttempt`, keyed by `email` instead of `companyId`.
 */
export async function recordInstanceResetOtpFailedAttempt(email: string): Promise<{ locked: boolean }> {
  const { count } = await prisma.instanceResetOtp.updateMany({
    where: { email, lockedAt: null },
    data: { failedAttempts: { increment: 1 } },
  });
  if (count === 0) return { locked: true };

  const row = await prisma.instanceResetOtp.findUniqueOrThrow({ where: { email } });
  if (row.failedAttempts < MAX_FAILED_ATTEMPTS) return { locked: false };

  await prisma.instanceResetOtp.updateMany({
    where: { email, lockedAt: null },
    data: { lockedAt: new Date() },
  });
  return { locked: true };
}

/** The terminal, successful write — deleted outright, never merely nulled, same reasoning
 *  `danger-otp.persistence.ts#clearDangerOtp` gives for its own row. */
export async function clearInstanceResetOtp(email: string): Promise<void> {
  await prisma.instanceResetOtp.deleteMany({ where: { email } });
}
