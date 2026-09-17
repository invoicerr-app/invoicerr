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
 * auditable, even though (like `ThrottlerModule.forRoot`) they are still per-process, not
 * Redis-shared — sharing them across replicas is the same follow-up
 * `app.module.ts`'s own `ThrottlerModule.forRoot` comment already names for the global limiter, not a
 * gap unique to this file. It is deliberately COARSER than better-auth's own 3-attempts-per-window
 * (when that one IS enabled): the job here is only to bound request volume to something no legitimate
 * user could ever produce, not to duplicate the exact production tuning.
 *
 * Registered via a plain `app.use()` in `main.ts#createApp()` — the same reason `skipBodyParserFor` is:
 * `app.use()` forwards straight to Express immediately, so it runs before
 * `NestApplication.init()` ever wires up better-auth's own middleware, no matter where in `main.ts`'s
 * source text it is registered.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

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

export interface AuthRateLimitOptions {
  rules?: readonly AuthRateLimitRule[];
  /** Injectable clock for deterministic specs — defaults to the real `Date.now`. */
  now?: () => number;
  /** Decides whether the limiter is active at all for the CURRENT process — defaults to "every
   *  environment except NODE_ENV=test". `.env.test` is what the e2e stack boots with deliberately, and
   *  it exercises dozens of sign-ups/sign-ins per run from a single CI runner IP; that is not the
   *  "accidentally-unprotected staging instance" scenario this file exists for (see this file's own
   *  header) — unlike that scenario, `test` is an explicit, self-identifying, controlled environment,
   *  never a misconfiguration. */
  isEnabledByDefault?: (env: NodeJS.ProcessEnv) => boolean;
}

const defaultIsEnabled = (env: NodeJS.ProcessEnv): boolean => env.NODE_ENV !== 'test';

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
  const counters = new Map<string, Counter>();

  return (req: Request, res: Response, next: NextFunction): void => {
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
    // `req.ip` already reflects the real client address by the time this runs — `main.ts` sets
    // `trust proxy: 1` before any middleware in this chain, and that Express setting applies to every
    // access of `req.ip` regardless of registration order.
    const key = `${rule.name}:${req.ip}`;
    const t = now();
    const existing = counters.get(key);
    const counter = existing && existing.resetAt > t ? existing : { count: 0, resetAt: t + rule.windowMs };
    counter.count += 1;
    counters.set(key, counter);

    if (counter.count > rule.max) {
      res.status(429).json({
        message: 'Too many authentication requests. Please try again later.',
        code: 'AUTH_RATE_LIMITED',
      });
      return;
    }

    next();
  };
}
