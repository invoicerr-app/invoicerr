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
import { DEMO_ACCOUNT_EMAIL, isDemoModeEnabled, isDemoSeedBypassActive } from '@/modules/demo/demo-flag';

export type InvitationLookupResult =
  | { found: false }
  | { found: true; usedAt: Date | null; expiresAt: Date | null };

export type RegistrationDenialReason =
  | 'invalid_code'
  | 'already_used_code'
  | 'expired_code'
  | 'signup_disabled'
  | 'demo_mode';

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
  /** The address attempting to register — needed ONLY for the demo-mode bypass just below. Every
   *  other branch in this function ignores it entirely. */
  email?: string | null;
}): RegistrationDecision {
  const { invitationCode, invitation, isFirstUser, now = new Date(), email } = params;

  // Demo instance (issue #533) — checked FIRST, ahead of every other rule including the
  // first-user bootstrap and a valid invitation code: sign-up is closed outright on a demo instance,
  // full stop. The ONE exception is `scripts/demo-reset.ts`'s own bootstrap call, which creates the
  // fixed `demo@invoicerr.app` account through this exact same hook — recognised by BOTH its own
  // process-local `DEMO_SEED_RUN` marker AND the exact demo address, never by either alone (a stray
  // `DEMO_SEED_RUN=1` in a real deployment's environment must never open the door for anyone OTHER
  // than that one fixed address, and the address alone is not a secret worth trusting). See
  // `modules/demo/demo-flag.ts`'s own header for why this bypass can never be reached from an HTTP
  // request: the live API process never sets `DEMO_SEED_RUN`.
  if (isDemoModeEnabled(params.env)) {
    const isSeedBootstrap =
      isDemoSeedBypassActive(params.env) && email?.trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
    if (!isSeedBootstrap) {
      return { allowed: false, reason: 'demo_mode' };
    }
  }

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
    case 'demo_mode':
      return 'Sign-ups are closed on this demo instance. Sign in with the demo account shown on the sign-in page.';
  }
}
