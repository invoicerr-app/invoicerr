/**
 * The OTP's own crypto and the LIFETIME budget it is checked against — deliberately the smallest
 * possible surface, split out from `signatures.service.ts` on the exact same "one file, easy to
 * audit alone" discipline `share-links/share-link-token.ts` already documents for its own token.
 *
 * This is the hardened replacement for the removed `modules/signatures/` module's own OTP (git tag
 * `avant-refonte-documents`), which shipped GHSA-vhjw-gwc5-pjfp:
 * `Math.floor(10000000 + Math.random() * 90000000).toString()` — a NON-cryptographic PRNG — stored
 * and compared IN THE CLEAR, behind an endpoint with no rate-limiting at all. Every one of those four
 * failures is closed here:
 *  - `crypto.randomInt` (CSPRNG, uniform over the whole code space) replaces `Math.random`.
 *  - `hashOtpCode` — the code is stored HASHED (SHA-256), never in the clear.
 *  - `otpCodeMatches` — compared via `crypto.timingSafeEqual` on the digests, never `===`.
 *  - `MAX_FAILED_ATTEMPTS`/`MAX_OTP_MINTS` below are what actually BOUND brute force, independent of
 *    (and more important than) the `@nestjs/throttler` request-rate limiting `signatures/*` also
 *    gets — see this constant's own comment for the exact math.
 *
 * `import * as crypto` (a namespace import, not `import { randomInt, ... }`) is deliberate: a spec
 * asserting "this really calls `crypto.timingSafeEqual`/`crypto.randomInt`, not a hand-rolled
 * equivalent" spies on `crypto.<name>` as a property of this SAME module object — a destructured
 * named import would capture the original function reference at load time, invisible to a spy
 * installed on the module object afterward. `share-link-token.ts` does not need this (nothing in this
 * codebase spies on its `createHash`/`randomBytes` calls), which is why it uses named imports instead
 * — the two files make different, equally deliberate choices for different reasons.
 */
import * as crypto from 'node:crypto';

/** 8-digit codes, "00000000".."99999999" — 10^8 possible values, the same code SPACE the removed
 *  module's own OTP used (never widened or narrowed casually: this is the denominator the guarantee
 *  test below, and `signatures.spec.ts`'s own "the guarantee" spec, recompute their fraction from). */
export const OTP_CODE_SPACE = 100_000_000;

/** 5 minutes — down from the removed module's own 15 (a deliberate hardening). */
export const OTP_WINDOW_MS = 5 * 60 * 1000;

/**
 * THE guarantee this whole feature exists to make mathematically true: over the ENTIRE LIFETIME of
 * one `Signature` row (never reset by a re-armed OTP — see `signature.persistence.ts`'s own
 * `recordFailedAttempt`), an attacker gets AT MOST this many guesses against a code space of
 * `OTP_CODE_SPACE`. `MAX_FAILED_ATTEMPTS / OTP_CODE_SPACE` = 5 / 10^8 = 0.000005 % — see
 * `otp.spec.ts`'s own "the guarantee" test, which recomputes this fraction from these two exported
 * constants and fails the moment either one drifts past the 0.01 % ceiling. This is
 * DELIBERATELY independent of `MAX_OTP_MINTS` below: re-arming narrows the CURRENT code's own 5-minute
 * window, it never grants a fresh attempt budget.
 */
export const MAX_FAILED_ATTEMPTS = 5;

/** How many times `POST .../otp` may mint a fresh code for one signature row, ever — a THROTTLE on
 *  re-arming, never a widening of `MAX_FAILED_ATTEMPTS` above (each of these 3 codes is still bound by
 *  the SAME lifetime attempt counter, shared across every one of them). */
export const MAX_OTP_MINTS = 3;

/** `crypto.randomInt(0, OTP_CODE_SPACE)` excludes the upper bound (node's own documented contract),
 *  giving exactly the 10^8 values 0..99999999 — zero-padded to 8 digits so "5" reads as "00000005",
 *  never a short, distinguishable code. */
export function generateOtpCode(): string {
  return crypto.randomInt(0, OTP_CODE_SPACE).toString().padStart(8, '0');
}

/** A fast digest is correct here for the identical reason `share-link-token.ts`'s own header gives
 *  for `hashShareLinkToken`: this is not defending an already-hashed value against inversion (the
 *  code itself carries no more entropy no matter how slow the hash is, unlike a human password), only
 *  turning it into something this codebase never stores in the clear. */
export function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * `true` only for a WELL-FORMED 8-digit candidate whose digest equals `storedHashHex` — checked via
 * `crypto.timingSafeEqual` on the two digests (both always 32-byte SHA-256 outputs produced by this
 * same `hashOtpCode`, so the lengths can never actually mismatch — `timingSafeEqual` would otherwise
 * throw on a length difference rather than just returning false).
 *
 * The format check runs BEFORE hashing/comparing so a malformed candidate (wrong length, non-digit
 * characters) is refused the same way a wrong-but-well-formed one is — from the caller's side, both
 * read as "no match", never a distinct error that would tell an attacker their input shape was wrong
 * (see `signatures.service.ts`'s own "one generic outcome" discipline).
 */
export function otpCodeMatches(candidateCode: string, storedHashHex: string): boolean {
  if (!/^\d{8}$/.test(candidateCode)) return false;
  const candidateDigest = Buffer.from(hashOtpCode(candidateCode), 'hex');
  const storedDigest = Buffer.from(storedHashHex, 'hex');
  return crypto.timingSafeEqual(candidateDigest, storedDigest);
}
