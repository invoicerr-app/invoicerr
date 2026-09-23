/**
 * Builds the exact OpenAPI document a running instance serves at `/api/docs-json` (Swagger UI at
 * `/api/docs`) — pulled out of `main.ts` so `openapi-dump.ts` (which boots the same app via
 * `createApp()` but never calls `app.listen()`) builds the IDENTICAL document from the IDENTICAL
 * `DocumentBuilder` config, rather than a second, hand-maintained copy that could silently drift from
 * what a live instance actually answers with. `documentation/`'s own build copies that dump's output
 * into its own gitignored `static` directory as `openapi.json` (`.github/workflows/docs-deploy.yml`)
 * so the public docs site always ships the spec for whatever backend commit produced it, even though
 * Swagger itself is disabled by default in production (`main.ts`'s own `swaggerEnabled` gate) — see
 * `api-reference.md`.
 */
import type { INestApplication } from '@nestjs/common';

import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { readBackendPackageJsonVersion } from '@/lib/app-version';

export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  // Resolve relative to this file, not cwd: entrypoint.sh `cd`s into backend/src before starting
  // node, but package.json only ever lives at the backend root — see `lib/app-version.ts`'s own
  // header for the twin-path lookup this now shares with `modules/version/`'s update check instead
  // of duplicating it a second time.
  const version = readBackendPackageJsonVersion();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Invoicerr API')
    .setDescription(
      'Authenticate with an API key (Settings > API Keys) via the Authorization: Bearer header or the X-Api-Key header.',
    )
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key' }, 'apiKey')
    .build();

  return SwaggerModule.createDocument(app, swaggerConfig);
}
