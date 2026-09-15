import * as bodyParser from 'body-parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { syncDatabaseSchema } from './prisma/sync-schema';
import { assertSecretsConfiguredForBoot } from './lib/secret-guard';
import { assertPolarEnvConfiguredForBoot } from './modules/billing/polar-env';

async function bootstrap() {
  // SECURITY_AUDIT.md finding #3: refuse to boot on a known-placeholder or empty auth secret
  // (docker-compose.yml's example `JWT_SECRET`/`BETTER_AUTH_SECRET` values are public). Must run
  // before anything else touches `lib/auth.ts` — see secret-guard.ts's own header for why this is
  // gated to production only.
  assertSecretsConfiguredForBoot();
  // Hosted billing (product decision 2026-09-15): refuse to boot with
  // `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` set but no real Polar credentials — a no-op when the
  // flag is unset, see that function's own header for why the gate lives inside it rather than here.
  // `lib/auth.ts`'s own module-scope `betterAuth({ plugins: [...buildPolarAuthPlugins()] })` call has
  // ALREADY run by this point (the `import { AppModule } ...` above already pulled it in) — but that
  // construction never throws on a missing credential itself (`@polar-sh/better-auth`'s own
  // `checkout`/`portal`/`webhooks` sub-plugins only read `options.client`/`secret` LAZILY, inside each
  // route's own request handler), so without this explicit call the process would boot "successfully"
  // and only fail, opaquely, on the FIRST real checkout/webhook request. This turns that into a clean,
  // named, immediate refusal instead — before `app.listen()` ever runs.
  assertPolarEnvConfiguredForBoot();

  if (process.env.NODE_ENV === 'production') {
    try {
      await syncDatabaseSchema();
    } catch (err) {
      console.error('[bootstrap] database sync failed, aborting startup:', err);
      process.exit(1);
    }
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
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
  app.use(
    bodyParser.json({
      limit: '1mb',
      // Capture the raw body buffer so webhook HMAC verification can operate on the
      // original bytes (re-serialising a parsed JSON object is unreliable for HMAC).
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  app.use(
    // Mollie's webhook (`payments/providers/mollie/mollie-provider.ts`) is the one inbound request
    // this backend accepts as `application/x-www-form-urlencoded` (`id=tr_xxx`, nothing else) —
    // `bodyParser.json` above only ever parses `application/json` and silently skips anything else, so
    // without this, `req.rawBody` would never be set for it and `PaymentsWebhookController` would 400
    // on "Missing request body." before the provider ever got a chance to re-fetch and verify. Same
    // `verify` capture as the JSON parser, for the same reason (Mollie's own body is trivial — an id,
    // never HMAC'd — but the OFFICIAL verification is an authenticated re-fetch, not a body signature,
    // so nothing here needs the raw bytes for cryptographic comparison; captured anyway for parity and
    // because `req.body.id` alone, post-parse, is exactly as sufficient and this keeps both webhook
    // paths shaped the same way).
    bodyParser.urlencoded({
      extended: false,
      limit: '64kb',
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  app.use((_req, res, next) => {
    res.header('Access-Control-Expose-Headers', 'WWW-Authenticate');
    next();
  });

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
