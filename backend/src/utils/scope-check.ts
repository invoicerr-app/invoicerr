import { applyDecorators, SetMetadata } from '@nestjs/common';

import { ApiKeyScope, isApiKeyScope } from '@/modules/api-keys/scopes';
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

/** The document-type RESOURCES the document engine ships today, named ONCE — the read/write scope
 *  pair for each is derived below by template literal, matching the exact `<resource>:<mode>` shape
 *  `scopeForDocumentType` already computes for a `typeId`. This is a POSITIVE allow-list: a resource
 *  NOT named here is granted NOTHING by `DOCUMENT_READ_SCOPES`/`DOCUMENT_WRITE_SCOPES`, no matter
 *  what pair later joins `API_KEY_SCOPES` — the deliberate inverse of what used to live here.
 *
 *  It used to be a SUBTRACTION: the two arrays were "every `API_KEY_SCOPES` pair MINUS an exclusion
 *  list of known non-document entities" (`clients`, `articles`, `time-tracking`). That shape is only
 *  as safe as the exclusion list staying exhaustive forever, and it didn't: four more non-document
 *  pairs (`company`, `api-keys`, `webhooks`, `billing`) were added to `api-keys/scopes.ts` after the
 *  exclusion list was written and nobody added them to it, so each of their bare `:read` scopes
 *  satisfied `hasAnyDocumentScope(request, 'read')` (the coarse fallback every 'every-type' document
 *  route falls back to when no `typeId` is named) — a key minted with nothing but `billing:read`
 *  could read the company's quotes, invoices and every other document. A positive list fails the
 *  other way instead: an unclassified resource is excluded by DEFAULT, and the completeness check in
 *  `scope-check.spec.ts` turns "forgot to classify a new resource" into a red test rather than a
 *  silent grant.
 *
 *  Typed by indexing INTO `ApiKeyScope` via template literal, not cast down from bare strings: a typo
 *  here (`'quote'` for `'quotes'`) makes `` `${typo}:read` `` a string that is not a member of the
 *  `ApiKeyScope` union, so the `.map` below fails to COMPILE rather than silently producing a shorter
 *  array — the same "adding a type is the only change ever needed" property the old comment promised,
 *  now enforced by the type checker instead of by nobody forgetting to update an exclusion list. */
const DOCUMENT_TYPE_RESOURCES = [
  'quotes',
  'invoices',
  'credit-notes',
  'expenses',
  'received-invoices',
] as const;

export const DOCUMENT_READ_SCOPES: ApiKeyScope[] = DOCUMENT_TYPE_RESOURCES.map(
  (resource): ApiKeyScope => `${resource}:read`,
);

export const DOCUMENT_WRITE_SCOPES: ApiKeyScope[] = DOCUMENT_TYPE_RESOURCES.map(
  (resource): ApiKeyScope => `${resource}:write`,
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

export const DOCUMENT_TYPE_SCOPE_BREADTH_KEY = 'documentTypeScopeBreadth';

/**
 * Whether a document-scoped route is ABOUT one document type the caller names ('one-type'), or spans
 * every registered type at once ('every-type': `GET /documents/dashboard`, `GET /documents/types`,
 * the SSE stream, the reference/attachment helpers — routes where no single `typeId` exists to
 * check against, and where the coarse "holds ANY document scope for this mode" fallback is the only
 * thing expressible).
 *
 * 'one-type' is the DEFAULT, and deliberately the fail-closed one: a route that names a single
 * record without being told which type it is has no type predicate left to enforce, neither in the
 * scope check nor in the SQL (see `AuthGuard#assertDocumentTypeNamed`). A new per-document route
 * therefore starts out refusing a call that omits `typeId`, and only an explicit 'every-type' here —
 * a decision someone had to write down — opens it up.
 */
export type DocumentTypeScopeBreadth = 'one-type' | 'every-type';

/**
 * The document-engine counterpart of `@RequiresScope` above, for `documents.controller.ts`: a FIXED
 * scope list cannot express this controller's routes, because which scope applies depends on the
 * `typeId` the CALLER names (a path param, a query string, or — `POST .../schedules` — a body field),
 * never something decorator metadata can see ahead of time. `AuthGuard` resolves the real scope at
 * request time via `scopeForDocumentType`/`hasAnyDocumentScope` above — see its own call site for the
 * coarse fallback used by an 'every-type' route. `mode` is 'read' for a GET, 'write' for everything
 * that creates/mutates — the same HTTP-verb convention `@RequiresScope`'s own callers already follow.
 *
 * Two metadata keys rather than one object, so the mode a route declares stays readable on its own
 * by anything that only cares about read-vs-write.
 */
export const RequiresDocumentTypeScope = (
  mode: 'read' | 'write',
  breadth: DocumentTypeScopeBreadth = 'one-type',
) =>
  applyDecorators(
    SetMetadata(REQUIRES_DOCUMENT_TYPE_SCOPE_KEY, mode),
    SetMetadata(DOCUMENT_TYPE_SCOPE_BREADTH_KEY, breadth),
  );

/**
 * The document type a request NAMES — params → query → body, in that order, matching where each
 * document route actually carries it (a path segment for `types/:typeId/...`, a query string for the
 * per-document reads, the request body for `POST /documents/schedules`).
 *
 * Normalized the way the handlers themselves read it, so the scope resolved from this value is
 * always the scope of the type the handler will really act on: a query key repeated in the URL
 * (`?typeId=quote&typeId=invoice`) arrives as an array and collapses to its FIRST entry, exactly
 * what `dto/list-documents.dto.ts#firstValue` hands the list endpoint. An EMPTY value
 * (`?typeId=`) is not a named type and comes back `undefined` — otherwise a caller could spell
 * "this route is about no particular type" in a URL that looks like it names one.
 */
export function readRequestedDocumentType(request: {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): string | undefined {
  const raw = request.params?.typeId ?? request.query?.typeId ?? request.body?.typeId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
