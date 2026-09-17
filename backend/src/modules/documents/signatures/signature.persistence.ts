import prisma from '@/prisma/prisma.service';

import { MAX_FAILED_ATTEMPTS, MAX_OTP_MINTS, OTP_WINDOW_MS } from './otp';

/**
 * Tenant-safe(ish) persistence for `Signature` — the same "plain functions over the Prisma
 * singleton, never a hand-rolled repository class" split `documents/persistence.ts` and
 * `share-links/share-link.persistence.ts` already hold. "Tenant-safe(ish)": unlike every OTHER
 * persistence module in `documents/`, the PUBLIC half of this one (`findSignatureByTokenHash` and
 * everything built on it) is deliberately NOT scoped by `companyId` at all — the caller does not
 * KNOW a companyId yet, that is exactly what resolving the token is for (the same shape
 * `share-link.persistence.ts`'s own `findShareLinkTokenByHash` already has). Only the COMPANY-SIDE
 * write (`createSignatureForDocument`, called from the "request-signature" action, which already ran
 * through `runAction`'s own company/tenant checks before this file is ever reached) takes a
 * `companyId` at all.
 */

export interface SignatureRecord {
  id: string;
  companyId: string;
  typeId: string;
  documentId: string;
  tokenHash: string;
  otpCodeHash: string | null;
  otpExpiresAt: Date | null;
  otpFailedAttempts: number;
  otpResendCount: number;
  lockedAt: Date | null;
  signedAt: Date | null;
  isActive: boolean;
  documentPdfUri: string | null;
  documentPdfHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creates a fresh signature request, first DEACTIVATING every currently-active one for the same
 * document — a company re-requesting a signature (the client lost the email, the previous one
 * expired its OTP one too many times short of the lifetime lock, ...) must invalidate the OLD link
 * outright, never leave two simultaneously live tokens for the same document. Mirrors
 * `sendSignatureEmail`'s own `updateMany({ isActive: false })` sweep in the removed module (git tag
 * `avant-refonte-documents`) — the one piece of its behavior worth keeping verbatim.
 */
export async function createSignatureForDocument(input: {
  companyId: string;
  typeId: string;
  documentId: string;
  tokenHash: string;
}): Promise<SignatureRecord> {
  await prisma.signature.updateMany({
    where: { documentId: input.documentId, isActive: true },
    data: { isActive: false },
  });
  return prisma.signature.create({
    data: {
      companyId: input.companyId,
      typeId: input.typeId,
      documentId: input.documentId,
      tokenHash: input.tokenHash,
    },
  });
}

/**
 * The PUBLIC resolution path — looked up by `tokenHash` (a unique index, an O(1) exact match, never
 * a scan-and-compare — the identical reasoning `share-link.persistence.ts`'s own
 * `findShareLinkTokenByHash` already documents). Returns the raw record regardless of
 * active/locked/signed state; deciding what those mean is `signatures.service.ts`'s own job, kept
 * OUT of this function so "unknown token" and "known but dead" cost the exact same single query.
 */
export async function findSignatureByTokenHash(tokenHash: string): Promise<SignatureRecord | null> {
  return prisma.signature.findUnique({ where: { tokenHash } });
}

/**
 * Mints a fresh OTP challenge — ATOMIC and re-arm-capped: the `updateMany`'s own `where` clause
 * (`isActive: true`, `otpResendCount: { lt: MAX_OTP_MINTS }`) is re-checked by Postgres at the moment
 * of the write, not merely by an earlier `SELECT` this function trusts — two concurrent "send me a
 * new code" calls can never together mint a 4th code for the same row (Postgres serializes the two
 * row-level updates; the second one re-evaluates the WHERE against the value the first one just
 * committed). Returns `false` (mints nothing) when the row is no longer active OR the cap is already
 * reached — the caller (`signatures.service.ts`) turns that into ONE generic refusal either way; this
 * function itself is not the one that decides which message that refusal carries.
 *
 * Deliberately does NOT touch `otpFailedAttempts` — see `otp.ts`'s own header on
 * `MAX_FAILED_ATTEMPTS`: re-arming narrows the CURRENT code's own window, it never resets or grows
 * the lifetime attempt budget.
 */
export async function mintOtpChallenge(
  id: string,
  otpCodeHash: string,
): Promise<{ minted: boolean; otpExpiresAt: Date }> {
  const otpExpiresAt = new Date(Date.now() + OTP_WINDOW_MS);
  const { count } = await prisma.signature.updateMany({
    where: { id, isActive: true, otpResendCount: { lt: MAX_OTP_MINTS } },
    data: { otpCodeHash, otpExpiresAt, otpResendCount: { increment: 1 } },
  });
  return { minted: count > 0, otpExpiresAt };
}

/**
 * Records ONE failed verification attempt, atomically, and PERMANENTLY locks the row the instant the
 * lifetime counter reaches `MAX_FAILED_ATTEMPTS` — the guarantee `otp.ts`'s own header names. Two
 * separate atomic writes, not one:
 *  1. `updateMany({ where: { id, isActive: true }, data: { otpFailedAttempts: { increment: 1 } } })`
 *     — guarded on `isActive` so a row that a CONCURRENT call already locked (or that was
 *     superseded by a fresh request) never gets a phantom extra increment counted against a budget
 *     that no longer applies to it; `count === 0` here means "someone else already closed this
 *     door", which this function reports as `locked: true` (the caller's refusal reads the same
 *     either way).
 *  2. A re-fetch, then — ONLY if the fresh count reached the threshold AND `lockedAt` is still unset
 *     — a SECOND guarded `updateMany({ where: { id, lockedAt: null }, ... })` that sets both
 *     `lockedAt` and `isActive: false` together (schema.prisma's own `Signature.lockedAt` header:
 *     "the SAME write"). Guarding on `lockedAt: null` here makes this idempotent under a race between
 *     two attempts that both reach the threshold at once — only one of them actually performs the
 *     lock write, the other's `updateMany` simply matches zero rows.
 */
export async function recordFailedAttempt(id: string): Promise<{ locked: boolean }> {
  const { count } = await prisma.signature.updateMany({
    where: { id, isActive: true },
    data: { otpFailedAttempts: { increment: 1 } },
  });
  if (count === 0) return { locked: true };

  const row = await prisma.signature.findUniqueOrThrow({ where: { id } });
  if (row.otpFailedAttempts < MAX_FAILED_ATTEMPTS) return { locked: false };

  await prisma.signature.updateMany({
    where: { id, lockedAt: null },
    data: { lockedAt: new Date(), isActive: false },
  });
  return { locked: true };
}

/** The terminal, successful write — `signedAt` AND `isActive: false` on the SAME call (schema.prisma's
 *  own header: a completed signature must never be replayable, the identical reasoning the lifetime
 *  lock above already holds). */
export async function markSignatureSigned(id: string): Promise<SignatureRecord> {
  return prisma.signature.update({
    where: { id },
    data: { signedAt: new Date(), isActive: false },
  });
}

/**
 * Freezes the "what the signer reviewed" PDF snapshot — ATOMIC and FIRST-WRITE-WINS, the same shape
 * `mintOtpChallenge`'s own header documents for the identical concurrency problem: two requests that
 * both observe `documentPdfUri === null` and race to render/persist their own copy must not both
 * "win" and leave the row pointing at whichever write happened to run last. The `updateMany`'s own
 * `where: { documentPdfUri: null }` is re-checked by Postgres at write time, so only the FIRST of two
 * concurrent freezes actually changes the row; the second's `updateMany` matches zero rows and its
 * own freshly-rendered (and now orphaned) bytes are simply never referenced by anything. The caller
 * (`SignaturesService.getPublicDocument`) re-fetches afterward and serves whichever snapshot actually
 * won, not necessarily its own — see that method's own header.
 */
export async function freezeDocumentPdfSnapshot(
  id: string,
  snapshot: { uri: string; hash: string },
): Promise<SignatureRecord> {
  await prisma.signature.updateMany({
    where: { id, documentPdfUri: null },
    data: { documentPdfUri: snapshot.uri, documentPdfHash: snapshot.hash },
  });
  return prisma.signature.findUniqueOrThrow({ where: { id } });
}
