import 'dotenv/config';

import { GenericOAuthConfig, customSession, genericOAuth } from 'better-auth/plugins';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { APIError, betterAuth } from 'better-auth';
import { InvitationLookupResult, decideRegistration, registrationDenialMessage } from './registration-policy';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  SSO_PROVISIONED_ROLE,
  companyForOAuthSignup,
  deriveUserNames,
  isOidcOnly,
  resolveEnvOidcProvider,
  resolveOidcEndpoints,
  trustedProviderIds,
} from './sso-policy';
import {
  AccountMembership,
  SoleOwnerError,
  assertNotSoleOwner,
  cleanupAfterUserDelete,
  sendChangeEmailMail,
} from '../modules/auth-extended/account-lifecycle';
import { registeredCompanyProviderIds } from './sso-registry';
import { syncCompanySeatsOnMembershipChange } from '../modules/billing/seat-sync';
import { syncCompanyMemberOnMembershipChange } from '../modules/billing/member-sync';
import { syncPolarMemberEmailForUser } from '../modules/billing/member-email-sync';
import { MailService } from '../mail/mail.service';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

const prisma = new PrismaClient({ adapter });

// Same reasoning as `prisma` just above: `lib/auth.ts` runs outside Nest DI entirely, so every
// infrastructure client it needs is its own plain instance rather than an injected one. This is the
// INSTANCE mail path (`sendMail`), never `sendForCompany`'s per-company cascade — a user account
// belongs to no company (see `account-lifecycle.ts`'s own header on `buildChangeEmailMail`).
const mailService = new MailService();

const appUrl = () => process.env.APP_URL || 'http://localhost:3000';

export const pendingInvitationCodes = new Map<string, string>();

/**
 * Bridges `deleteUser.beforeDelete` to `deleteUser.afterDelete` for the SAME request: by the time
 * `afterDelete` runs, the DB's own `ON DELETE CASCADE` has already removed the deleted user's
 * `UserCompany` rows (see `account-lifecycle.ts#cleanupAfterUserDelete`'s own header), so there is
 * nothing left to query them from — `beforeDelete` captures the list while it still can. The same
 * in-process-Map shape `pendingInvitationCodes` above already uses for a similar
 * "captured earlier in the same flow, consumed once, never persisted" need.
 */
const pendingMembershipsForDeletedUser = new Map<string, AccountMembership[]>();

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

  // `pendingInvitationCodes` is an IN-PROCESS Map: it survives a database reset. On a database with
  // no users at all, a pending code is therefore necessarily a ghost from an earlier attempt — no
  // code can be valid where no company exists, since a code belongs to a company.
  //
  // We forget it HERE rather than in the policy: the rule "a supplied code is verified, even for
  // the first user" is correct and tested — someone who TYPES a code deserves to be told it is
  // invalid. It is the code's PROVENANCE that is suspect, not the rule.
  //
  // Found by replaying the full test suite: the fixture data signed up right after an auth spec
  // that had left an invalid code behind for the same address, and twenty-two tests fell over
  // because of it.
  if (isFirstUser) {
    pendingInvitationCodes.delete(email);
  }

  const invitationCode = pendingInvitationCodes.get(email);

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
      pendingInvitationCodes.delete(email);
    }
    return { valid: false, message: registrationDenialMessage(decision.reason) };
  }

  return { valid: true, invitationCode };
};

const markInvitationAsUsed = async (email: string, userId: string) => {
  const invitationCode = pendingInvitationCodes.get(email);
  if (invitationCode) {
    try {
      const invitation = await prisma.invitationCode.update({
        where: { code: invitationCode },
        data: {
          usedAt: new Date(),
          usedById: userId,
        },
      });

      // Attach the new user to the company/role the invitation was
      // issued for. Upsert: re-using an invitation link for a user who
      // somehow already belongs to that company should be a no-op,
      // not a unique-constraint failure.
      await prisma.userCompany.upsert({
        where: { userId_companyId: { userId, companyId: invitation.companyId } },
        create: { userId, companyId: invitation.companyId, role: invitation.role },
        update: {},
      });
      // A brand-new user accepted via invitation code is a new seat — see `seat-sync.ts`'s own
      // header for why this is a plain, best-effort, never-throwing call (a no-op entirely when
      // billing is disabled).
      await syncCompanySeatsOnMembershipChange(invitation.companyId);
      // The invitation can carry OWNER/ADMIN — see `member-sync.ts`'s own header.
      await syncCompanyMemberOnMembershipChange(invitation.companyId, userId);
    } catch (error) {
      console.warn(`Could not mark invitation code as used: ${error}`);
    }
    pendingInvitationCodes.delete(email);
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

  // Upsert, for the same reason `markInvitationAsUsed` upserts: a user who somehow already belongs to
  // the company must be a no-op, never a unique-constraint failure mid-callback.
  await prisma.userCompany.upsert({
    where: { userId_companyId: { userId, companyId } },
    create: { userId, companyId, role: SSO_PROVISIONED_ROLE },
    update: {},
  });
  // Same reason `markInvitationAsUsed` syncs — a new SSO-provisioned membership is a new seat.
  await syncCompanySeatsOnMembershipChange(companyId);
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

  // A user arriving through their own company's IdP has no invitation and must not be asked for one:
  // the provider id of the in-flight OAuth callback IS the authorization, since only a company that
  // registered that IdP can produce a callback bearing its id. Deliberately does NOT consult
  // `pendingInvitationCodes` — a stale code left there for the same address must neither be consumed
  // by an SSO sign-in nor be able to refuse one.
  if (companyForOAuthSignup(context)) {
    return { data };
  }

  if (user.email) {
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
    await markInvitationAsUsed(user.email, user.id);
  }
  return user;
};

export const auth = betterAuth({
  baseURL: process.env.APP_URL || 'http://localhost:3000',
  // Fall back to JWT_SECRET so existing deployments that only set it keep working
  secret: process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET,
  trustedOrigins: [
    'http://localhost:5173',
    process.env.APP_URL,
    ...(process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || []),
  ].filter((origin): origin is string => typeof origin === 'string'),
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
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
      await sendChangeEmailMail(mailService, { newEmail: user.email, url, appUrl: appUrl() });
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      // A FUNCTION, not the static one-element array this used to be. better-auth re-resolves this
      // per request when given a function (`dist/context/helpers.mjs#getTrustedProviders`), which is
      // the only reason a per-company provider registered AFTER boot can ever be trusted: as a static
      // array it was evaluated once, at import time, when no company provider existed yet — so
      // account linking silently failed for every tenant provider.
      trustedProviders: async () =>
        trustedProviderIds({
          env: envOidcProvider,
          companyProviderIds: registeredCompanyProviderIds(),
        }),
    },
  },
  user: {
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
          pendingMembershipsForDeletedUser.set(user.id, memberships);
        } catch (error) {
          if (error instanceof SoleOwnerError) {
            throw new APIError('FORBIDDEN', { message: error.message, code: error.code });
          }
          throw error;
        }
      },
      afterDelete: async (user) => {
        const memberships = pendingMembershipsForDeletedUser.get(user.id) ?? [];
        pendingMembershipsForDeletedUser.delete(user.id);
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
