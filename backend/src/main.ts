import { SwaggerModule } from '@nestjs/swagger';

import { syncDatabaseSchema } from './prisma/sync-schema';
import { assertSecretsConfiguredForBoot } from './lib/secret-guard';
import { assertPolarEnvConfiguredForBoot } from './modules/billing/polar-env';
import { createSwaggerBasicAuthMiddleware } from './lib/swagger-basic-auth';
import { buildSwaggerDocument } from './swagger-document';
import { createApp } from './create-app';

async function bootstrap() {
  // Refuse to boot on a known-placeholder or empty auth secret: docker-compose.yml's example
  // `JWT_SECRET`/`BETTER_AUTH_SECRET` values are public and committed, so a copy-pasted, unmodified
  // compose file would otherwise boot silently with a session/cookie-signing secret anyone can read
  // on GitHub — a full authentication bypass (forge a valid session for any user, no password
  // needed). Must run before anything else touches `lib/auth.ts` — see secret-guard.ts's own header
  // for why this is gated to production only.
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

  // `SwaggerModule.setup()` below mounts straight onto Express, bypassing every Nest `APP_GUARD` — see
  // `lib/swagger-basic-auth.ts`'s own header. Outside production this stays exactly as open as before
  // (a local/staging developer exploring their own instance); IN production it is skipped entirely
  // unless BOTH `SWAGGER_BASIC_AUTH_USER`/`SWAGGER_BASIC_AUTH_PASSWORD` are set, in which case it is
  // mounted but gated behind HTTP Basic Auth for every `/api/docs*` path.
  const swaggerBasicAuthUser = process.env.SWAGGER_BASIC_AUTH_USER;
  const swaggerBasicAuthPassword = process.env.SWAGGER_BASIC_AUTH_PASSWORD;
  const swaggerBasicAuthConfigured = !!swaggerBasicAuthUser && !!swaggerBasicAuthPassword;
  const swaggerEnabled = process.env.NODE_ENV !== 'production' || swaggerBasicAuthConfigured;

  if (swaggerEnabled) {
    if (swaggerBasicAuthConfigured) {
      app.use(createSwaggerBasicAuthMiddleware(swaggerBasicAuthUser!, swaggerBasicAuthPassword!));
    }

    SwaggerModule.setup('api/docs', app, buildSwaggerDocument(app));
  }

  await app.listen(process.env.PORT || 3000);
}
// `NestFactory.create()` (inside `createApp()`, `./create-app.ts`) runs every `OnModuleInit` hook in
// the graph, including `DocumentQueueRedisRequiredGuard`
// (modules/documents/queue/redis-required.guard.ts) — Redis is required to boot at all, never a
// silently-degraded synchronous fallback. Without this `.catch()`, that guard's own named error would
// surface only as an unhandled promise rejection; this turns it into a clean, logged `process.exit(1)`
// instead — the same treatment worker.ts's own bootstrap gets for the exact same failure mode.
//
// This is the ONE line in this file with a real side effect on mere import — a real server, bound and
// listening — which is exactly why nothing that only needs `createApp()` (like `src/openapi-dump.ts`)
// ever imports it from here: `./create-app` carries the function alone, with no such side effect. See
// that file's own header for the incident that made this distinction matter.
bootstrap().catch((err) => {
  console.error('Error during backend bootstrap:', err);
  process.exit(1);
});
