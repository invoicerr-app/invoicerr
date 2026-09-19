import * as bodyParser from 'body-parser';
import type { INestApplication, Type } from '@nestjs/common';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { skipBodyParserFor } from './lib/body-parser-auth-skip';
import { createAuthRateLimitMiddleware } from './lib/auth-rate-limit';
import { devOnlyOrigins } from './lib/dev-origins';
import { auth } from './lib/auth';

/**
 * Everything between `NestFactory.create()` and `app.listen()` — split out of `main.ts` (where
 * `bootstrap()` still calls it, unchanged) into its own module for a second reason beyond the
 * original one below: `main.ts` itself ends with a top-level `bootstrap().catch(...)` call — a real
 * side effect that fires the instant the module is `require`d/imported. `src/openapi-dump.ts` needs
 * `createApp()` WITHOUT that side effect (it builds its OWN throwaway app, extracts the Swagger
 * document, and closes it — importing `main.ts` there would ALSO boot a second, real, listening
 * server in the same process, one that never gets torn down because nothing ever calls `app.listen()`
 * on the resulting object to hand back control). Proven the hard way, 2026-09-19: an earlier version
 * of that dump script imported `createApp` straight from `main.ts` and the process never exited —
 * `bootstrap()`'s own server sat there accepting connections and running the BullMQ sweep timers
 * forever, while the dump script's own, separate `app` sat unused.
 *
 * The original reason for the split still applies too: a test can construct the EXACT middleware
 * chain this process wires in production (the body-parser skip logic below included) without going
 * through `bootstrap()`'s own boot guards or calling `app.listen()` itself. `module` defaults to the
 * real `AppModule`.
 *
 * `createApp()` itself is NOT what `main.middleware.spec.ts` calls, though — it imports `auth` from
 * `lib/auth.ts` unconditionally (needed below only to read `auth.options.basePath`), and importing
 * `lib/auth.ts` AT ALL cannot be done under Jest (see `lib/body-parser-auth-skip.ts`'s own header for
 * the full account — `better-auth` itself is ESM-only across nearly every subpath export). The actual
 * skip LOGIC below is what moved out to that file so it CAN be tested directly; this function just
 * wires it up, unchanged, the way production does.
 */
export async function createApp(module: Type<unknown> = AppModule): Promise<INestApplication> {
  const app = await NestFactory.create(module, { bodyParser: false });
  // SECURITY_AUDIT.md finding #1: nginx (nginx.conf) is the only hop in front of this process
  // (same container, proxying over loopback — see entrypoint.sh) and now OVERWRITES
  // X-Forwarded-For with the real client IP it saw ($remote_addr) rather than appending to
  // whatever a client sent. `trust proxy: 1` tells Express "trust exactly one hop" so
  // `req.ip` reads that header instead of always resolving to the loopback peer address
  // (127.0.0.1, since nginx and this process share a container) — otherwise both the global
  // `ThrottlerGuard` (app.module.ts, keys on `req.ip` by default) and better-auth's own
  // request-IP reader end up sharing one instance-wide bucket / a spoofable IP, defeating
  // per-IP rate limiting (e.g. login brute-force). Must be `1`, not `true`: `true` would trust
  // an arbitrary number of forwarded hops, which is exactly the "trust whatever the client
  // claims" bug this fixes.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors({
    credentials: true,
    // `devOnlyOrigins()` is `[]` in production — see that function's own header for the vulnerability
    // an unconditional `http://localhost:5173` entry used to open (any page running on a victim's own
    // localhost:5173 could read/write the API with their session cookies). `lib/auth.ts`'s own
    // `trustedOrigins` makes the identical call for the exact same reason.
    origin: [
      ...devOnlyOrigins(),
      process.env.APP_URL,
      ...(process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || []),
    ].filter(Boolean),
  });
  app.use(cookieParser());
  app.setGlobalPrefix('api');

  // better-auth must read its OWN request body itself: `@thallesp/nestjs-better-auth`'s handler
  // wraps the raw Node request in a Web-standard `Request` (`toNodeHandler`, `better-auth/node`) and
  // downstream code — e.g. better-auth's own sign-in/sign-up/change-email routes — calls
  // `ctx.request.text()` on it. That only works if the request stream hasn't already been consumed by
  // something else.
  // `@thallesp/nestjs-better-auth`'s own `AuthModule.configure()` registers exactly the middleware
  // meant to guarantee that (`SkipBodyParsingMiddleware`, skips its OWN json/urlencoded parsing for
  // `/api/auth/*`) — but `configure()` on every `NestModule` is wired up by
  // `NestApplication.registerModules()`, which only runs inside `NestApplication.init()`
  // (`@nestjs/core/nest-application.js`), and `init()` itself is only ever triggered the first time
  // `app.init()` or `app.listen()` is called. `app.use()`, by contrast — every call in this file,
  // this one included — forwards straight to the underlying Express instance immediately
  // (`NestApplication.use()` → `httpAdapter.use()`). So no matter where in this file a body parser
  // is registered, it lands on Express BEFORE the auth module's own skip middleware, which is only
  // installed once `app.listen()` below starts running `init()`. Reordering doesn't fix this —
  // `app.listen()` has to be the last call in this function either way.
  // Proven live against a real Polar webhook delivery (instance "esteban", 2026-09-15): every
  // `POST /api/auth/polar/webhooks` had its body consumed by `bodyParser.json()` below first, so
  // `@polar-sh/better-auth`'s `ctx.request.text()` read an EMPTY body downstream and
  // `validateEvent()` rejected the correctly-signed webhook with "No matching signature found" — 21
  // consecutive deliveries, identical secret, all 400.
  // `POST /api/auth/polar/webhooks` no longer exists at all as of the same day: `@polar-sh/better-
  // auth`'s own `webhooks()` sub-plugin was removed (its `validateEvent` turned out to ALSO derive the
  // wrong HMAC key for a real delivery — a second, independent bug, layered under this one; see
  // `modules/billing/polar-webhook.controller.ts`'s own header). The real receiver is now `POST
  // /api/billing/webhooks/polar` (`PolarWebhookController`) — deliberately NOT under `/api/auth`, so
  // it reads its own `req.rawBody` straight from the SAME `bodyParser.json({ verify })` below rather
  // than needing this skip at all. This fix stays necessary regardless: every OTHER `/api/auth/*`
  // route (sign-in, sign-up, change-email, …) still reads its own body itself, exactly as described
  // below, and would hit the identical draining bug without it — hosted billing's own checkout/portal
  // moved OFF `/api/auth/*` entirely 2026-09-16 (`billing.controller.ts`'s own header), so they are no
  // longer examples here either, but nothing else about this fix changed.
  // Fix: have our own parsers skip the whole `/api/auth` subtree themselves (`skipBodyParserFor`,
  // `lib/body-parser-auth-skip.ts` — pulled into its own file so it's unit-testable without importing
  // `lib/auth.ts`, see that file's own header), using the SAME test `SkipBodyParsingMiddleware` uses
  // (`req.baseUrl.startsWith(basePath)`) — just early enough that it actually runs before the stream
  // is touched. `authBasePath` is read from `auth.options.basePath` (better-auth defaults it to
  // `/api/auth` — see `better-auth/dist/context/create-context.mjs` — and `lib/auth.ts` never
  // overrides it) rather than hardcoded, so if that option is ever set explicitly this stays correct
  // instead of silently reopening the bug. Note the global prefix set just above
  // (`setGlobalPrefix('api')`) does NOT rewrite the request Express sees — it only affects how Nest
  // matches CONTROLLER routes later — so at this root-level `app.use()`, `req.path` is exactly what
  // the client sent, `/api` included, and comparing it straight against `authBasePath` (which already
  // contains that `/api`) is correct without adding the prefix a second time.
  // Cast: `auth.options` is typed from the EXACT literal `lib/auth.ts` passes to `betterAuth()`,
  // which never sets `basePath` — so the property is absent from that literal's inferred type even
  // though better-auth itself (and `@thallesp/nestjs-better-auth`'s own `AuthModule`, reading this
  // same field) happily accepts it being undefined and defaults it. Reading it as optional here
  // matches both of THEIR own runtime behaviors, not just this file's.
  const configuredBasePath = (auth.options as { basePath?: string }).basePath;
  const authBasePath = configuredBasePath ?? '/api/auth';

  // `/api/auth/*` is mounted as raw Express middleware (see the comment block above) and therefore
  // never reaches the Nest router — none of the three global `APP_GUARD`s registered in
  // `app.module.ts`, `ThrottlerGuard` included, ever runs for a sign-in/sign-up/password-reset/OTP
  // request. Registered here, via `app.use()`, for the exact same reason `skipBodyParserFor` below is:
  // it forwards straight to Express, so it runs before `NestApplication.init()` ever wires up
  // better-auth's own middleware — see `lib/auth-rate-limit.ts`'s own header for the full account of
  // what this closes and why it does not merely duplicate better-auth's own internal limiter.
  app.use(createAuthRateLimitMiddleware(authBasePath));

  app.use(
    skipBodyParserFor(
      authBasePath,
      bodyParser.json({
        limit: '1mb',
        // Capture the raw body buffer so webhook HMAC verification can operate on the
        // original bytes (re-serialising a parsed JSON object is unreliable for HMAC).
        verify: (req, _res, buf) => {
          (req as any).rawBody = buf;
        },
      }),
    ),
  );
  // Mollie's webhook (`payments/providers/mollie/mollie-provider.ts`) is the one inbound request this
  // backend accepts as `application/x-www-form-urlencoded` (`id=tr_xxx`, nothing else) —
  // `bodyParser.json` above only ever parses `application/json` and silently skips anything else, so
  // without this, `req.rawBody` would never be set for it and `PaymentsWebhookController` would 400
  // on "Missing request body." before the provider ever got a chance to re-fetch and verify. Same
  // `verify` capture as the JSON parser, for the same reason (Mollie's own body is trivial — an id,
  // never HMAC'd — but the OFFICIAL verification is an authenticated re-fetch, not a body signature,
  // so nothing here needs the raw bytes for cryptographic comparison; captured anyway for parity and
  // because `req.body.id` alone, post-parse, is exactly as sufficient and this keeps both webhook
  // paths shaped the same way).
  app.use(
    skipBodyParserFor(
      authBasePath,
      bodyParser.urlencoded({
        extended: false,
        limit: '64kb',
        verify: (req, _res, buf) => {
          (req as any).rawBody = buf;
        },
      }),
    ),
  );
  app.use((_req, res, next) => {
    res.header('Access-Control-Expose-Headers', 'WWW-Authenticate');
    next();
  });

  return app;
}
