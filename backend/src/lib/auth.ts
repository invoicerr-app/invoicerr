import 'dotenv/config';

import { GenericOAuthConfig, customSession, genericOAuth } from 'better-auth/plugins';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { InvitationLookupResult, decideRegistration, registrationDenialMessage } from './registration-policy';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  SSO_PROVISIONED_ROLE,
  companyForOAuthSignup,
  deriveUserNames,
  isOidcOnly,
  resolveEnvOidcProvider,
  trustedProviderIds,
} from './sso-policy';
import { registeredCompanyProviderIds } from './sso-registry';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

const prisma = new PrismaClient({ adapter });

export const pendingInvitationCodes = new Map<string, string>();

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

  if (process.env.OIDC_JWKS_URI) {
    config.discoveryUrl = process.env.OIDC_JWKS_URI;
  } else {
    if (process.env.OIDC_AUTHORIZATION_ENDPOINT) {
      config.authorizationUrl = process.env.OIDC_AUTHORIZATION_ENDPOINT;
    }
    if (process.env.OIDC_TOKEN_ENDPOINT) {
      config.tokenUrl = process.env.OIDC_TOKEN_ENDPOINT;
    }
    if (process.env.OIDC_USERINFO_ENDPOINT) {
      config.userInfoUrl = process.env.OIDC_USERINFO_ENDPOINT;
    }
  }

  return [config];
};

const validateInvitationForSignup = async (
  email: string,
): Promise<{ valid: boolean; invitationCode?: string; message?: string }> => {
  const isFirstUser = (await prisma.user.count()) === 0;

  // `pendingInvitationCodes` est une Map DANS LE PROCESSUS : elle survit à une réinitialisation de
  // la base. Sur une base sans aucun utilisateur, un code en attente est donc forcément un fantôme
  // d'une tentative antérieure — aucun code ne peut être valide là où aucune entreprise n'existe,
  // puisqu'un code appartient à une entreprise.
  //
  // On l'oublie ICI plutôt que dans la politique : la règle « un code fourni est vérifié, même pour
  // le premier utilisateur » est juste et testée — quelqu'un qui TAPE un code mérite qu'on lui dise
  // qu'il est invalide. C'est la provenance du code qui est douteuse, pas la règle.
  //
  // Trouvé en rejouant la batterie : le jeu d'essai s'inscrivait après une spec d'auth qui avait
  // laissé un code invalide pour la même adresse, et vingt-deux tests tombaient derrière lui.
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
    },
  },
  plugins: [
    // The gate is unchanged — `OIDC_CLIENT_ID` still decides whether the environment provider is
    // registered — but it is now expressed ONCE, as the same fact the frontend reads, instead of
    // being re-derived here and again from `OIDC_NAME` in the browser.
    ...(envOidcProvider.registered ? [genericOAuth({ config: createOidcConfig() })] : []),
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
