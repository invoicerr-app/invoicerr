/**
 * Shared, framework-agnostic policy for who is allowed to create an account.
 *
 * Two call sites need the exact same decision but can't share a DI container:
 *  - `lib/auth.ts`'s better-auth `databaseHooks.user.create.before` hook, which only has a bare
 *    `PrismaClient` (better-auth is configured outside Nest's module graph);
 *  - `modules/invitations/invitations.service.ts`'s `canRegister()`, a Nest-injected
 *    `PrismaService`, used by the front end to pre-flight a signup before submitting it.
 * Both resolve the same raw facts (was a code supplied? does it exist / is it still usable?
 * has anyone registered yet?) from their own Prisma client, then hand them to this pure
 * function so the actual decision — and its exact order — lives in exactly one place instead
 * of drifting between two copies.
 *
 * The order, deliberately:
 *   1. A code was supplied — it must be valid, full stop. A bad code is never silently treated
 *      as "no code" and waved through as an open signup: that would hide a typo'd or stolen
 *      code behind a success screen.
 *   2. No code, but nobody is registered yet — the bootstrap escape hatch. A fresh instance
 *      with DISABLE_AUTH set must still let its first admin in, or the instance is permanently
 *      unusable (nobody could ever create the very first account).
 *   3. No code, not the first user — open signup unless the operator closed it.
 *   4. Otherwise — open signup: the account is created without a company and the user lands
 *      on the company-creation onboarding (see frontend/src/components/onboarding.tsx and
 *      sidebar.tsx's auto-open-when-companies.length===0 effect).
 */

export type InvitationLookupResult =
  | { found: false }
  | { found: true; usedAt: Date | null; expiresAt: Date | null };

export type RegistrationDenialReason =
  | 'invalid_code'
  | 'already_used_code'
  | 'expired_code'
  | 'signup_disabled';

export type RegistrationDecision = { allowed: true } | { allowed: false; reason: RegistrationDenialReason };

/**
 * DISABLE_AUTH closes open self-registration — it does NOT disable login, despite what the
 * name suggests. Kept as specified rather than renamed: its failure mode already leans the
 * safe way (an operator who sets it expecting to lock down login gets a MORE restrictive
 * result than they typed — signups closed — never a more permissive one), so the confusing
 * name is a documentation problem, not a security one.
 * Accepts "1" / "true", case-insensitively, tolerating surrounding whitespace.
 */
export function isSignupDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.DISABLE_AUTH ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export function decideRegistration(params: {
  invitationCode?: string | null;
  invitation?: InvitationLookupResult;
  isFirstUser: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): RegistrationDecision {
  const { invitationCode, invitation, isFirstUser, now = new Date() } = params;

  if (invitationCode) {
    if (!invitation?.found) {
      return { allowed: false, reason: 'invalid_code' };
    }
    if (invitation.usedAt) {
      return { allowed: false, reason: 'already_used_code' };
    }
    if (invitation.expiresAt && invitation.expiresAt < now) {
      return { allowed: false, reason: 'expired_code' };
    }
    return { allowed: true };
  }

  if (isFirstUser) {
    return { allowed: true };
  }

  if (isSignupDisabledByEnv(params.env)) {
    return { allowed: false, reason: 'signup_disabled' };
  }

  return { allowed: true };
}

export function registrationDenialMessage(reason: RegistrationDenialReason): string {
  switch (reason) {
    case 'invalid_code':
      return 'Invalid invitation code';
    case 'already_used_code':
      return 'This invitation code has already been used';
    case 'expired_code':
      return 'This invitation code has expired';
    case 'signup_disabled':
      return 'Sign-ups are currently disabled on this instance. Ask an existing member for an invitation code to join their company.';
  }
}
