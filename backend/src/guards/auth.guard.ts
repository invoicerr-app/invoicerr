import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { extractApiKey, hashApiKey } from '@/utils/api-key';

import { CompanyRole } from '../../prisma/generated/prisma/client';
import { Reflector } from '@nestjs/core';
import { auth } from '@/lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import prisma from '@/prisma/prisma.service';

// Use the same metadata key as @thallesp/nestjs-better-auth
const IS_PUBLIC_KEY = 'PUBLIC';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headers = fromNodeHeaders(request.headers);

    const session = await auth.api.getSession({
      headers,
    });

    if (session) {
      request.user = session.user;
      request.session = session.session;
      // Enriched by the customSession plugin (see src/lib/auth.ts) with the
      // caller's company memberships and the currently active one.
      const enrichedSession = session as unknown as {
        companies?: { id: string; name: string; role: CompanyRole }[];
        activeCompanyId?: string | null;
        activeRole?: CompanyRole | null;
      };
      request.companyId = enrichedSession.activeCompanyId ?? null;
      request.role = enrichedSession.activeRole ?? null;
      request.companies = enrichedSession.companies ?? [];
      // Session (human) auth isn't scope-restricted — access is governed
      // by CompanyRole instead. See @/utils/scope-check's hasScope().
      request.scopes = null;
      return true;
    }

    const rawKey = extractApiKey(request.headers);
    if (rawKey) {
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash: hashApiKey(rawKey) },
        include: { user: true },
      });

      if (apiKey) {
        prisma.apiKey.update({
          where: { id: apiKey.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => undefined);

        request.user = apiKey.user;
        request.companyId = apiKey.companyId;
        // API keys are company-scoped, not member-scoped: grant them the
        // same access as an ADMIN would have (no member/invitation
        // management via API key, but full business-data + settings access).
        request.role = CompanyRole.ADMIN;
        request.companies = [];
        // Restricts API-key callers (e.g. the MCP module) to exactly these
        // scopes regardless of the synthetic ADMIN role above.
        request.scopes = apiKey.scopes;
        return true;
      }
    }

    throw new UnauthorizedException();
  }
}
