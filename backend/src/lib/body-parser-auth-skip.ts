import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Skips a body parser for the whole `/api/auth` subtree — pulled out of `main.ts` into its own file
 * specifically so it can be unit- and integration-tested WITHOUT importing `lib/auth.ts` (which
 * `main.ts` itself needs, for the real `auth.options.basePath` this logic is keyed on in production).
 * Importing `lib/auth.ts` at all — `main.ts` included, transitively — needs `@polar-sh/better-auth`
 * mocked away under Jest (see `polar-plugin.spec.ts`'s own header) AND, established while writing
 * `main.middleware.spec.ts`, hits a second, more fundamental wall even past that: `better-auth`'s own
 * package.json declares almost every subpath export (`/node`, `/api`, `/plugins`,
 * `/adapters/prisma`, …) with ONLY a `"default"` condition pointing at an `.mjs` file — no `"require"`
 * condition, no CJS build at all. Real Node (this repo's runtime, v22+) transparently `require()`s
 * ESM like that and `lib/auth.ts` boots fine; Jest's own CJS module loader cannot load it at all
 * ("Cannot use import statement outside a module") — the same class of wall
 * `polar-plugin.spec.ts` already documents for `@polar-sh/checkout/embed`, just one dependency layer
 * further down, and unavoidable by mocking a single package this time (it's `better-auth` itself,
 * which `lib/auth.ts` cannot function without). This is the real reason no spec in this codebase
 * imports `lib/auth.ts` — Polar was only ever the first place that got written down.
 *
 * `main.ts`'s own header/comments carry the FULL story of the bug this logic fixes (the ordering
 * of `app.use()` vs. `NestApplication.init()`'s own middleware registration) — this file is
 * deliberately just the pure, auth-library-independent PREDICATE + WRAPPER, so it stays true
 * regardless of which auth library ever sits behind `/api/auth`.
 */

/** Trailing slashes collapsed, never empty (`''` reads as the root `'/'`) — mirrors
 *  `@nestjs/common`'s own `normalizePath` (`shared.utils.js`, used internally by
 *  `@thallesp/nestjs-better-auth`'s `AuthModule` for this exact same computation) closely enough for
 *  this purpose without importing that internal, unexported utility. */
export function normalizeBasePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

/** True for the base path itself and everything under it (`/api/auth` and `/api/auth/polar/…`), never
 *  a mere prefix match (`/api/authorize` must NOT match `/api/auth`). `basePath` is assumed already
 *  normalized (`normalizeBasePath`) — callers that build a `RequestHandler` via `skipBodyParserFor`
 *  below get that for free. */
export function isUnderBasePath(req: Pick<Request, 'path'>, basePath: string): boolean {
  return req.path === basePath || req.path.startsWith(`${basePath}/`);
}

/**
 * Wraps `parser` so it never runs for a request under `basePath` — `next()` is called directly
 * instead, leaving the request stream completely untouched for whatever is mounted there to read it
 * itself. Registering the RETURNED handler via a plain `app.use()` — same as `main.ts` does, no
 * different from registering `parser` directly — is what makes this take effect BEFORE anything a
 * `NestModule#configure()` registers, however late in the source text it appears: see `main.ts`'s own
 * comment at the call site for why that ordering is the entire fix.
 */
export function skipBodyParserFor(basePath: string, parser: RequestHandler): RequestHandler {
  const normalized = normalizeBasePath(basePath);
  return (req: Request, res: Response, next: NextFunction) =>
    isUnderBasePath(req, normalized) ? next() : parser(req, res, next);
}
