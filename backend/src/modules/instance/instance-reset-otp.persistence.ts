/**
 * Persistence for `InstanceResetOtp` — one row per OPERATOR e-mail (see that model's own
 * `schema.prisma` header for why an e-mail, not a foreign key). Mirrors `danger/danger-otp.
 * persistence.ts` function-for-function — plain functions over the Prisma singleton, reusing the
 * SAME CSPRNG/hash/timing-safe-compare primitives (`documents/signatures/otp.ts`) rather than a
 * second, parallel OTP scheme — the one difference is the key (`email` here, `companyId` there).
 */
import prisma from '@/prisma/prisma.service';

import { MAX_FAILED_ATTEMPTS } from '@/modules/documents/signatures/otp';

/** Same 10-minute window `danger-otp.persistence.ts#DANGER_OTP_WINDOW_MS` uses — this is the
 *  identical "already-authenticated, human-only flow" shape, not the shorter 5-minute window
 *  `documents/signatures/otp.ts` gives an anonymous, bearer-link-held signature request. */
const INSTANCE_RESET_OTP_WINDOW_MS = 10 * 60 * 1000;

export interface InstanceResetOtpRecord {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  lockedAt: Date | null;
}

/**
 * Mints (or replaces) this OPERATOR's OTP challenge — refuses once the row is `lockedAt`, the exact
 * same permanent-lock guarantee `danger-otp.persistence.ts#mintDangerOtp` documents for its own
 * per-company row: without this check, re-requesting would hand an attacker holding only a hijacked
 * operator session an unlimited supply of fresh 5-guess budgets instead of the single one
 * `MAX_FAILED_ATTEMPTS` bounds for good.
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
