import 'dotenv/config';

import { GenericOAuthConfig, customSession, genericOAuth } from 'better-auth/plugins';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { APIError, betterAuth } from 'better-auth';
import { InvitationLookupResult, decideRegistration, registrationDenialMessage } from './registration-policy';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  SSO_PROVISIONED_ROLE,
  accountLinkingOptions,
  companyForOAuthSignup,
  deriveUserNames,
  isOidcOnly,
  providerIdFromEndpointContext,
  resolveEnvOidcProvider,
  resolveOidcEndpoints,
  signupMayAssertVerifiedEmail,
  ssoLinkValidator,
} from './sso-policy';
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  acceptLegalFromEndpointContext,
  legalAcceptanceRequiredAtSignup,
} from './legal-signup-policy';
import { recordLegalAcceptance } from '../legal/legal-acceptance';
import { REQUIRED_ACCEPTANCE_SLUGS } from '../legal/legal-documents';
import { isBillingEnabled } from '../modules/billing/billing-flag';
import {
  SoleOwnerError,
  assertNotSoleOwner,
  cleanupAfterUserDelete,
  sendChangeEmailMail,
} from '../modules/auth-extended/account-lifecycle';
import { NO_FREE_SEAT_CODE, NoFreeSeatError, withSeatReservation } from '../modules/billing/seat-sync';
import { syncCompanyMemberOnMembershipChange } from '../modules/billing/member-sync';
import { syncPolarMemberEmailForUser } from '../modules/billing/member-email-sync';
import { MailService } from '../mail/mail.service';
import { deleteOrphanedUserAfterSeatRefusal, isNoFreeSeatRefusal } from './seat-refusal-cleanup';
import { createPendingSignupStore, createRedisClientForPendingSignups } from './pending-signup-store';
import { CLIENT_IP_HEADER } from './client-ip-header';
import { devOnlyOrigins } from './dev-origins';
import { normalizeSignupLocale } from '../modules/auth-extended/signup-locale';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

const prisma = new PrismaClient({ adapter });

// Same reasoning as `prisma` just above: `lib/auth.ts` runs outside Nest DI entirely, so every
// infrastructure client it needs is its own plain instance rather than an injected one. This is the
// INSTANCE mail path (`sendMail`), never `sendForCompany`'s per-company cascade — a user account
// belongs to no company (see `account-lifecycle.ts`'s own header on `buildChangeEmailMail`).
const mailService = new MailService();

const appUrl = () => process.env.APP_URL || 'http://localhost:3000';

/**
 * Redis-backed, not two bare in-process `Map`s — see `pending-signup-store.ts`'s own header for the
 * cross-replica gap that used to leave a pending invitation code, or a to-be-deleted user's
 * memberships, unreadable whenever the depositing and the reading request landed on different API
 * processes. Its `takePendingMembershipsForDeletedUser`/`setPendingMembershipsForDeletedUser` pair
 * (used in `deleteUser.beforeDelete`/`afterDelete` below) bridges those two hooks for the SAME logical
 * request the identical way the invitation-code half bridges "validate" to "sign up" — by the time
 * `afterDelete` runs, the DB's own `ON DELETE CASCADE` has already removed the deleted user's
 * `UserCompany` rows (see `account-lifecycle.ts#cleanupAfterUserDelete`'s own header), so there is
 * nothing left to query them from; `beforeDelete` captures the list while it still can.
 */
const pendingSignupStore = createPendingSignupStore(createRedisClientForPendingSignups());

/**
 * The instance-wide provider's identity and whether it is registered, resolved ONCE here — it cannot
 * change without a restart, like every other env read in this file. Per-COMPANY providers are the
 * opposite: they appear and disappear while the process runs, which is why they are read from
 * `sso-registry` on every request instead (see `account.accountLinking.trustedProviders` below).
 */
const envOidcProvider = resolveEnvOidcProvider();

const createOidcConfig = (): GenericOAuthConfig[] => {
  const config: GenericOAuthConfig = {
    // `sso-policy.ts#resolveEnvOidcProvider` owns this id so the backend, `entrypoint.sh`'s
    // config.json, and the sign-in page cannot disagree about it — and so the default is URL-safe
    // (the old `'Generic OIDC'` default carried a SPACE into a callback path segment).
    providerId: envOidcProvider.providerId,
    clientId: process.env.OIDC_CLIENT_ID || 'TEMP',
    scopes: ['openid', 'profile', 'email'],
  };

  if (process.env.OIDC_CLIENT_SECRET) {
    config.clientSecret = process.env.OIDC_CLIENT_SECRET;
  }

  // Discovery-vs-manual endpoint selection, the `OIDC_JWKS_URI` legacy alias, and
  // `OIDC_END_SESSION_ENDPOINT` (RP-Initiated Logout) are all decided in
  // `sso-policy.ts#resolveOidcEndpoints` — pulled out of this function specifically so they can be
  // unit-tested, since importing THIS file at all builds a live Prisma adapter (see `sso-policy.ts`'s
  // own module header for why no spec imports `auth.ts`).
  Object.assign(config, resolveOidcEndpoints());

  return [config];
};

const validateInvitationForSignup = async (
  email: string,
): Promise<{ valid: boolean; invitationCode?: string; message?: string }> => {
  const isFirstUser = (await prisma.user.count()) === 0;

  // `pendingSignupStore` survives a database reset (Redis and Postgres are separate stores). On a
  // database with no users at all, a pending code is therefore necessarily a ghost from an earlier
  // attempt — no code can be valid where no company exists, since a code belongs to a company.
  //
  // We forget it HERE rather than in the policy: the rule "a supplied code is verified, even for
  // the first user" is correct and tested — someone who TYPES a code deserves to be told it is
  // invalid. It is the code's PROVENANCE that is suspect, not the rule.
  //
  // Found by replaying the full test suite: the fixture data signed up right after an auth spec
  // that had left an invalid code behind for the same address, and twenty-two tests fell over
  // because of it.
  if (isFirstUser) {
    await pendingSignupStore.deletePendingInvitationCode(email);
  }

  const invitationCode = (await pendingSignupStore.getPendingInvitationCode(email)) ?? undefined;

  let invitation: InvitationLookupResult | undefined;
  if (invitationCode) {
    const record = await prisma.invitationCode.findUnique({ where: { code: invitationCode } });
    invitation = record
      ? { found: true, usedAt: record.usedAt, expiresAt: record.expiresAt }
      : { found: false };
  }

  const decision = decideRegistration({ invitationCode, invitation, isFirstUser });

  if (!decision.allowed) {
    // A code was supplied and rejected: forget it, it must not be silently retried
    // (or re-consumed) by a later signup attempt for the same email.
    if (invitationCode) {
      await pendingSignupStore.deletePendingInvitationCode(email);
    }
    return { valid: false, message: registrationDenialMessage(decision.reason) };
  }

  return { valid: true, invitationCode };
};

const markInvitationAsUsed = async (email: string, userId: string) => {
  const invitationCode = await pendingSignupStore.getPendingInvitationCode(email);
  if (invitationCode) {
    try {
      const invitation = await prisma.invitationCode.findUnique({ where: { code: invitationCode } });
      if (!invitation) throw new Error(`Invitation code "${invitationCode}" not found`);

      // Marking the code used and attaching the new user to the company/role it was issued for happen
      // in the SAME transaction as the seat reservation — a `NoFreeSeatError` (thrown before either
      // write runs, see `withSeatReservation`'s own header) rolls the invitation's own `usedAt` back
      // too, so a refused code stays valid to retry once a seat frees up rather than being burned for
      // nothing. Upsert (not a plain create): re-using an invitation link for a user who somehow
      // already belongs to that company stays the harmless no-op it always was (no capacity check, no
      // desk reassignment either — see that same header).
      //
      // `updateMany` guarded on `usedAt: null`, never a plain `update` — the earlier `findUnique`
      // above already read `usedAt: null`, but that read is OUTSIDE this transaction, so two concurrent
      // sign-ups for the same still-unused code (or a concurrent `useInvitation` accepting the same
      // link) would otherwise both pass the check and both write, minting two `UserCompany` rows for
      // one nominative invitation. `withSeatReservation`'s own row lock only serializes concurrent
      // reservations for the SAME company when billing is enabled (see that function's own header) —
      // self-hosted mode runs with no lock at all, so the guarded `WHERE usedAt IS NULL` here is what
      // actually makes consumption atomic in every mode, not merely a belt-and-suspenders check.
      await withSeatReservation(invitation.companyId, userId, async (tx) => {
        const { count } = await tx.invitationCode.updateMany({
          where: { id: invitation.id, usedAt: null },
          data: { usedAt: new Date(), usedById: userId },
        });
        if (count === 0) {
          throw new Error(`Invitation code "${invitationCode}" has already been used`);
        }
        return tx.userCompany.upsert({
          where: { userId_companyId: { userId, companyId: invitation.companyId } },
          create: { userId, companyId: invitation.companyId, role: invitation.role },
          update: {},
        });
      });
      // The invitation can carry OWNER/ADMIN — see `member-sync.ts`'s own header.
      await syncCompanyMemberOnMembershipChange(invitation.companyId, userId);
    } catch (error) {
      await pendingSignupStore.deletePendingInvitationCode(email);
      if (error instanceof NoFreeSeatError) {
        throw new APIError('FORBIDDEN', { message: error.message, code: NO_FREE_SEAT_CODE });
      }
      console.warn(`Could not mark invitation code as used: ${error}`);
      return;
    }
    await pendingSignupStore.deletePendingInvitationCode(email);
  }
};

/**
 * Attach a user who arrived through their OWN company's IdP to that company.
 *
 * `UserCompany` rows are otherwise created ONLY by `markInvitationAsUsed`, and an employee arriving
 * through their employer's identity provider has no invitation — so without this they would land with
 * zero memberships and drop straight into the company-creation wizard, inside a product their
 * employer already pays for.
 *
 * The stored row is re-read rather than trusting the in-memory registration: the company id arrives
 * inside a provider id off the wire, so it is untrusted input (the `findUnique` is what makes the
 * foreign key safe), and a provider deactivated after this process registered it must stop minting
 * memberships immediately.
 */
const attachSsoProvisionedMembership = async (companyId: string, userId: string) => {
  const provider = await prisma.companySsoProvider.findUnique({
    where: { companyId },
    select: { isActive: true },
  });

  if (!provider?.isActive) {
    console.warn(`SSO sign-up for company ${companyId}: no active SSO provider row, membership not created.`);
    return;
  }

  // Upsert INSIDE the seat reservation, for the same reason `markInvitationAsUsed` does: a user who
  // somehow already belongs to the company is a no-op (no capacity check, no desk reassignment), while
  // a genuinely new membership is refused with `NoFreeSeatError` once the company has no free seat —
  // translated below into the better-auth `APIError` the SSO callback's own response surfaces. The
  // account itself was already created by this point (better-auth's `user.create.after` hook), so a
  // refusal here leaves a real user with zero company memberships rather than blocking sign-up outright
  // — the same trade-off an over-capacity company already accepts for any OTHER new arrival.
  try {
    await withSeatReservation(companyId, userId, (tx) =>
      tx.userCompany.upsert({
        where: { userId_companyId: { userId, companyId } },
        create: { userId, companyId, role: SSO_PROVISIONED_ROLE },
        update: {},
      }),
    );
  } catch (error) {
    if (error instanceof NoFreeSeatError) {
      throw new APIError('FORBIDDEN', { message: error.message, code: NO_FREE_SEAT_CODE });
    }
    throw error;
  }
  // `SSO_PROVISIONED_ROLE` can be OWNER/ADMIN — see `member-sync.ts`'s own header.
  await syncCompanyMemberOnMembershipChange(companyId, userId);
};

const userHookFunction = async (user, context) => {
  const data = user;

  // `User.firstname`/`User.lastname` are NOT NULL with no default, and an IdP is under no obligation
  // to send `given_name`/`family_name` — many send only `name`, some neither. Deriving them is what
  // lets a federated user be inserted at all; supplied values are never overwritten, so
  // email/password sign-up keeps exactly the names it posted. See `sso-policy.ts#deriveUserNames`.
  const names = deriveUserNames(data);
  data['firstname'] = names.firstname;
  data['lastname'] = names.lastname;
  if (names.name) {
    data['name'] = names.name;
  }

  // Best-effort account language, posted by `signUp.email` as a plain additional field (see the
  // `locale` entry in `user.additionalFields` below) — never present at all on an OAuth/SSO sign-up,
  // which is fine: `normalizeSignupLocale(undefined)` is `null`, the same "no preference yet" state a
  // federated account already starts in. See `signup-locale.ts`'s own header for why an unsupported
  // browser language is dropped here rather than rejected the way the preferences endpoint rejects one.
  data['locale'] = normalizeSignupLocale(data['locale']);

  // What an IdP CLAIMS about an address it does not own is not proof that address was proven. Written
  // here, on the before-create hook, because it is the last point this process controls before
  // better-auth's own `createUser` persists the provider's `emailVerified` verbatim (see
  // `sso-policy.ts#signupMayAssertVerifiedEmail` for the full account of which provider may assert it
  // and why the column is worth defending).
  if (!signupMayAssertVerifiedEmail(context)) {
    data['emailVerified'] = false;
  }

  // A user arriving through their own company's IdP has no invitation and must not be asked for one:
  // the provider id of the in-flight OAuth callback IS the authorization, since only a company that
  // registered that IdP can produce a callback bearing its id. Deliberately does NOT consult
  // `pendingInvitationCodes` — a stale code left there for the same address must neither be consumed
  // by an SSO sign-in nor be able to refuse one.
  if (companyForOAuthSignup(context)) {
    return { data };
  }

  if (user.email) {
    // Gated to the plain email/password branch — `providerIdFromEndpointContext` is non-null for
    // BOTH a company-provisioned SSO signup (already returned above) and the instance-wide OIDC
    // provider's own first-time login, which reaches this point too (it has no company to attach to,
    // so `companyForOAuthSignup` returns null for it). Neither flow's screen carries the sign-up
    // checkbox this gate requires, and an OIDC identity provider has no way to answer it — see
    // `legal-signup-policy.ts`'s own header for why only email/password is in scope.
    if (
      providerIdFromEndpointContext(context) === null &&
      legalAcceptanceRequiredAtSignup(isBillingEnabled(), acceptLegalFromEndpointContext(context))
    ) {
      throw new APIError('BAD_REQUEST', {
        message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
        code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
      });
    }

    const validation = await validateInvitationForSignup(user.email);
    if (!validation.valid) {
      throw new Error(validation.message || 'Registration is not allowed');
    }
  }

  return { data };
};

const userAfterCreateHook = async (user, context) => {
  const ssoCompanyId = companyForOAuthSignup(context);
  if (ssoCompanyId) {
    await attachSsoProvisionedMembership(ssoCompanyId, user.id);
    return user;
  }

  if (user.email) {
    try {
      await markInvitationAsUsed(user.email, user.id);
    } catch (error) {
      // `markInvitationAsUsed` runs from a `user.create.after` hook, which better-auth fires only
      // once the `user` row's own INSERT has already committed (see `seat-refusal-cleanup.ts`'s own
      // header for the full mechanism) — so a `NoFreeSeatError` here can no longer prevent the
      // account from existing, only compensate for it. Without this, the account survives with zero
      // company memberships AND a burned invitation code, a dead end the SSO signup path explicitly
      // does NOT share (its own trade-off is documented and accepted in
      // `attachSsoProvisionedMembership`'s header) — this thread is specifically about the invitation
      // path never having made that same deliberate choice.
      if (isNoFreeSeatRefusal(error)) {
        await deleteOrphanedUserAfterSeatRefusal(
          user.id,
          (id) => prisma.user.delete({ where: { id } }),
          (cleanupError) =>
            console.warn(`Could not delete orphaned user ${user.id} after a refused seat: ${cleanupError}`),
        );
      }
      throw error;
    }
  }

  // Reaching here in SaaS mode, on the plain email/password branch, means `userHookFunction` already
  // let this sign-up through — which, in SaaS mode, means `acceptLegal` WAS `true`. Recorded here
  // (after-create, once `user.id` exists) rather than in the before-hook itself. No IP/user-agent
  // captured on this path (better-auth's `after` context carries no reliable request object) — see
  // `legal.controller.ts`'s own `POST /api/legal/accept` for the path that does capture it, used by
  // the sign-in re-acceptance interstitial instead.
  if (isBillingEnabled() && providerIdFromEndpointContext(context) === null) {
    await recordLegalAcceptance(user.id, REQUIRED_ACCEPTANCE_SLUGS);
  }

  return user;
};

export const auth = betterAuth({
  baseURL: process.env.APP_URL || 'http://localhost:3000',
  // Fall back to JWT_SECRET so existing deployments that only set it keep working
  secret: process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET,
  trustedOrigins: [
    ...devOnlyOrigins(),
    process.env.APP_URL,
    ...(process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || []),
  ].filter((origin): origin is string => typeof origin === 'string'),
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  // Without this, better-auth's own default (`dist/cookies/index.mjs`) derives `secure` from whether
  // `baseURL` (i.e. `APP_URL`) STARTS WITH `https://` — not from `NODE_ENV`. A deployment that
  // terminates TLS somewhere other than this container's own bundled nginx (another reverse proxy in
  // front of it) and leaves `APP_URL` on an internal `http://` address would then mint session cookies
  // with no `Secure` attribute at all: they would be sent over any accidental plain-HTTP hop. Tying it
  // to `NODE_ENV === 'production'` instead makes the decision explicit and independent of how `APP_URL`
  // happens to be spelled. This line — `sameSite: 'lax'`, the default `emit` also documents explicitly
  // here rather than leaving it an unstated library default — is the ONLY thing standing between every
  // Nest route (`/api/*` outside `/api/auth`, which better-auth's own origin check already covers) and
  // CSRF: there is no separate application-level CSRF token anywhere in this codebase. `httpOnly: true`
  // is better-auth's own default already; restated here so all three attributes this guarantee depends
  // on are visible in one place instead of two of them being implicit.
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    // Per-client rate limiting fix, proven live 2026-09-22 (150 concurrent `GET /api/auth/get-session`
    // from 150 distinct client addresses served/refused the exact same 100/50 split as the same 150
    // calls from ONE address). better-auth's bundled rate limiter resolves the client address via
    // `getIP()` (`@better-auth/core/dist/utils/ip.mjs`), which by default reads `X-Forwarded-For` and
    // refuses to trust it at all once it carries more than one entry — which it always does here,
    // because this app's own nginx (`nginx.conf`) APPENDS its own peer address to whatever
    // `X-Forwarded-For` it received rather than overwriting it. `ipAddressHeaders` points `getIP` at a
    // header this process controls instead: `create-app.ts`'s own `injectClientIpHeaderMiddleware()`
    // overwrites `CLIENT_IP_HEADER` on every request with Express's own resolved `req.ip`
    // (never appended, never trusted from the client — see that file's own header for why that matters)
    // before better-auth's handler ever runs.
    //
    // Option name and shape (`ipAddress?: { ipAddressHeaders?: string[]; ... }` under `advanced`)
    // verified against the installed better-auth 1.7.4 typings directly — the bundled `.d.mts` is the
    // only documentation this dependency ships (see `lib/auth.ts`'s own sibling comments on
    // `sendVerificationEmail` for the same practice) —
    // `node_modules/@better-auth/core/dist/types/init-options.d.mts:232-243`
    // (`BetterAuthAdvancedOptions['ipAddress']['ipAddressHeaders']`), and the consumer that actually
    // reads it is `getIP()` in `node_modules/@better-auth/core/dist/utils/ip.mjs`
    // (`options.advanced?.ipAddress?.ipAddressHeaders || DEFAULT_IP_HEADERS`), called from
    // `node_modules/better-auth/dist/api/rate-limiter/index.mjs:239`.
    ipAddress: {
      ipAddressHeaders: [CLIENT_IP_HEADER],
    },
  },
  emailAndPassword: {
    // OIDC_ONLY (instance-wide, DEFAULT OFF — `sso-policy.ts#isOidcOnly`) turns this into a
    // single-sign-on-only instance. better-auth does NOT gate `setPassword`/`changePassword` behind
    // this flag, so `modules/auth-extended/auth-extended.controller.ts` refuses that route explicitly
    // as well; without both halves the flag would merely hide a form rather than close a door.
    enabled: !isOidcOnly(),
  },
  // Powers `user.changeEmail` below. Despite the name, this is NOT a signup feature here: `sendOnSignUp`
  // and `sendOnSignIn` are both left unset (default off, and `requireEmailVerification` is never set
  // either, so neither follows it into "on") — the only caller that ever reaches
  // `sendVerificationEmail` today is `POST /api/auth/change-email`'s own "send a link to the new
  // address" branch (`node_modules/better-auth/dist/api/routes/update-user.mjs`'s `changeEmail`
  // endpoint, the final branch once `updateEmailWithoutVerification` and `sendChangeEmailConfirmation`
  // are both unset, which they are below) — better-auth reuses this generic hook for that rather than
  // exposing a field literally named `sendChangeEmailVerification`; confirmed by reading that file
  // directly, since the bundled types are the only documentation this dependency ships.
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      // `user.locale` — the "Mon compte" language preference (`locale` additionalField declared
      // below) — is not part of better-auth's own typed `User` shape, so it is read the same way
      // `userHookFunction` above reads it: bracket notation on the loosely-typed hook object, never a
      // cast to a concrete interface that does not actually declare this field.
      const language = (user as Record<string, unknown>)['locale'] as string | null | undefined;
      await sendChangeEmailMail(mailService, { newEmail: user.email, url, appUrl: appUrl(), language });
    },
  },
  account: {
    accountLinking: accountLinkingOptions({ env: envOidcProvider }),
  },
  user: {
    /**
     * The second lock on "whose account may an identity provider speak for", independent of
     * `account.accountLinking` above and held HERE rather than in a library default.
     *
     * A per-company provider id carries its company (`c_<companyId>`), so "this IdP is only allowed
     * to be attached to a member of its own company" is a question this process can actually answer.
     * It refuses the takeover a second time on the one path `disableImplicitLinking` deliberately
     * leaves open — the authenticated `linkSocial` flow, where better-auth runs this hook BEFORE its
     * own trusted-provider check (`dist/api/routes/callback.mjs`'s `link` branch) — so an account
     * owner cannot be walked through a link that hands a stranger's identity provider permanent
     * authority over their account.
     *
     * Deliberately silent for every other action and provider: `create-user` has no existing account
     * to take over, `sign-in` reaches an account already bound to this exact provider and subject,
     * and the instance-wide provider is the operator's own. So the membership query below runs only
     * on an explicit link through a tenant IdP, never on the sign-in path.
     */
    validateUserInfo: ssoLinkValidator({
      isCompanyMember: async (userId, companyId) =>
        (await prisma.userCompany.findUnique({
          where: { userId_companyId: { userId, companyId } },
          select: { userId: true },
        })) !== null,
    }),
    additionalFields: {
      firstname: {
        type: 'string',
        required: true,
        input: true,
      },
      lastname: {
        type: 'string',
        required: true,
        input: true,
      },
      // The "Mon compte" language preference (`schema.prisma`'s own comment on `User.locale` for the
      // full rationale). `input: true` is what makes `signUp.email({ locale: ... })` land in `data`
      // for `userHookFunction` to normalize below — WITHOUT this declaration, better-auth's own
      // adapter would neither accept the field on write nor include it when building `session.user`,
      // and `PATCH /api/auth-extended/preferences` (which writes the column directly through Prisma,
      // bypassing better-auth entirely) would have no way to make its change visible in the session at
      // all. `required: false`: unset is a legitimate state (falls back to `Company.language`, then
      // 'en' — `resolve-user-language.ts`), not an error.
      locale: {
        type: 'string',
        required: false,
        input: true,
      },
    },
    changeEmail: {
      enabled: true,
      // `sendChangeEmailConfirmation` (sent to the OLD address, requiring a currently-verified
      // email — see the endpoint's own ladder) is deliberately left unset: the product decision here
      // is one email, to the NEW address, and the account's email does not change until that link is
      // opened (`emailVerification.sendVerificationEmail` above). `updateEmailWithoutVerification`
      // stays unset too, for the same reason — an email change must always be confirmed, verified
      // current address or not.
    },
    deleteUser: {
      enabled: true,
      // `sendDeleteAccountVerification` is deliberately NOT set here, even though it exists for
      // exactly the "email a verification link" case this product wants for an SSO-only account: read
      // literally (`update-user.mjs`'s `deleteUser` endpoint, lines ~291-349), when that option is
      // configured at ALL it takes over the response for EVERY call that doesn't already carry a
      // `token` — including one that supplied a correct `password` — always returning
      // "Verification email sent" instead of deleting. Setting it would silently break the
      // password-in, deleted-immediately path a credential account is supposed to keep. Without it, a
      // credential account still deletes immediately off its `password` (verified above this branch,
      // then falls straight through to `beforeDelete`), and an SSO-only account (no password to send)
      // falls to better-auth's own session-freshness gate instead of an email link: fresh enough →
      // deletes immediately, stale → `SESSION_EXPIRED`, asking them to sign back in with their
      // provider and retry. A true mail-link flow for SSO-only accounts would need its own endpoint
      // minting a better-auth-compatible verification token directly — a bigger, separate change than
      // this one warrants.
      beforeDelete: async (user) => {
        try {
          const memberships = await assertNotSoleOwner(user.id);
          await pendingSignupStore.setPendingMembershipsForDeletedUser(user.id, memberships);
        } catch (error) {
          if (error instanceof SoleOwnerError) {
            throw new APIError('FORBIDDEN', { message: error.message, code: error.code });
          }
          throw error;
        }
      },
      afterDelete: async (user) => {
        const memberships = await pendingSignupStore.takePendingMembershipsForDeletedUser(user.id);
        await cleanupAfterUserDelete(memberships, {
          id: user.id,
          email: user.email,
          // better-auth's own `user` object (its core shape, not our Prisma model) only carries a
          // single `name` field here, not `firstname`/`lastname` — good enough for a Polar member's
          // display name, which is all this is used for.
          name: user.name || null,
        });
      },
    },
  },
  session: {
    additionalFields: {
      // Which company (of the ones the user belongs to) is currently
      // active. Server-managed only — never accepted as client input,
      // set exclusively via POST /api/companies/switch.
      activeCompanyId: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: userHookFunction,
        after: userAfterCreateHook,
      },
      // Fires after ANY user row update, including the one `updateUser` performs once a
      // `changeEmail` confirmation link is actually opened (better-auth's own internal-adapter path,
      // not the moment the link is merely SENT — `account-lifecycle.ts#sendChangeEmailMail`'s own
      // header is that earlier step). `syncPolarMemberEmailForUser` itself is a cheap no-op for the
      // overwhelming majority of these calls (billing disabled, or this user holds no OWNER/ADMIN
      // membership anywhere) — see that module's own header for why running it unconditionally here,
      // rather than trying to detect "was this SPECIFICALLY an email change" from this hook's own
      // arguments (which carry no reliable before/after diff), is the pragmatic choice: a
      // no-op-if-unchanged push to Polar costs nothing extra, and never firing is the one failure
      // mode this hook must avoid.
      update: {
        after: async (user) => {
          await syncPolarMemberEmailForUser(user.id, user.email, user.name || null);
        },
      },
    },
  },
  plugins: [
    // The gate is unchanged — `OIDC_CLIENT_ID` still decides whether the environment provider is
    // registered — but it is now expressed ONCE, as the same fact the frontend reads, instead of
    // being re-derived here and again from `OIDC_NAME` in the browser.
    ...(envOidcProvider.registered ? [genericOAuth({ config: createOidcConfig() })] : []),
    // Hosted billing (product decision 2026-09-15, moved to per-COMPANY Polar customers 2026-09-16 —
    // option A) no longer mounts anything HERE at all: `@polar-sh/better-auth`'s own `checkout()`/
    // `portal()` hard-code `externalCustomerId: session.user.id` with no way to override it, which is
    // exactly wrong for a product that bills per company, not per user — see
    // `modules/billing/checkout-session.ts`/`portal-session.ts`'s own headers. Both now live as plain
    // Nest routes instead (`BillingController`'s `POST /billing/checkout`/`/billing/portal`), gated by
    // `@ActiveCompany()` + `@BillingGateExempt()` the ordinary way, not by better-auth's own
    // middleware. Boot-time credential validation (`assertPolarEnvConfiguredForBoot`, `main.ts`)
    // still runs unconditionally — it gates `POLAR_ACCESS_TOKEN` etc. for those routes' own
    // `getPolarClient()`, not for anything constructed at this module's load time any more.
    // Enriches every session with the caller's company memberships and
    // resolves which one is active, so `AuthGuard` can thread a
    // companyId/role through every request without an extra query.
    customSession(async ({ user, session }) => {
      const memberships = await prisma.userCompany.findMany({
        where: { userId: user.id },
        include: { company: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });

      const companies = memberships.map((m) => ({
        id: m.companyId,
        name: m.company.name,
        role: m.role,
      }));

      const storedActiveCompanyId = (session as { activeCompanyId?: string | null }).activeCompanyId;
      const activeMembership =
        memberships.find((m) => m.companyId === storedActiveCompanyId) ?? memberships[0];

      return {
        user,
        session,
        companies,
        activeCompanyId: activeMembership?.companyId ?? null,
        activeRole: activeMembership?.role ?? null,
      };
    }),
  ],
});
