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

/**
 * How long a lockout holds before the company may arm a fresh challenge again — the DOOR out of
 * `lockedAt`, and the one part of this file that is not simply mirrored from
 * `documents/signatures/`.
 *
 * A `Signature` row can afford a lock with no door: it guards ONE quote's signature, a third party
 * can always be sent a new signature request, and nothing about the company depends on that single
 * row ever unlocking. This challenge guards the opposite — the only route that DELETES the company
 * (`danger.controller.ts#deleteCompany`, the one carrying `@LegalGateExempt()` precisely so an OWNER
 * can always end the relationship), plus the company-data reset and the ownership transfer that reuses
 * this same challenge (`company/transfer/danger-otp-check.ts`). A lock with no door on THAT route does
 * not merely deny an action: it denies the exit, and nobody else can open it — the locked-out party IS
 * the OWNER, and `guards/instance-operator.guard.ts` answers to `INSTANCE_OPERATOR_EMAILS`, which is
 * unset on every self-hosted instance by default and on the hosted offering names the provider, i.e.
 * the counterparty the owner is trying to leave. Elapsed time is therefore the only unlock that needs
 * no counterparty, which is why it is the one implemented here.
 *
 * 24 hours, and the duration is the whole guarantee — not a comfort setting. An attacker holding a
 * hijacked OWNER session but NOT the owner's inbox gets `MAX_FAILED_ATTEMPTS` guesses per lockout and
 * no more, because `mintDangerOtp` below is the only way to re-arm and it refuses for the whole
 * window; that is 5 × 365 = 1 825 guesses against `OTP_CODE_SPACE` (10^8) over a full year of
 * uninterrupted attack — 0.0018 %, still inside the 0.01 % ceiling `documents/signatures/otp.ts`'s own
 * "the guarantee" pins, with room to spare. `danger-otp-lockout.spec.ts` recomputes that fraction from
 * these constants and fails if either drifts. Every one of those re-arms also e-mails the real OWNER a
 * code they did not ask for, so the attack is loud as well as slow.
 *
 * Deliberately a FIXED window rather than an escalating one (1 h, then 2 h, then 4 h…): escalation
 * would need a lockout-count column and makes the fraction above depend on how long the attack has
 * already run, while the only cooldown this repository already ships
 * (`companies.service.ts#SELF_SERVICE_EXPORT_COOLDOWN_MINUTES`, refused with `retryAfterSeconds`) is
 * fixed. One convention for "come back later", not two.
 */
export const DANGER_OTP_LOCKOUT_HOURS = 24;
export const DANGER_OTP_LOCKOUT_MS = DANGER_OTP_LOCKOUT_HOURS * 60 * 60 * 1000;

/** When a lockout stamped `lockedAt` lifts. Deliberately NOT exported: the one caller that needs this
 *  moment — the refusal that tells a locked-out OWNER when to come back — gets it handed to it as
 *  `mintDangerOtp`'s own `lockedUntil`, so no second place ever re-derives the arithmetic and gets it
 *  wrong by an hour. */
function dangerOtpLockedUntil(lockedAt: Date): Date {
  return new Date(lockedAt.getTime() + DANGER_OTP_LOCKOUT_MS);
}

export interface DangerOtpRecord {
  id: string;
  companyId: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  lockedAt: Date | null;
}

/** A discriminated union rather than `lockedUntil: Date | null`, so a caller that refuses on
 *  `!minted` gets the unlock moment NARROWED to a real `Date` and cannot reach for it without handling
 *  the successful branch — the refusal message is only honest if that date is always there. */
export type MintDangerOtpResult =
  | { minted: true; expiresAt: Date; lockedUntil: null }
  | { minted: false; expiresAt: Date; lockedUntil: Date };

/**
 * Mints (or replaces) this company's OTP challenge — REFUSES to do so for the whole
 * `DANGER_OTP_LOCKOUT_MS` window following `lockedAt`, which is what actually bounds brute force
 * here: without this check, calling `POST /danger/otp` again would hand an attacker who only holds a
 * hijacked OWNER session (never the requester's own inbox) an unlimited SUPPLY of fresh 5-guess
 * budgets instead of the `MAX_FAILED_ATTEMPTS`-per-lockout this bounds them to. Unlike `Signature`'s
 * own `mintOtpChallenge`, this one DOES reset `failedAttempts` on every successful mint — deliberate,
 * not an oversight: this challenge sits behind an already-authenticated OWNER session, so re-arming is
 * a freshly-authorized request, never a possible attacker's do-over the way re-requesting a public
 * signature link is (see this file's own header).
 *
 * Once the window HAS elapsed, re-arming clears `lockedAt` in the SAME write that stores the fresh
 * code — it has to be the same write, and it has to clear the stamp: `verifyAndConsumeOtp` (and
 * `company/transfer/danger-otp-check.ts`) both treat any non-null `lockedAt` as "this code is dead",
 * so a fresh code left sitting on a still-stamped row could never verify and the door would only
 * appear to open. The counter goes back to zero with it, which is the point of a cooldown: the next
 * lockout costs the attacker another full `DANGER_OTP_LOCKOUT_HOURS`, and costs a legitimate OWNER who
 * mistyped nothing but the wait.
 *
 * Not fully atomic against a concurrent `recordDangerOtpFailedAttempt` reaching the lock threshold at
 * the exact same instant (a plain read-then-write, not a guarded `updateMany` — unlike every OTHER
 * write in this file) — accepted deliberately, and unchanged by the cooldown: both callers require an
 * already-authenticated OWNER of the SAME company, so the only way to race this is against yourself,
 * and the worst case is one extra mint slipping through right as the lock is set, never a widened
 * brute-force budget (the guarded `recordDangerOtpFailedAttempt` below is what actually bounds
 * guesses, and stays fully atomic).
 */
export async function mintDangerOtp(companyId: string, codeHash: string): Promise<MintDangerOtpResult> {
  const expiresAt = new Date(Date.now() + DANGER_OTP_WINDOW_MS);
  const existing = await prisma.dangerOtp.findUnique({ where: { companyId }, select: { lockedAt: true } });
  if (existing?.lockedAt) {
    const lockedUntil = dangerOtpLockedUntil(existing.lockedAt);
    if (Date.now() < lockedUntil.getTime()) {
      return { minted: false, expiresAt, lockedUntil };
    }
  }

  await prisma.dangerOtp.upsert({
    where: { companyId },
    create: { companyId, codeHash, expiresAt, failedAttempts: 0 },
    update: { codeHash, expiresAt, failedAttempts: 0, lockedAt: null },
  });
  return { minted: true, expiresAt, lockedUntil: null };
}

export async function findDangerOtp(companyId: string): Promise<DangerOtpRecord | null> {
  return prisma.dangerOtp.findUnique({ where: { companyId } });
}

/**
 * Records ONE failed verification attempt, atomically, and locks the row the instant the counter
 * reaches `MAX_FAILED_ATTEMPTS` — mirrors `signature.persistence.ts#recordFailedAttempt`'s own
 * two-write shape exactly (a guarded `updateMany` for the increment, a second guarded `updateMany` for
 * the lock itself, both keyed on `lockedAt: null` so a row a concurrent call already locked never gets
 * a phantom extra increment or a duplicate lock write).
 *
 * The lock this stamps is unconditional and immediate; how long it HOLDS is `mintDangerOtp`'s
 * business, not this function's — nothing here reads `DANGER_OTP_LOCKOUT_MS`, and a locked row stays
 * unverifiable for as long as the stamp is on it either way.
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
 *  rather than kept around: on success there is nothing left worth remembering, and a row carrying a
 *  `lockedAt` stamp must never be reachable by this function in the first place (such a row can never
 *  `otpCodeMatches`, since `mintDangerOtp` above only ever mints onto a row whose stamp it clears in
 *  the same write — see that function's own header). */
export async function clearDangerOtp(companyId: string): Promise<void> {
  await prisma.dangerOtp.deleteMany({ where: { companyId } });
}
