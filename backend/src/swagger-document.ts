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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';

import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  // Resolve relative to this file, not cwd: entrypoint.sh `cd`s into backend/src before starting
  // node, but package.json only ever lives at the backend root. With tsc output at dist/src/,
  // __dirname can be either src/ (ts-node) or dist/src/ (compiled), so try both depths.
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

  return SwaggerModule.createDocument(app, swaggerConfig);
}
