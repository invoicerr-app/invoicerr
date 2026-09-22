import {
  BadRequestException,
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
  DOCUMENT_TYPE_SCOPE_BREADTH_KEY,
  DocumentTypeScopeBreadth,
  hasAnyDocumentScope,
  hasAnyScope,
  hasScope,
  readRequestedDocumentType,
  REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
  REQUIRES_SCOPE_KEY,
  scopeForDocumentType,
} from '@/utils/scope-check';

// Use the same metadata key as @thallesp/nestjs-better-auth
const IS_PUBLIC_KEY = 'PUBLIC';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /**
   * A route declared `'one-type'` (the default of `@RequiresDocumentTypeScope`) must be TOLD which
   * document type it is about, whoever is calling. Nothing else in this pipeline makes a caller say
   * it: `@ApiQuery({ required: true })` is Swagger metadata the request never passes through, and
   * `app.module.ts` registers no global `APP_PIPE`, so `?typeId=` can simply be left off the URL.
   *
   * Leave it off and TWO separate controls stop working, on that one missing word. The scope check
   * below falls through to its coarse "holds ANY document scope for this mode" branch — written for
   * the aggregate routes, never for one aimed at a single record — so a key granted only
   * `invoices:read` passes the gate on a QUOTE. Then the handler forwards `typeId: undefined` into
   * `modules/documents/persistence.ts#findOwnedDocument`, and Prisma drops an `undefined` filter out
   * of the WHERE clause entirely, leaving `companyId` as the sole predicate: the row comes back, of
   * whatever type it is. Together that is a narrow-purpose key reading every quote, credit note and
   * received invoice in the company, in full, through `GET /documents/:id` and its `:id/archives`,
   * `:id/authority-events` and `:id/share-links` siblings.
   *
   * Refused here, before either control is consulted, and for a human session as well as for a key:
   * the type predicate that vanishes from the SQL vanishes the same way for both, and a route that
   * promises a 404 across types must not answer 200 just because the caller stayed quiet.
   */
  private assertDocumentTypeNamed(
    context: ExecutionContext,
    request: {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    },
  ): void {
    const breadth = this.reflector.getAllAndOverride<DocumentTypeScopeBreadth>(
      DOCUMENT_TYPE_SCOPE_BREADTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (breadth !== 'one-type') return;

    if (readRequestedDocumentType(request) === undefined) {
      throw new BadRequestException('This route is about one document type — name it with `typeId`.');
    }
  }

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
      this.assertDocumentTypeNamed(context, request);
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

        // A route aimed at ONE document type has already been refused above unless the caller named
        // it (`assertDocumentTypeNamed`), so the coarse branch below is now reachable only from a
        // route that genuinely spans every type — which is the only thing it was ever written for.
        this.assertDocumentTypeNamed(context, request);

        // `documents.controller.ts`'s own counterpart: `@RequiresDocumentTypeScope('read'|'write')`
        // instead of a fixed scope list, because which scope applies depends on the `typeId` the
        // CALLER names — never something decorator metadata alone can express. Read through the one
        // shared `readRequestedDocumentType` (params → query → body) so this check and the refusal
        // above can never disagree about what the caller named. An 'every-type' route (e.g.
        // `GET /documents/dashboard`, which aggregates across every type) falls back to the coarse
        // "holds ANY document scope for this mode" check — the same two-tier (coarse/precise) shape
        // `mcp/tools/scope-mapping.ts` already established for the exact same reason.
        const documentScopeMode = this.reflector.getAllAndOverride<'read' | 'write'>(
          REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
          [context.getHandler(), context.getClass()],
        );
        if (documentScopeMode) {
          const typeId = readRequestedDocumentType(request);
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
