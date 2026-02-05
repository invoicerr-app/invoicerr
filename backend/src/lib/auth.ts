import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { type GenericOAuthConfig, genericOAuth } from 'better-auth/plugins';
import { PrismaClient } from '../../prisma/generated/prisma/client.js';

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
): Promise<{ valid: boolean; invitationCode?: string }> => {
  const userCount = await prisma.user.count();

  if (userCount === 0) {
    return { valid: true };
  }

  const invitationCode = pendingInvitationCodes.get(email);
  if (!invitationCode) {
    return { valid: false };
  }

  const invitation = await prisma.invitationCode.findUnique({
    where: { code: invitationCode },
  });

  if (
    !invitation ||
    invitation.usedAt ||
    (invitation.expiresAt && invitation.expiresAt < new Date())
  ) {
    pendingInvitationCodes.delete(email);
    return { valid: false };
  }

  return { valid: true, invitationCode };
};

const markInvitationAsUsed = async (email: string, userId: string) => {
  const invitationCode = pendingInvitationCodes.get(email);
  if (invitationCode) {
    try {
      // Get the invitation with company info
      const invitation = await prisma.invitationCode.findUnique({
        where: { code: invitationCode },
      });

      if (invitation) {
        // Mark as used
        await prisma.invitationCode.update({
          where: { code: invitationCode },
          data: {
            usedAt: new Date(),
            usedById: userId,
          },
        });

        // If company-specific invitation, add user to the company
        if (invitation.companyId) {
          // Check if user has any companies (for isDefault)
          const userCompanyCount = await prisma.userCompany.count({
            where: { userId },
          });

          await prisma.userCompany.create({
            data: {
              userId,
              companyId: invitation.companyId,
              role: invitation.role,
              isDefault: userCompanyCount === 0, // First company is default
            },
          });
        }
      }
    } catch (error) {
      console.warn(`Could not mark invitation code as used: ${error}`);
    }
    pendingInvitationCodes.delete(email);
  }
};

const userHookFunction = async (user) => {
  const data = user;

  if (user.given_name && user.family_name) {
    data.firstname = user.given_name;
    data.lastname = user.family_name;
  }

  if (user.firstname && user.lastname) {
    data.name = `${user.firstname} ${user.lastname}`;
  }

  if (user.email) {
    const validation = await validateInvitationForSignup(user.email);
    if (!validation.valid) {
      throw new Error('An invitation code is required to register');
    }
  }

  return { data };
};

const userAfterCreateHook = async (user) => {
  // Check if this is the first user (should become system admin)
  const userCount = await prisma.user.count();

  // If this is the first user (count is 1 after creation), make them system admin
  if (userCount === 1) {
    await prisma.user.update({
      where: { id: user.id },
      data: { isSystemAdmin: true },
    });
    user.isSystemAdmin = true;
  }

  if (user.email) {
    await markInvitationAsUsed(user.email, user.id);
  }
  return user;
};

export const auth = betterAuth({
  baseUrl: process.env.APP_URL || 'http://localhost:3000',
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
      isSystemAdmin: {
        type: 'boolean',
        required: false,
        input: false, // Not settable via API, only backend
        returned: true, // Return in session
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
  plugins: process.env.OIDC_CLIENT_ID ? [genericOAuth({ config: createOidcConfig() })] : [],
});
