import * as bodyParser from 'body-parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication, Type } from '@nestjs/common';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { syncDatabaseSchema } from './prisma/sync-schema';
import { assertSecretsConfiguredForBoot } from './lib/secret-guard';
import { assertPolarEnvConfiguredForBoot } from './modules/billing/polar-env';
import { skipBodyParserFor } from './lib/body-parser-auth-skip';
import { auth } from './lib/auth';

/**
 * Everything between `NestFactory.create()` and `app.listen()` — split out from `bootstrap()` so a
 * test can construct the EXACT middleware chain this process wires in production (the body-parser
 * skip logic below included) without going through `bootstrap()`'s own boot guards or calling
 * `app.listen()` itself. `module` defaults to the real `AppModule`.
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
    origin: [
      'http://localhost:5173',
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

async function bootstrap() {
  // SECURITY_AUDIT.md finding #3: refuse to boot on a known-placeholder or empty auth secret
  // (docker-compose.yml's example `JWT_SECRET`/`BETTER_AUTH_SECRET` values are public). Must run
  // before anything else touches `lib/auth.ts` — see secret-guard.ts's own header for why this is
  // gated to production only.
  assertSecretsConfiguredForBoot();
  // Hosted billing (product decision 2026-09-15): refuse to boot with
  // `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` set but no real Polar credentials — a no-op when the
  // flag is unset, see that function's own header for why the gate lives inside it rather than here.
  // `billing/polar-client.ts`'s own `getPolarClient()` (checkout, portal, seat-sync, the webhook
  // receiver's dispatch path) never validates `POLAR_ACCESS_TOKEN` eagerly either — it only reads
  // `process.env` the first time something actually calls it, LAZILY, inside that request's own
  // handler — so without this explicit call the process would boot "successfully" and only fail,
  // opaquely, on the FIRST real checkout/webhook request. This turns that into a clean, named,
  // immediate refusal instead — before `app.listen()` ever runs.
  assertPolarEnvConfiguredForBoot();

  if (process.env.NODE_ENV === 'production') {
    try {
      await syncDatabaseSchema();
    } catch (err) {
      console.error('[bootstrap] database sync failed, aborting startup:', err);
      process.exit(1);
    }
  }

  const app = await createApp();

  // Resolve relative to this file, not cwd: entrypoint.sh `cd`s into
  // backend/src before starting node, but package.json only ever lives at
  // the backend root. With tsc output at dist/src/, __dirname can be
  // either src/ (ts-node) or dist/src/ (compiled), so try both depths.
  const { version } = JSON.parse(
    readFileSync(
      [join(__dirname, '..', '..', 'package.json'), join(__dirname, '..', 'package.json')]
        .find(existsSync)!
        .replace(/\\/g, '/'),
      'utf-8',
    ),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Invoicerr API')
    .setDescription(
      'Authenticate with an API key (Settings > API Keys) via the Authorization: Bearer header or the X-Api-Key header.',
    )
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key' }, 'apiKey')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  await app.listen(process.env.PORT || 3000);
}
// `NestFactory.create()` above runs every `OnModuleInit` hook in the graph, including
// `DocumentQueueRedisRequiredGuard` (modules/documents/queue/redis-required.guard.ts) — Redis is
// required to boot at all, never a silently-degraded synchronous fallback. Without
// this `.catch()`, that guard's own named error would surface only as an unhandled promise
// rejection; this turns it into a clean, logged `process.exit(1)` instead — the same treatment
// worker.ts's own bootstrap gets for the exact same failure mode.
bootstrap().catch((err) => {
  console.error('Error during backend bootstrap:', err);
  process.exit(1);
});
