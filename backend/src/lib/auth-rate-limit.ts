/**
 * A SECOND, independent rate limiter in front of the sensitive `/api/auth/*` routes (credentials
 * sign-in/sign-up, password reset, OTP/email-verification sends) — because none of the three global
 * `APP_GUARD`s registered in `app.module.ts` (`AuthGuard`, `RolesGuard`, and — the relevant one here —
 * `ThrottlerGuard`) ever run for them. `@thallesp/nestjs-better-auth`'s `AuthModule` mounts better-auth
 * as raw Express middleware (`consumer.apply(...).forRoutes(this.basePath)`, wired up inside
 * `NestApplication.init()` — see `main.ts`'s own comment on `skipBodyParserFor`'s call site for the
 * exact mechanism), and a middleware answers the request BEFORE it ever reaches the Nest router, which
 * is the only place an `APP_GUARD` gets a chance to run at all.
 *
 * What DOES protect these routes today is better-auth's own internal limiter
 * (`node_modules/better-auth/dist/api/rate-limiter/index.mjs`) — but it is `enabled: options.rateLimit
 * ?.enabled ?? isProduction`, so it is OFF by default the instant `NODE_ENV` is not exactly
 * `"production"` (unset, misspelled, "staging" — the identical blind spot `lib/secret-guard.ts`'s own
 * header describes for finding #3), and its counters live in one process's memory only, same as
 * `ThrottlerModule.forRoot` here. `getDefaultSpecialRules()` in that file is where the two rule groups
 * mirrored below (`AUTH_RATE_LIMIT_RULES`) come from — this is not a guess at what "sign-in, sign-up,
 * forgot/reset, OTP" cover, it is the exact same path list.
 *
 * This middleware is a FLOOR under that, always active regardless of `NODE_ENV` (with one deliberate,
 * named exception — see `isEnabledByDefault` below) and with counters that are at least explicit and
 * auditable. It is deliberately COARSER than better-auth's own 3-attempts-per-window (when that one IS
 * enabled): the job here is only to bound request volume to something no legitimate user could ever
 * produce, not to duplicate the exact production tuning.
 *
 * Registered via a plain `app.use()` in `main.ts#createApp()` — the same reason `skipBodyParserFor` is:
 * `app.use()` forwards straight to Express immediately, so it runs before
 * `NestApplication.init()` ever wires up better-auth's own middleware, no matter where in `main.ts`'s
 * source text it is registered.
 *
 * COUNTER STORAGE: where a hit count actually lives is now pluggable
 * (`AuthRateLimitOptions#store`, `AuthRateLimitCounterStore` below), not a bare `Map` closed over by
 * this function. `createInMemoryCounterStore` — this file's own default when no `store` is given —
 * keeps that original per-process `Map`, which is exactly right for a spec (or an embedder with no
 * replicas) and exactly wrong for three API replicas behind a load balancer: each would keep its own
 * count, so a limit configured as "30 per minute" becomes "30 per minute PER REPLICA" with no error
 * anywhere. `create-app.ts` wires the Redis-backed store instead
 * (`createRedisAuthRateLimitCounterStore`, below) — the SAME cross-replica fix
 * `ThrottlerModule.forRoot`'s own storage option gets in `app.module.ts`, applied here because this
 * middleware runs OUTSIDE Nest's guard pipeline entirely (see above) and therefore cannot reuse that
 * module's own `ThrottlerStorage` token.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { Logger } from '@nestjs/common';

import { isUnderBasePath, normalizeBasePath } from './body-parser-auth-skip';

export interface AuthRateLimitRule {
  name: string;
  /** Matched against the sub-path AFTER `basePath` is stripped (e.g. `/sign-in/email`), exactly like
   *  better-auth's own `pathMatcher`s. */
  pathMatcher: (subPath: string) => boolean;
  windowMs: number;
  max: number;
}

/** Mirrors better-auth's own `getDefaultSpecialRules()` path groups exactly (see this file's own
 *  header) — deliberately generous limits: this is a floor independent of `NODE_ENV`/storage, not a
 *  replacement for that library's own, tighter production defaults. */
export const AUTH_RATE_LIMIT_RULES: readonly AuthRateLimitRule[] = [
  {
    name: 'credentials',
    pathMatcher: (subPath) =>
      subPath.startsWith('/sign-in') ||
      subPath.startsWith('/sign-up') ||
      subPath.startsWith('/change-password'),
    windowMs: 60_000,
    max: 30,
  },
  {
    name: 'password-reset-and-otp',
    pathMatcher: (subPath) =>
      subPath === '/request-password-reset' ||
      subPath.startsWith('/forget-password') ||
      subPath.startsWith('/reset-password') ||
      subPath.includes('otp') ||
      subPath === '/send-verification-email',
    windowMs: 60_000,
    max: 15,
  },
];

interface Counter {
  count: number;
  resetAt: number;
}

/** Where hit counts for this middleware actually live — see this file's own header ("COUNTER
 *  STORAGE") for why this exists as a seam rather than a bare `Map`. */
export interface AuthRateLimitCounterStore {
  /** Increments the counter for `key` and returns the count AFTER this hit. Must apply the SAME
   *  fixed-window semantics the original in-process `Map` always had: a window starts on the first
   *  hit for a fresh key and expires exactly `windowMs` after THAT hit, never renewed by later hits
   *  arriving mid-window (otherwise a fast-enough caller could keep a window alive forever). */
  increment(key: string, windowMs: number): Promise<number>;
}

/** The original per-process bookkeeping, kept as the default store: correct for a spec, or for any
 *  embedder that genuinely never runs more than one instance of this middleware. `now` is the same
 *  injectable clock `AuthRateLimitOptions#now` already exposed — threaded through here rather than
 *  read from `Date.now()` directly so existing deterministic specs (advancing a fake clock) keep
 *  working unchanged now that storage is a separate seam. */
function createInMemoryCounterStore(now: () => number): AuthRateLimitCounterStore {
  const counters = new Map<string, Counter>();
  return {
    async increment(key, windowMs) {
      const t = now();
      const existing = counters.get(key);
      const counter = existing && existing.resetAt > t ? existing : { count: 0, resetAt: t + windowMs };
      counter.count += 1;
      counters.set(key, counter);
      return counter.count;
    },
  };
}

/** The exact subset of `ioredis`'s own API `createRedisAuthRateLimitCounterStore` calls — never the
 *  whole client — so a spec never has to fake anything beyond `eval`, the same "minimal interface"
 *  discipline `lib/pending-signup-store.ts`'s own `PendingSignupRedisClient` already holds. */
export interface EvalCapableRedisClient {
  eval(script: string, numKeys: number, key: string, arg: string): Promise<unknown>;
}

/**
 * `INCR` always runs; `PEXPIRE` runs ONLY when this hit is the first in a fresh window
 * (`count == 1`) — one atomic round trip via `EVAL`, so a request arriving mid-window can never push
 * the window's own expiry back out (the identical fixed-window semantics
 * `createInMemoryCounterStore` above already had: `resetAt` computed once, not renewed per hit).
 * Plain `INCR` followed by a SEPARATE `PEXPIRE` would leave a real gap instead: a process that
 * crashes between the two calls leaves a key with NO expiry at all — a counter permanently stuck at
 * whatever count it last reached, a self-inflicted lockout for that ip+rule that never recovers on
 * its own.
 */
const INCREMENT_AND_EXPIRE_ONCE_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

/** Cross-replica counter store — what `create-app.ts` actually wires in production. Every API
 *  replica sharing the SAME Redis key per (rule, ip) is the whole fix: a limit configured as "30 per
 *  minute" stays 30 per minute cluster-wide, not 30 per minute per replica. */
export function createRedisAuthRateLimitCounterStore(
  client: EvalCapableRedisClient,
): AuthRateLimitCounterStore {
  return {
    async increment(key, windowMs) {
      const count = await client.eval(INCREMENT_AND_EXPIRE_ONCE_SCRIPT, 1, key, String(windowMs));
      return Number(count);
    },
  };
}

export interface AuthRateLimitOptions {
  rules?: readonly AuthRateLimitRule[];
  /** Injectable clock for deterministic specs — defaults to the real `Date.now`. Only used by the
   *  DEFAULT in-memory store; ignored once a `store` is supplied (a Redis-backed store has no use for
   *  a fake clock — its expiry is Redis's own `PEXPIRE`). */
  now?: () => number;
  /** Decides whether the limiter is active at all for the CURRENT process — defaults to "every
   *  environment except NODE_ENV=test". `.env.test` is what the e2e stack boots with deliberately, and
   *  it exercises dozens of sign-ups/sign-ins per run from a single CI runner IP; that is not the
   *  "accidentally-unprotected staging instance" scenario this file exists for (see this file's own
   *  header) — unlike that scenario, `test` is an explicit, self-identifying, controlled environment,
   *  never a misconfiguration. */
  isEnabledByDefault?: (env: NodeJS.ProcessEnv) => boolean;
  /** Where hit counts live — defaults to a fresh, per-process in-memory store (see this file's own
   *  header). `create-app.ts` passes `createRedisAuthRateLimitCounterStore(...)` explicitly; a spec
   *  can pass any fake implementing the three-line interface to prove cross-instance behaviour without
   *  a real Redis (see `auth-rate-limit.spec.ts`'s own "shared across replicas" cases). */
  store?: AuthRateLimitCounterStore;
}

const defaultIsEnabled = (env: NodeJS.ProcessEnv): boolean => env.NODE_ENV !== 'test';

const logger = new Logger('AuthRateLimit');

/**
 * Builds the Express middleware. `basePath` is `auth.options.basePath ?? '/api/auth'` at the real call
 * site in `main.ts` — passed in, never imported from `lib/auth.ts` here, so this file (like
 * `body-parser-auth-skip.ts`) has zero dependency on `better-auth` and can be unit-tested directly.
 */
export function createAuthRateLimitMiddleware(
  basePath: string,
  options: AuthRateLimitOptions = {},
): RequestHandler {
  const normalizedBasePath = normalizeBasePath(basePath);
  const rules = options.rules ?? AUTH_RATE_LIMIT_RULES;
  const now = options.now ?? (() => Date.now());
  const isEnabled = options.isEnabledByDefault ?? defaultIsEnabled;
  const store = options.store ?? createInMemoryCounterStore(now);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isEnabled(process.env) || req.method !== 'POST' || !isUnderBasePath(req, normalizedBasePath)) {
      next();
      return;
    }

    const subPath = req.path.slice(normalizedBasePath.length) || '/';
    const rule = rules.find((candidate) => candidate.pathMatcher(subPath));
    if (!rule) {
      next();
      return;
    }

    // Keyed on IP + rule name, never on the sub-path alone: `/sign-in` and `/sign-up` share one budget
    // (better-auth's own grouping), so an attacker cannot dodge the limit by alternating between them.
    // `req.ip` already reflects the real client address by the time this runs — `create-app.ts` sets
    // `trust proxy` (see `lib/trust-proxy.ts`) before any middleware in this chain, and that Express
    // setting applies to every access of `req.ip` regardless of registration order.
    const key = `${rule.name}:${req.ip}`;

    let count: number;
    try {
      count = await store.increment(key, rule.windowMs);
    } catch (error) {
      // Fail OPEN, not closed: this middleware is a FLOOR under better-auth's own limiter (see this
      // file's own header), never the only thing standing between the app and abuse — a transient
      // Redis hiccup must not turn every sign-in/sign-up request into a hang or a 500. Redis is
      // already a hard boot dependency for the rest of this app (BullMQ, `redis-required.guard.ts`),
      // so an outage here is already visible elsewhere; this floor simply steps aside for its
      // duration instead of compounding that outage for the one path that MUST keep authenticating
      // users through it.
      logger.warn(
        `Auth rate limit store unavailable, allowing the request through: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      next();
      return;
    }

    if (count > rule.max) {
      res.status(429).json({
        message: 'Too many authentication requests. Please try again later.',
        code: 'AUTH_RATE_LIMITED',
      });
      return;
    }

    next();
  };
}
