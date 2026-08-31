import * as bodyParser from 'body-parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { syncDatabaseSchema } from './prisma/sync-schema';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    try {
      await syncDatabaseSchema();
    } catch (err) {
      console.error('[bootstrap] database sync failed, aborting startup:', err);
      process.exit(1);
    }
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
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
// required to boot at all (TODO.md item 22), never a silently-degraded synchronous fallback. Without
// this `.catch()`, that guard's own named error would surface only as an unhandled promise
// rejection; this turns it into a clean, logged `process.exit(1)` instead — the same treatment
// worker.ts's own bootstrap gets for the exact same failure mode.
bootstrap().catch((err) => {
  console.error('Error during backend bootstrap:', err);
  process.exit(1);
});
