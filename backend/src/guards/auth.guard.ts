import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { extractApiKey, hashApiKey } from '@/utils/api-key';

import { CompanyRole } from '../../prisma/generated/prisma/client';
import { Reflector } from '@nestjs/core';
import { auth } from '@/lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import prisma from '@/prisma/prisma.service';
import { ApiKeyScope } from '@/modules/api-keys/scopes';
import {
  hasAnyDocumentScope,
  hasAnyScope,
  hasScope,
  REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
  REQUIRES_SCOPE_KEY,
  scopeForDocumentType,
} from '@/utils/scope-check';

// Use the same metadata key as @thallesp/nestjs-better-auth
const IS_PUBLIC_KEY = 'PUBLIC';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

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
        // The key row itself outlives its holder's membership — removing someone from a company
        // (`companies.service.ts#removeMember`) or demoting them only ever touches the `UserCompany`
        // row, never their `ApiKey` rows. Re-reading that membership on EVERY request (rather than
        // trusting whatever role held at key-creation time) is what makes a removal/demotion take
        // effect immediately for API-key access too, the same instant it takes effect for a session —
        // no separate cleanup step to remember, and no window where a revoked ADMIN's key still acts
        // with ADMIN authority. A key whose holder has left the company entirely is refused outright,
        // exactly like a session for a deleted membership would be.
        const membership = await prisma.userCompany.findUnique({
          where: { userId_companyId: { userId: apiKey.userId, companyId: apiKey.companyId } },
          select: { role: true },
        });
        if (!membership) {
          throw new UnauthorizedException();
        }

        prisma.apiKey
          .update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => undefined);

        request.user = apiKey.user;
        request.companyId = apiKey.companyId;
        // The holder's REAL, current company role — never a synthetic ADMIN. `@Roles()` checks
        // downstream (member management, other API keys, danger-zone actions) now see exactly the
        // authority this person actually has today, closing the gap a demotion used to leave open.
        request.role = membership.role;
        request.companies = [];
        // Restricts API-key callers (e.g. the MCP module) to exactly these
        // scopes regardless of the caller's real CompanyRole above.
        request.scopes = apiKey.scopes;

        // A handler can additionally name the scope(s) an API key needs via `@RequiresScope(...)`
        // (`utils/scope-check.ts`) — checked here, the one place BOTH auth mechanisms are resolved,
        // rather than in a second guard that would have to re-derive `request.scopes` itself. Session
        // auth never reaches this: `request.scopes` is `null` there, and `hasAnyScope` already treats
        // `null` as "always satisfied" (a human's access is governed by role, never scopes).
        const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(REQUIRES_SCOPE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (requiredScopes && requiredScopes.length > 0 && !hasAnyScope(request, requiredScopes)) {
          throw new ForbiddenException('This API key is missing the scope required for this action');
        }

        // `documents.controller.ts`'s own counterpart: `@RequiresDocumentTypeScope('read'|'write')`
        // instead of a fixed scope list, because which scope applies depends on the `typeId` the
        // CALLER names — never something decorator metadata alone can express. Looked up
        // params → query → body, in that order, matching where each route on that controller
        // actually carries it (a path segment for most, a query string for a handful of GETs, the
        // request body for `POST .../schedules`). No `typeId` at all (e.g. `GET /documents/
        // dashboard`, which aggregates across every type) falls back to the coarse "holds ANY
        // document scope for this mode" check — the same two-tier (coarse/precise) shape
        // `mcp/tools/scope-mapping.ts` already established for the exact same reason.
        const documentScopeMode = this.reflector.getAllAndOverride<'read' | 'write'>(
          REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
          [context.getHandler(), context.getClass()],
        );
        if (documentScopeMode) {
          const typeId: string | undefined =
            request.params?.typeId ?? request.query?.typeId ?? request.body?.typeId;
          const allowed = typeId
            ? (() => {
                const scope = scopeForDocumentType(typeId, documentScopeMode);
                return !!scope && hasScope(request, scope);
              })()
            : hasAnyDocumentScope(request, documentScopeMode);
          if (!allowed) {
            throw new ForbiddenException('This API key is missing the scope required for this document type');
          }
        }

        return true;
      }
    }

    throw new UnauthorizedException();
  }
}
