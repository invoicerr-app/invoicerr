import * as http from 'node:http';

import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

/**
 * Bootstrap for the dedicated document-action queue worker process (ROLE=worker) — TODO.md item 22.
 * Rebuilt on the model of the pre-refonte compliance engine's own worker.ts (git tag
 * `avant-refonte-documents`), adapted to the documents module.
 *
 * No HTTP/Nest server, no migrations (those are API-only — see main.ts's `syncDatabaseSchema()`, run
 * only under `NODE_ENV=production` and only in the `api` role) — just a Nest application CONTEXT (so
 * DI wires up and the `@Processor()` in `DocumentsQueueWorkerModule` starts consuming) plus a minimal
 * health-check HTTP server on port 3001 for container healthchecks (docker-compose.scale.yml's own
 * `worker` service healthcheck targets exactly this port).
 *
 * `NestFactory.createApplicationContext` runs every `OnModuleInit` hook in the graph, INCLUDING
 * `DocumentQueueRedisRequiredGuard` (queue/redis-required.guard.ts) — so an unreachable Redis fails
 * this bootstrap loudly, by name, the exact same way it fails the API process's own boot. The
 * `.catch()` below is what turns that rejection into a clean, logged `process.exit(1)` instead of an
 * unhandled promise rejection.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  await app.init();

  const port = 3001;
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    })
    .listen(port);

  console.log(`[worker] ready — health check listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error('Error during worker bootstrap:', err);
  process.exit(1);
});
