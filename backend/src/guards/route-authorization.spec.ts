/**
 * Every HTTP route this application registers must carry an EXPLICIT authorization decision, and a
 * route that changes state must be gated by a WRITE scope. Both are checked here against the real
 * module graph, so a route written tomorrow is checked the day it is written.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `AuthGuard` evaluates `@RequiresScope`/`@RequiresDocumentTypeScope` only when that metadata is
 * present. A handler that declares none never consults `request.scopes` — so an API key minted for
 * one narrow purpose (say `articles:read`) reaches it with the FULL authority of its holder's
 * `CompanyRole`, which is exactly the hole the scope mechanism was written to close. Nothing about
 * that failure is visible at the call site: the route simply works, for everyone, forever.
 *
 * The previous guard against this (`requires-scope.controllers.spec.ts`) pins the metadata that IS
 * there, controller by controller, from a hand-written list. That catches an annotation deleted by a
 * refactor — it cannot, by construction, say anything about a controller nobody added to the list. A
 * new route is born invisible to it. Three defects of this class were found by reading code one file
 * at a time in a single day (a payment-method write with no role, four custom-field writes with
 * neither role nor scope, a mail test-connection route with no role); this test is what replaces
 * that reading.
 *
 * So this file inverts the list. It does not enumerate what is guarded; it enumerates what is NOT,
 * and refuses everything else. The default becomes refusal, and adding a route to the exceptions
 * below is a decision someone has to write down, with a reason, in a reviewed diff.
 *
 * HOW THE ROUTES ARE ENUMERATED
 *
 * From `AppModule` itself — `NestFactory.createApplicationContext(..., { preview: true })` builds the
 * REAL module graph (every `imports:` chain, every conditionally-registered module) and Nest's own
 * `DiscoveryService`/`MetadataScanner` then walk it. Not a glob over `*.controller.ts`: a file glob
 * would count a controller that no module registers (dead code, reported as a false positive) and
 * miss one registered from somewhere unexpected. Preview mode is what makes that affordable here —
 * it builds the graph WITHOUT instantiating a single provider and without running any lifecycle
 * hook, so this needs no Postgres, no Redis and no credentials, unlike `openapi-dump.ts` which boots
 * the app for real.
 *
 * The two env flags below are set before `AppModule` is imported so the graph is the WIDEST one this
 * codebase can produce — hosted billing and the instance backup module both gate themselves out of
 * `app.module.ts` entirely when their flag is unset, and a route that only exists on a SaaS
 * deployment needs checking exactly as much as one that always exists.
 *
 * THE TWO ASSERTIONS
 *
 *  1. Every handler declares something explicit — `@Public()`, `@Roles()`, `@RequiresScope()`,
 *     `@RequiresDocumentTypeScope()`, or a guard that refuses API-key auth outright
 *     (`InstanceOperatorGuard`: no scope can express "instance operator", and it rejects every key
 *     regardless of what it was granted, which is strictly stronger than any scope). Never an
 *     implicit default.
 *
 *  2. Every handler whose verb is not GET declares a WRITE scope. A route that changes state behind
 *     a READ scope is the subtler half of the same defect — `@RequiresScope` is an ANY-OF check
 *     (`hasAnyScope`), so a write route naming both `x:read` and `x:write` is satisfied by a
 *     read-only key and is a write behind a read scope in disguise. Hence: every scope a non-GET
 *     route names must end in `:write`, or its document-type mode must be `'write'`.
 *
 * WHY THE EXCEPTIONS LIST IS SHAPED THIS WAY
 *
 * Two maps keyed `Controller#method`, each value a sentence saying why THAT route legitimately
 * carries no scope. A short list is the point: it is read end to end by whoever adds to it, and a
 * reason that cannot be written in a sentence is a route that should be fixed instead. An entry in
 * `NO_SCOPE_IS_CORRECT` also waives assertion 2 for that route (it declares no scope at all, so
 * there is no write scope to demand either) — its reason has to cover both, which is why those
 * reasons say what the route writes.
 *
 * The list is kept honest from the other side too: a third test fails if an exception names a route
 * that no longer exists, or one that would now pass on its own. Without that, this list decays into
 * the very allowlist it replaces.
 *
 * THE DECISION THIS TEST FORCED, AND WHERE IT LANDED
 *
 * `ProjectsController` and `TimeEntriesController` (nine routes) failed both assertions when this
 * file was written, deliberately and visibly. Every other unguarded route it found had an existing
 * `ApiKeyScope` naming the resource it acts on; time tracking had none — a project is not a client,
 * an article, or any registered document type. Excusing them in the map below would have recorded an
 * answer nobody had given, so they stayed red until one was given, which is the whole point of the
 * exceptions list being a short, reasoned one rather than a place to put anything inconvenient.
 *
 * The answer was a scope pair of its own — `time-tracking:read`/`time-tracking:write`
 * (`modules/api-keys/scopes.ts`) — not a fold onto `invoices:*`, which would have granted the power
 * to issue invoices to anything that wants to log an hour. The pair is also named in
 * `utils/scope-check.ts`'s entity list, without which it would have joined the DERIVED document
 * scopes there and widened the coarse "holds ANY document scope" fallback instead of narrowing
 * anything. `POST /api/time-entries/generate-invoice` was the sharp case — it reads time entries AND
 * creates an invoice, and `@RequiresScope` is an any-of check that cannot express "both" — so it
 * names `invoices:write`, the heavier of the two consequences. All of it is proven against the real
 * guard in `guards/time-tracking-scope.spec.ts`.
 */
import 'reflect-metadata';

import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { INestApplicationContext, RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, NestFactory } from '@nestjs/core';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';

import { REQUIRES_DOCUMENT_TYPE_SCOPE_KEY, REQUIRES_SCOPE_KEY } from '@/utils/scope-check';

import { InstanceOperatorGuard } from './instance-operator.guard';

// The key `@thallesp/nestjs-better-auth`'s own `@Public()`/`@AllowAnonymous()` sets, and the only one
// `auth.guard.ts` reads — see `decorators/public.decorator.ts` for why this codebase has exactly one
// such key and not two.
const IS_PUBLIC_KEY = 'PUBLIC';

const ROLES_KEY = 'roles';

/**
 * Routes that legitimately carry NO scope, each with the reason it carries none. An entry here also
 * waives the write-scope rule for that route, so each reason states what the route writes.
 */
const NO_SCOPE_IS_CORRECT: Record<string, string> = {
  // --- Personal-account routes. An API key is always minted FOR ONE COMPANY (`ApiKey.companyId`),
  // and none of these acts on a company at all: no `ApiKeyScope` names the resource, and inventing
  // one would misdescribe what the key is. This is the posture these controllers already document
  // for themselves.
  'LegalController#status':
    "Reads the CALLER's own legal-acceptance state, no company resource. Nothing company-scoped to " +
    'name a scope for.',
  'LegalController#accept':
    "Records the CALLER's own acceptance of a legal document — a row about the person, not the " +
    'company. It is also the one write that must survive the global legal gate, so it can never be ' +
    'the route that locks someone out.',
  'AccountTransfersController#mine':
    'Lists ownership transfers addressed to the CALLER, who may not be a member of the sending ' +
    'company at all — there is no active company here to scope a key against.',
  'AccountTransfersController#accept':
    'Accepts an ownership transfer addressed to the CALLER, becoming OWNER of a company the caller ' +
    'was not a member of. A key minted for the SENDING company must not be able to do this, and a ' +
    'key for any other company has nothing to do with it either.',
  'AuthExtendedController#setPassword':
    "Sets the CALLER's own account password through better-auth, which requires a real better-auth " +
    'session of its own: an API-key request carries none, so this already refuses every key with a ' +
    '401 before any scope could be consulted.',
  'AuthExtendedController#updatePreferences':
    "Writes one field on the caller's own user row — the language they read the app in. Per-user, " +
    'not per-company, and it touches no company data.',

  // --- The scope mechanism's own entry point.
  'McpController#handleMcp':
    'This route IS the scope check for everything it dispatches: it hands `request.scopes` straight ' +
    'to `createMcpServerForRequest`, and every MCP tool behind it is gated per call against those ' +
    'scopes (`mcp/tools/scope-mapping.ts`). A fixed scope here would be either narrower than some ' +
    'tool needs or wider than others deserve.',

  // --- Reads that touch no company data at all. Nothing here is derived from, or reveals anything
  // about, the caller's own company — so there is no company resource for a scope to narrow.
  'CountryReadinessController#getReadiness':
    'Answers whether a COUNTRY has every core catalog wired — a fact about the shipped catalogs, ' +
    'identical for every company on the instance. Reads no company row.',
  'CountryReadinessController#listFullySupported':
    'The same catalog fact as its sibling, listed instead of asked one country at a time. Reads no ' +
    'company row.',
  'CountryReadinessController#getMentionWindowAlerts':
    'Reports which shipped legal-mention value tables are about to stop covering new invoices — an ' +
    'operational fact about the catalogs themselves, not about any company.',
  'CompanyLookupController#lookup':
    'Queries PUBLIC company registries by a caller-supplied identifier; its two sibling routes are ' +
    '`@Public()` outright. It reads nothing belonging to the calling company.',
  'SireneController#getCompanyBySiret':
    'Proxies the French public SIRENE registry for one SIRET. Same shape as the lookup above: no ' +
    'company row is read, so no company resource can be named.',
};

/**
 * Non-GET routes that legitimately declare something OTHER than a write scope. Distinct from the map
 * above: these DO carry an authorization decision, it simply is not a write scope — which only ever
 * holds when the verb is not actually describing a state change.
 */
const WRITE_WITHOUT_WRITE_SCOPE_IS_CORRECT: Record<string, string> = {
  'DocumentsController#resolveActionParamsDefaults':
    'A POST that writes nothing: it computes the pre-fill values for an action-parameters form and ' +
    'returns them. It is a POST only because the values are derived from a request BODY (the ' +
    "in-progress document), which a GET cannot carry. Reading the document's own type is exactly " +
    'the authority it needs, hence the read-mode document-type scope.',
};

interface HandlerRoute {
  /** `Controller#method` — the key both exception maps above are written in. */
  id: string;
  /** For the failure message only: what a caller would actually call. */
  signature: string;
  verb: string;
  isPublic: boolean;
  hasRoles: boolean;
  scopes: string[] | undefined;
  documentScopeMode: 'read' | 'write' | undefined;
  refusesApiKeys: boolean;
}

function metadataOf<T>(key: string, handler: object, controller: object): T | undefined {
  return (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller)) as T | undefined;
}

/** `@UseGuards(InstanceOperatorGuard)` on the handler or its controller. That guard rejects API-key
 *  auth outright (`request.scopes !== null` → 403) before any scope could be read, so a route behind
 *  it has made an authorization decision strictly stronger than any scope could express. */
function refusesApiKeyAuth(handler: object, controller: object): boolean {
  const declared = [
    ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? []),
  ];
  return declared.some((guard) => guard === InstanceOperatorGuard || guard instanceof InstanceOperatorGuard);
}

function joinPath(...segments: unknown[]): string {
  const parts = segments
    .flatMap((segment) => (Array.isArray(segment) ? segment : [segment]))
    .filter((segment): segment is string => typeof segment === 'string' && segment.length > 0);
  return `/api/${parts.join('/')}`.replace(/\/+/g, '/').replace(/(.+)\/$/, '$1');
}

function collectRoutes(container: ModulesContainer): HandlerRoute[] {
  const discovery = new DiscoveryService(container);
  const scanner = new MetadataScanner();
  const routes: HandlerRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as { name: string; prototype: object } | undefined;
    if (!controller?.prototype) continue;

    const basePath = Reflect.getMetadata(PATH_METADATA, controller);

    for (const name of scanner.getAllMethodNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, object>)[name];
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      // Only methods carrying an HTTP verb are routes; a controller's helpers and its constructor
      // are not, and neither is `@Sse()`-adjacent plumbing that never registers a path.
      if (verb === undefined) continue;

      routes.push({
        id: `${controller.name}#${name}`,
        signature: `${RequestMethod[verb]} ${joinPath(basePath, Reflect.getMetadata(PATH_METADATA, handler))}`,
        verb: RequestMethod[verb],
        isPublic: metadataOf<boolean>(IS_PUBLIC_KEY, handler, controller) === true,
        hasRoles: (metadataOf<unknown[]>(ROLES_KEY, handler, controller) ?? []).length > 0,
        scopes: metadataOf<string[]>(REQUIRES_SCOPE_KEY, handler, controller),
        documentScopeMode: metadataOf<'read' | 'write'>(
          REQUIRES_DOCUMENT_TYPE_SCOPE_KEY,
          handler,
          controller,
        ),
        refusesApiKeys: refusesApiKeyAuth(handler, controller),
      });
    }
  }

  return routes.sort((a, b) => a.id.localeCompare(b.id));
}

/** Assertion 1: the route names SOMETHING. */
function declaresAnAuthorizationDecision(route: HandlerRoute): boolean {
  return (
    route.isPublic ||
    route.hasRoles ||
    (route.scopes?.length ?? 0) > 0 ||
    route.documentScopeMode !== undefined ||
    route.refusesApiKeys
  );
}

/** Assertion 2: a state change is gated by a WRITE scope. `@RequiresScope` is an any-of check, so
 *  EVERY scope named has to be a write one — a list mixing `x:read` in is satisfied by a read-only
 *  key, which is the defect, not a relaxation of it. */
function declaresAWriteScope(route: HandlerRoute): boolean {
  if (route.refusesApiKeys) return true;
  if (route.documentScopeMode === 'write') return true;
  const scopes = route.scopes ?? [];
  return scopes.length > 0 && scopes.every((scope) => scope.endsWith(':write'));
}

function restoreFlag(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

function report(routes: HandlerRoute[], reasons: Record<string, string>): string {
  const lines = routes.map((route) => `  ${route.signature}  (${route.id})`);
  return [
    '',
    ...lines,
    '',
    'Give each of these an explicit decision — @Public(), @Roles(), @RequiresScope() or',
    '@RequiresDocumentTypeScope() — or, if it genuinely needs none, add it to the exceptions map in',
    `this file with the reason why (${Object.keys(reasons).length} entries there today).`,
    '',
  ].join('\n');
}

describe('every registered HTTP route carries an explicit authorization decision', () => {
  let app: INestApplicationContext;
  let routes: HandlerRoute[];
  // Restored in `afterAll`: `isBillingEnabled()` is read by other code paths from this same
  // `process.env`, and a spec that widens a feature flag must not leave it widened behind it.
  const flagsBefore = {
    billing: process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING,
    backup: process.env.BACKUP_S3_BUCKET,
  };

  beforeAll(async () => {
    // Set BEFORE importing `app.module.ts`: both flags are read once, at module-definition time, to
    // decide whether their module enters the graph at all. Without them this test would silently
    // check a narrower application than a hosted deployment actually serves.
    process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING = '1';
    process.env.BACKUP_S3_BUCKET = process.env.BACKUP_S3_BUCKET || 'route-authorization-spec';

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.createApplicationContext(AppModule, {
      // Builds the module graph, instantiates nothing, runs no lifecycle hook — so no Postgres, no
      // Redis, no credentials. The controller CLASSES (and therefore their metadata) are all this
      // test ever reads.
      preview: true,
      logger: false,
      // Without this a failure inside the graph calls `process.exit(1)` and the run reports nothing.
      abortOnError: false,
    });
    routes = collectRoutes(app.get(ModulesContainer, { strict: false }));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    restoreFlag('WARNING__ENABLE_BILLING_FOR_USERS__WARNING', flagsBefore.billing);
    restoreFlag('BACKUP_S3_BUCKET', flagsBefore.backup);
  });

  it('discovers the whole controller surface', () => {
    // A floor, not a pin: this test is worthless if the graph ever comes back empty or nearly so
    // (a preview-mode change, a renamed metadata key), and it must not need editing every time a
    // route is added.
    expect(routes.length).toBeGreaterThan(150);
  });

  it('declares @Public(), a role, or a scope — never an implicit default', () => {
    const undecided = routes.filter(
      (route) => !declaresAnAuthorizationDecision(route) && !(route.id in NO_SCOPE_IS_CORRECT),
    );
    expect(undecided, report(undecided, NO_SCOPE_IS_CORRECT)).toEqual([]);
  });

  it('gates every state-changing route behind a write scope', () => {
    const writesBehindAReadScope = routes.filter(
      (route) =>
        route.verb !== 'GET' &&
        !route.isPublic &&
        !declaresAWriteScope(route) &&
        !(route.id in NO_SCOPE_IS_CORRECT) &&
        !(route.id in WRITE_WITHOUT_WRITE_SCOPE_IS_CORRECT),
    );
    expect(
      writesBehindAReadScope,
      report(writesBehindAReadScope, WRITE_WITHOUT_WRITE_SCOPE_IS_CORRECT),
    ).toEqual([]);
  });

  it('carries no stale or unnecessary exception', () => {
    const byId = new Map(routes.map((route) => [route.id, route]));

    const gone = [...Object.keys(NO_SCOPE_IS_CORRECT), ...Object.keys(WRITE_WITHOUT_WRITE_SCOPE_IS_CORRECT)]
      .filter((id) => !byId.has(id))
      .map((id) => `${id} — no such route any more; delete the entry.`);

    // An exception that would now pass on its own is worse than none: it hides the fact that the
    // route acquired a real decision, and the next reader trusts the reason instead of the code.
    const unnecessary = Object.keys(NO_SCOPE_IS_CORRECT)
      .filter((id) => byId.has(id) && declaresAnAuthorizationDecision(byId.get(id)!))
      .map((id) => `${id} — now declares a real decision; delete the entry.`)
      .concat(
        Object.keys(WRITE_WITHOUT_WRITE_SCOPE_IS_CORRECT)
          .filter((id) => byId.has(id) && declaresAWriteScope(byId.get(id)!))
          .map((id) => `${id} — now declares a write scope; delete the entry.`),
      );

    expect([...gone, ...unnecessary], `\n  ${[...gone, ...unnecessary].join('\n  ')}\n`).toEqual([]);
  });
});
