/**
 * Extracted out of `auth.ts` purely for testability — importing `better-auth` at all (`auth.ts`'s own
 * `APIError`/`betterAuth` imports) is impossible under Jest: see `body-parser-auth-skip.ts`'s own
 * header for the full account (better-auth ships nearly every subpath export ESM-only, with no
 * "require" condition, so ts-jest's CJS loader cannot import it — this is why no spec in this
 * codebase imports `lib/auth.ts`). This file, like `registration-policy.ts`/`sso-policy.ts`/
 * `legal-signup-policy.ts` right beside it, stays free of that import so its logic can actually run
 * under Jest.
 *
 * ## The bug this closes
 *
 * `user.create.after` hooks (`auth.ts#userAfterCreateHook`) run through better-auth's own
 * `queueAfterTransactionHook` (`better-auth/dist/db/with-hooks.mjs`) — strictly AFTER the `user` row's
 * own INSERT has already committed. By the time `markInvitationAsUsed` discovers the invited company
 * has no free seat, the account this signup created already exists: there is no shared transaction
 * left to roll back. Left alone, that is an orphaned, company-less account PLUS a burned invitation
 * code (`pendingInvitationCodes` forgets it on ANY failure — `auth.ts#markInvitationAsUsed`'s own
 * `catch`) — a dead end where retrying the same email fails on "already in use" with no code left to
 * retry. The SSO signup path (`attachSsoProvisionedMembership`) accepts the equivalent trade-off ON
 * PURPOSE (its own header: "a refusal here leaves a real user with zero company memberships rather
 * than blocking sign-up outright") — this file exists because the invitation path never made that
 * same deliberate choice, it just fell into it.
 */
import { NO_FREE_SEAT_CODE } from '../modules/billing/seat-sync';

/**
 * Structural check, not `instanceof APIError` (see this file's own header on why `better-auth` can
 * never be imported here). `markInvitationAsUsed` is the only thing on the invitation path that ever
 * throws a `NO_FREE_SEAT_CODE` refusal, and it does so as `new APIError('FORBIDDEN', { message, code
 * })` — `error.body.code` is exactly that second argument, the way better-call's own `APIError` stores
 * it (`better-call/dist/error.mjs`).
 */
export function isNoFreeSeatRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('body' in error)) return false;
  const body = (error as { body?: unknown }).body;
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === NO_FREE_SEAT_CODE;
}

/**
 * Best-effort compensation: deletes the account `auth.ts` could not avoid committing before the seat
 * refusal became known. A failed cleanup must not shadow the seat refusal itself — the caller already
 * has a 403 to return regardless — so it is reported through `onCleanupFailed` instead of thrown.
 */
export async function deleteOrphanedUserAfterSeatRefusal(
  userId: string,
  deleteUser: (userId: string) => Promise<unknown>,
  onCleanupFailed: (error: unknown) => void,
): Promise<void> {
  try {
    await deleteUser(userId);
  } catch (error) {
    onCleanupFailed(error);
  }
}
