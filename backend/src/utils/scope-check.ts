import { SetMetadata } from '@nestjs/common';

import { API_KEY_SCOPES, ApiKeyScope, isApiKeyScope } from '@/modules/api-keys/scopes';
import { RequestWithUser } from '@/types/request';

// Session (human) auth is never scope-restricted — its access is governed
// by CompanyRole/@Roles() instead. Only API-key callers (request.scopes is
// a string[], possibly empty) are narrowed to exactly their granted scopes.
export function hasScope(request: Pick<RequestWithUser, 'scopes'>, scope: ApiKeyScope): boolean {
  if (request.scopes === null) return true;
  return request.scopes.includes(scope);
}

/** True when the caller holds AT LEAST ONE of the given scopes — the "read OR write" shape a route
 *  that only needs to LOOK at a resource (but would also accept a write-scoped key) wants, mirroring
 *  `mcp/tools/scope-mapping.ts`'s own any-of check for the exact same reason. */
export function hasAnyScope(request: Pick<RequestWithUser, 'scopes'>, scopes: ApiKeyScope[]): boolean {
  return scopes.some((scope) => hasScope(request, scope));
}

/** Real business entities read/written DIRECTLY (`clients:*`/`articles:*`) — never resolved through
 *  the document-type registry, so never part of the document-scope predicates below. Moved here from
 *  `mcp/tools/scope-mapping.ts` (still re-exported there) so a REST controller can use the exact same
 *  computation the MCP tool layer already relies on, rather than a second, drifting one. */
const ENTITY_SCOPES: readonly ApiKeyScope[] = [
  'clients:read',
  'clients:write',
  'articles:read',
  'articles:write',
];

/** Every declared scope for an actual DOCUMENT TYPE (quotes/invoices/credit-notes/expenses/
 *  received-invoices), split by read vs write — everything in `API_KEY_SCOPES` minus the two entity
 *  pairs above. Adding a scope pair for a new document type to `API_KEY_SCOPES` is the only change
 *  ever needed to extend both of these; nothing here is ever hand-edited for a new type. */
export const DOCUMENT_READ_SCOPES: ApiKeyScope[] = API_KEY_SCOPES.filter(
  (scope) => scope.endsWith(':read') && !ENTITY_SCOPES.includes(scope),
);

export const DOCUMENT_WRITE_SCOPES: ApiKeyScope[] = API_KEY_SCOPES.filter(
  (scope) => scope.endsWith(':write') && !ENTITY_SCOPES.includes(scope),
);

/**
 * The scope a `typeId` needs for `mode` — `${typeId}s:${mode}` ("quote" -> "quotes:read",
 * "received-invoice" -> "received-invoices:write", ...), matching exactly how every shipped
 * `DocumentTypeDescriptor` id already reads. `undefined` (never a thrown error) when that computed
 * name isn't a real, declared `ApiKeyScope` — a `typeId` a plugin registers with no MCP/REST scope of
 * its own then fails CLOSED: no key, however broadly scoped, can ever be granted access to it through
 * a scope-gated route. See `mcp/tools/scope-mapping.ts`'s own header for the two-step (coarse at
 * registration, precise at call time) story this same function backs on the MCP side.
 */
export function scopeForDocumentType(typeId: string, mode: 'read' | 'write'): ApiKeyScope | undefined {
  const candidate = `${typeId}s:${mode}`;
  return isApiKeyScope(candidate) ? candidate : undefined;
}

/** Coarse fallback for a document-shaped REST route that does NOT carry a `typeId` at all (e.g.
 *  `GET /documents/dashboard`, which aggregates across every registered type) — granted by holding
 *  ANY document scope for `mode`, precise per-type gating being simply not expressible there. */
export function hasAnyDocumentScope(
  request: Pick<RequestWithUser, 'scopes'>,
  mode: 'read' | 'write',
): boolean {
  return hasAnyScope(request, mode === 'read' ? DOCUMENT_READ_SCOPES : DOCUMENT_WRITE_SCOPES);
}

export const REQUIRES_SCOPE_KEY = 'requiresScope';

/**
 * Declares which `ApiKeyScope`(s) a handler needs from an API-key caller — enforced by `AuthGuard`
 * itself (`guards/auth.guard.ts`), the SAME place that currently hands every API key a synthetic
 * `CompanyRole.ADMIN` for `@Roles()` purposes. Before this, `hasScope()` had exactly one real caller
 * in the whole backend (`mcp/mcp-server.factory.ts`) — no REST route ever consulted it, so a key
 * minted with a single narrow scope (e.g. `invoices:read`) sailed through every `@Roles(OWNER, ADMIN)`
 * REST route anyway. Any of the listed scopes satisfies the check (see `hasAnyScope` above) — most
 * handlers name exactly one, a handler that only needs to look at a resource may also accept its
 * write scope. Session (human) auth is untouched: `AuthGuard` only evaluates this for the branch that
 * sets `request.scopes` to a real array (API-key auth); a human's `request.scopes` stays `null`, which
 * `hasScope`/`hasAnyScope` already treat as "always satisfied".
 */
export const RequiresScope = (...scopes: ApiKeyScope[]) => SetMetadata(REQUIRES_SCOPE_KEY, scopes);

export const REQUIRES_DOCUMENT_TYPE_SCOPE_KEY = 'requiresDocumentTypeScope';

/**
 * The document-engine counterpart of `@RequiresScope` above, for `documents.controller.ts`: a FIXED
 * scope list cannot express this controller's routes, because which scope applies depends on the
 * `typeId` the CALLER names (a path param, a query string, or — `POST .../schedules` — a body field),
 * never something decorator metadata can see ahead of time. `AuthGuard` resolves the real scope at
 * request time via `scopeForDocumentType`/`hasAnyDocumentScope` above — see its own call site for the
 * exact (params → query → body) lookup order and the coarse fallback for a route with no `typeId` at
 * all (e.g. `GET /documents/dashboard`). `mode` is 'read' for a GET, 'write' for everything that
 * creates/mutates — the same HTTP-verb convention `@RequiresScope`'s own callers already follow.
 */
export const RequiresDocumentTypeScope = (mode: 'read' | 'write') =>
  SetMetadata(REQUIRES_DOCUMENT_TYPE_SCOPE_KEY, mode);
