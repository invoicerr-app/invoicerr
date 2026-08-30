import 'dotenv/config';

import { GenericOAuthConfig, customSession, genericOAuth } from 'better-auth/plugins';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { InvitationLookupResult, decideRegistration, registrationDenialMessage } from './registration-policy';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

const prisma = new PrismaClient({ adapter });

export const pendingInvitationCodes = new Map<string, string>();

const createOidcConfig = (): GenericOAuthConfig[] => {
  const config: GenericOAuthConfig = {
    providerId: process.env.OIDC_NAME || 'Generic OIDC',
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

const userHookFunction = async (user) => {
  const data = user;

  if (user.given_name && user.family_name) {
    data['firstname'] = user.given_name;
    data['lastname'] = user.family_name;
  }

  if (user.firstname && user.lastname) {
    data['name'] = `${user.firstname} ${user.lastname}`;
  }

  if (user.email) {
    const validation = await validateInvitationForSignup(user.email);
    if (!validation.valid) {
      throw new Error(validation.message || 'Registration is not allowed');
    }
  }

  return { data };
};

const userAfterCreateHook = async (user) => {
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
    enabled: true,
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [process.env.OIDC_NAME || 'Generic OIDC'],
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
    ...(process.env.OIDC_CLIENT_ID ? [genericOAuth({ config: createOidcConfig() })] : []),
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
