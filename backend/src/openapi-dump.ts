/**
 * Writes the exact OpenAPI document `/api/docs-json` serves on a running instance to a JSON file,
 * without ever calling `app.listen()` — `documentation/`'s own build (`.github/workflows/
 * docs-deploy.yml`) copies that file into its own gitignored `static` directory as `openapi.json` so
 * the public docs site always ships a spec, even though Swagger itself is gated off by default in
 * production (`main.ts`'s own `swaggerEnabled`) — see `api-reference.md`.
 *
 * Lives under `src/`, not `scripts/` (unlike `sync-legal-docs.ts` or `release-catalogs.ts`), and is
 * run through `npm run build` first — deliberately, not via `ts-node`/`tsx` directly. Two things this
 * file needs only come from a REAL `tsc` compile (`nest build`, the same one production ships):
 *  1. NestJS constructor injection here relies on TypeScript's `emitDecoratorMetadata` to resolve a
 *     param typed only as a class (no explicit `@Inject()` token) — `tsc` emits that; esbuild-based
 *     runners (`tsx`, ts-node's transpile-only mode) do not, and silently produce an
 *     `UndefinedDependencyException` for the first such provider `AppModule` happens to construct
 *     (proved against `SignaturesService` in this repo, 2026-09-19).
 *  2. The generated Prisma client (`prisma/generated/prisma/client.ts`) is itself NodeNext-style
 *     TypeScript that internally does `require('./internal/class.js')` — a real compile emits the
 *     `.js` sibling that resolves against; a raw `ts-node -r tsconfig-paths/register` run (no full
 *     compile) fails with `MODULE_NOT_FOUND` because no such file exists as source.
 * `nest build`'s own path-alias rewriting (`@/...` → real relative `require`s in `dist/`) is what
 * `catalogs:release`/`sync-legal-docs.ts` don't need — neither boots the Nest DI container at all,
 * which is also why `tsx` (no decorator metadata, but also no DI to resolve) works fine for those.
 *
 * `createApp` below is imported from `./create-app`, never from `./main` — `main.ts` ends with a
 * top-level `bootstrap().catch(...)` that boots a REAL, listening server the instant that module is
 * imported at all; see `create-app.ts`'s own header for the incident that made this its own file.
 *
 * Run from `backend/`:
 *   npm run openapi:dump [output-path]   # builds, then writes to this project's own openapi.json
 *                                         # (gitignored — see backend/.gitignore) by default
 *
 * Needs a REACHABLE Postgres and Redis, exactly like starting the real server does: `createApp()`
 * calls `NestFactory.create(AppModule)`, which runs every module's `onModuleInit` as part of
 * constructing the app — `DocumentQueueRedisRequiredGuard` (queue/redis-required.guard.ts) included,
 * which throws if Redis is unreachable, and Prisma's own first query would fail the same way against
 * an unreachable Postgres. There is no lighter-weight way to get Nest to walk every controller and
 * produce this document — building the document IS booting the app. `DATABASE_URL`/`REDIS_URL` (or
 * `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) must already be set, the same env this repo's other CI
 * jobs that boot the backend already provision (see `queue-integration` in `.github/workflows/
 * cypress.yml`) — this script does not start or manage either service itself.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createApp } from './create-app';
import { buildSwaggerDocument } from './swagger-document';

async function main() {
  const outPath = resolve(process.argv[2] ?? resolve(__dirname, '..', '..', 'openapi.json'));

  const app = await createApp();
  try {
    const document = buildSwaggerDocument(app);
    writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`openapi-dump: wrote ${outPath} (${Object.keys(document.paths ?? {}).length} paths)`);
  } finally {
    // `app.close()` runs every module's `onModuleDestroy`/`beforeApplicationShutdown` — closing the
    // Prisma pool and the BullMQ/Redis connections `createApp()` opened, so this process can actually
    // exit instead of hanging on those open handles (the same reason the queue-integration CI job's
    // own jest run needs `--forceExit`).
    await app.close();
  }
  // Belt-and-braces on top of `app.close()`: `DocumentQueueDispatcher` registers REPEATABLE BullMQ
  // jobs at boot (document-schedule, document-conformity, currency-rate, dunning-reminder,
  // PDP-reception sweeps), each an ioredis connection with its own reconnect timers — `app.close()`
  // tears down the ones Nest tracks as providers, but a one-shot CLI dump has no reason to wait out
  // whatever is left. Proven necessary, not defensive: an earlier version of this script (before it
  // called `process.exit`) sat alive for minutes after logging the line above, running scheduled
  // sweeps against the dump's own throwaway database until something external killed it.
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('openapi-dump: failed —', err);
  process.exit(1);
});
