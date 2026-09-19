import * as bodyParser from 'body-parser';
import type { INestApplication, Type } from '@nestjs/common';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { skipBodyParserFor } from './lib/body-parser-auth-skip';
import { createAuthRateLimitMiddleware, createRedisAuthRateLimitCounterStore } from './lib/auth-rate-limit';
import { devOnlyOrigins } from './lib/dev-origins';
import { createLibRedisClient } from './lib/redis-connection';
import { resolveTrustProxyHops } from './lib/trust-proxy';
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
  // Exact hop count matters here: nginx (nginx.conf) proxies to this process over loopback (same
  // container, see entrypoint.sh) and APPENDS its own directly-observed peer address to whatever
  // `X-Forwarded-For` it received (`$proxy_add_x_forwarded_for`, never overwriting it) — so the
  // header grows by exactly one entry per real HTTP-aware hop in front of this container.
  // `trust proxy: <n>` tells Express "trust exactly n hops counting back from nginx's own entry",
  // which is what lets `req.ip` resolve to the actual client instead of always the loopback peer
  // (127.0.0.1) or, with more than one hop in front and this left at a stale `1`, to whichever
  // load balancer/CDN sits closest — the bug named "the client IP collapses behind a second proxy
  // hop": with a load balancer added and this still hardcoded to `1`, EVERY request would appear
  // to come from the balancer, and the global `ThrottlerGuard` (app.module.ts) plus
  // `lib/auth-rate-limit.ts` would each share one instance-wide bucket regardless of who is
  // actually calling.
  //
  // `resolveTrustProxyHops()` (`lib/trust-proxy.ts`) reads this from `TRUST_PROXY_HOPS`, defaulting
  // to `1` — today's only shipped topology (docker-compose.yml, nginx is the sole hop) — so an
  // operator who sets nothing keeps EXACTLY the previous hardcoded behaviour. A self-hosted
  // operator fronting this with their own reverse proxy/CDN, or the Helm chart's own Ingress
  // (`deploy/helm/invoicerr/values.yaml#app.trustProxyHops`, defaults to `2` there), raises this by
  // one per real hop added — see `lib/trust-proxy.ts`'s own header for why the count must be
  // EXACT, never just "big enough".
  app.getHttpAdapter().getInstance().set('trust proxy', resolveTrustProxyHops());
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
  // A Redis-backed counter store, never the default in-process `Map` — three API replicas
  // must share ONE budget per (rule, ip), not one each. See `auth-rate-limit.ts`'s own "COUNTER
  // STORAGE" header section for why this middleware cannot simply reuse `ThrottlerModule.forRoot`'s
  // own Redis storage below (it runs outside Nest's guard pipeline entirely). `createLibRedisClient`
  // opens its own connection rather than sharing one with the throttler's own client — a plain,
  // stateless `ioredis` instance costs nothing extra to open a second time, and keeps this middleware
  // (registered here, as a raw `app.use()`, before Nest's own DI container exists yet) from depending
  // on anything Nest constructs.
  app.use(
    createAuthRateLimitMiddleware(authBasePath, {
      store: createRedisAuthRateLimitCounterStore(createLibRedisClient()),
    }),
  );

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
