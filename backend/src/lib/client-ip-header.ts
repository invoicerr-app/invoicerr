import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * The single-value header better-auth is configured to trust as the client's address
 * (`lib/auth.ts`'s own `advanced.ipAddress.ipAddressHeaders`). Exported so the header this middleware
 * WRITES and the header better-auth is told to READ cite the same constant rather than two
 * independently-spelled string literals that could silently drift apart.
 */
export const CLIENT_IP_HEADER = 'x-invoicerr-client-ip';

/**
 * Overwrites `CLIENT_IP_HEADER` on every request with Express's own resolved `req.ip` — never appends,
 * never falls back to whatever the client sent under that name.
 *
 * THE DEFECT this fixes, proven live 2026-09-22: better-auth's bundled rate limiter resolves the
 * client address via `getIP()`/`getIPFromHeader()`
 * (`node_modules/@better-auth/core/dist/utils/ip.mjs`), which — with no `trustedProxies` configured —
 * trusts a forwarded-address header ONLY when it carries exactly ONE entry; two or more
 * comma-separated entries make it return `null`, and every rate-limited route
 * (`node_modules/better-auth/dist/api/rate-limiter/index.mjs:239`) then falls back to a single bucket
 * shared by every caller. This app's own in-container nginx (`nginx.conf`) sets
 * `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` — which APPENDS its own directly
 * observed peer address to whatever `X-Forwarded-For` it already received, rather than overwriting it
 * — so that header carries 2+ entries in every real deployment (docker-compose already has a
 * client-set/absent entry plus nginx's own; the Helm chart's Ingress adds a further hop on top).
 * Measured: 150 concurrent `GET /api/auth/get-session` from 150 distinct client addresses produced the
 * exact same 100-served/50-refused split as the same 150 calls from ONE address.
 *
 * THE FIX does not try to teach better-auth to parse `X-Forwarded-For` with `trustedProxies` (that
 * would mean enumerating every operator's own proxy chain a second time, independently of
 * `TRUST_PROXY_HOPS` — see `lib/trust-proxy.ts`). Instead this middleware hands better-auth a
 * dedicated header that is ALWAYS single-valued, carrying the exact address Express itself already
 * resolved via `trust proxy` — the same `req.ip` `lib/auth-rate-limit.ts`'s own limiter already keys
 * on.
 *
 * MUST overwrite unconditionally, never append or merge: this header carries no information from the
 * network path — it exists solely for this process to hand better-auth a conclusion it already
 * reached. If a caller-supplied value were ever preserved (used as a fallback, appended to, or trusted
 * when already present), any client could set `X-Invoicerr-Client-Ip: <anything>` itself and mint a
 * private rate-limit bucket per request, defeating the limiter entirely. Assigning the header key
 * directly on the raw Node request (`req.headers[CLIENT_IP_HEADER] = req.ip`) replaces whatever the
 * client sent under that name outright, before better-auth's own handler — mounted later, as raw
 * Express middleware wired up only once `NestApplication.init()` runs (see `create-app.ts`'s own
 * header) — ever reads it. `better-call`'s Node adapter
 * (`node_modules/better-call/dist/adapters/node/request.mjs`) builds its Web-standard `Request` from
 * this exact same mutable `req.headers` object at request time, so a mutation made here, earlier in
 * the same Express chain, is visible to it.
 *
 * `req.ip` is trustworthy at this point because `create-app.ts` calls `app.set('trust proxy', ...)`
 * before this middleware is registered — and because that is a property on the Express `app` instance
 * rather than a middleware itself, it takes effect for every `req.ip` access from the very first
 * request, regardless of where in the chain this middleware sits (the same reasoning
 * `auth-rate-limit.ts`'s own comment on `req.ip` already relies on).
 */
export function injectClientIpHeaderMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.headers[CLIENT_IP_HEADER] = req.ip;
    next();
  };
}
