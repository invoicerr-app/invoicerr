import * as http from 'node:http';

import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

/**
 * Bootstrap for the dedicated compliance worker process (ROLE=worker).
 *
 * No HTTP/Nest server, no `syncDatabaseSchema()` (migrations are API-only, run by main.ts) —
 * just a Nest application context (so DI + BullMQ `@Processor()` workers start consuming)
 * plus a minimal health-check HTTP server on port 3001 for container healthchecks.
 * See QUEUE_IMPL_PLAN.md §4.7 / §7.
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
