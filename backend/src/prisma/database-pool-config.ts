/**
 * Explicit `pg.Pool` sizing/timeout for the ONE process-wide Prisma client (`prisma.service.ts`) —
 * split into its own file so the parsing/validation is unit-testable without booting a real Postgres
 * connection (constructing `PrismaPg`/`pg.Pool` at import time is exactly why `prisma.service.ts`
 * itself has never had a spec of its own).
 *
 * ## Why this needs to exist at all
 * `@prisma/adapter-pg`'s `PrismaPg` is a thin wrapper over `pg.Pool` — construct it from a bare
 * connection string (as `prisma.service.ts` used to) and pg's OWN defaults apply silently: `max: 10`
 * (`pg-pool`'s own constructor, `this.options.max = this.options.max || this.options.poolSize || 10`)
 * and no `connectionTimeoutMillis` at all — see `readDatabasePoolConnectTimeoutMs`'s own header below
 * for why that second default is the more dangerous of the two. Both used to be entirely implicit;
 * this file makes them explicit and independently configurable PER PROCESS — this app's own `ROLE`/
 * replica count decides how many processes exist, this file only ever answers "how big is THIS
 * process's own pool", the same per-process (never per-fleet) scope every sweep-interval reader in
 * this codebase already holds for its own knob.
 *
 * ## The topology this was written against
 * Moving off a serverless Postgres provider (which fronted every connection with its OWN pooler) onto
 * a traditional managed instance with NO pooler at all means every one of these `max` connections is a
 * REAL backend process on the database server, not a multiplexed slot. At the target topology (3 API
 * replicas + 15 workers = 18 processes) the OLD implicit default alone opens up to 18 x 10 = 180
 * simultaneous connections — already past a stock, untuned Postgres's own compiled-in
 * `max_connections = 100`, before counting migrations, an operator's own psql session, or monitoring.
 * `DATABASE_POOL_MAX` defaults to `10` here — UNCHANGED from pg's own implicit default — specifically
 * so a single-container self-hosted instance (one process, `WORKER_INLINE=true`) behaves exactly as it
 * always has. It is the CHART (`deploy/helm/invoicerr/values.yaml`) that sets a smaller, role-specific
 * value for the api and worker Deployments once there is more than one process to budget for — the API
 * serves short requests and can want a burst of concurrent connections; a worker's own BullMQ
 * `Worker` runs at `concurrency: 1` by default everywhere in this codebase (no `@Processor()` here
 * overrides it), so one worker process is normally running exactly ONE job's own queries at a time and
 * needs far less headroom per replica than an API pod fielding several concurrent HTTP requests.
 */
import { Logger } from '@nestjs/common';
import { PoolConfig } from 'pg';

/** `@nestjs/common`'s own Logger, NEVER `@/logger/logger.service`: that one imports
 *  `prisma.service.ts`, which imports THIS file — a cycle, on the import path that constructs the
 *  database client. It is also the logger `logger.service.ts` itself writes through, so the console
 *  shape is the same one every other boot-time line has. */
const logger = new Logger('DatabasePoolConfig');

/** The last raw value refused, so a misconfigured instance says so once rather than on every read —
 *  see `readDatabasePoolMax` below. */
let refusedPoolMaxValue: string | undefined;

const DEFAULT_POOL_MAX = 10;

/**
 * Per-process pool ceiling — `DATABASE_POOL_MAX`. Default `10`: pg's OWN implicit default, chosen so
 * a self-hosted, single-container deployment (this app's own default topology, one process) sees NO
 * behavior change from before this file existed. A multi-replica deployment sets a smaller,
 * role-specific value per Deployment — see this file's own header.
 *
 * Validated here, the same way `readDatabasePoolConnectTimeoutMs` below already validates its own
 * knob, because pg-pool's own coalescence only catches HALF the malformed cases. Its constructor
 * runs `this.options.max = this.options.max || this.options.poolSize || 10`, so a `NaN` (a typo) or a
 * `0` is falsy and does land on 10 — but a NEGATIVE number is truthy and survives intact, and
 * `_isFull()` is `this._clients.length >= this.options.max`, which is then true from the very first
 * `connect()`: with `max: -1` the pool never opens a single connection, every query queues, and the
 * process boots, answers its health check, and serves nothing. That is the failure this validation
 * exists to prevent — a `connectionTimeoutMillis` (below) turns the hang into an error after 10s,
 * but an error on every query is not a working process either.
 *
 * The refusal is logged, naming the value rejected and the value in force: an operator who asked for
 * a pool of 4 and silently got 10 has no way to find out otherwise, and on a pooler-less managed
 * Postgres that difference is real connections on the server (this file's own header).
 */
export function readDatabasePoolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX;
  if (raw === undefined) return DEFAULT_POOL_MAX;

  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  if (refusedPoolMaxValue !== raw) {
    refusedPoolMaxValue = raw;
    logger.warn(
      `DATABASE_POOL_MAX="${raw}" is not a positive integer — using a pool of ${DEFAULT_POOL_MAX} ` +
        'instead. Handed to pg as given, a negative value would leave every query waiting on a pool ' +
        'that never opens a connection.',
    );
  }
  return DEFAULT_POOL_MAX;
}

/**
 * How long a query waits for a pool slot (an existing idle client freeing up, OR room to open a new
 * physical connection) before giving up — `DATABASE_POOL_CONNECT_TIMEOUT_MS`, pg's own
 * `connectionTimeoutMillis` (`pg-pool`'s `connect()`: this is the SAME timeout for "waiting on the
 * internal queue because the pool is already at `max`" as for "the physical TCP handshake to Postgres
 * itself taking too long" — one knob, two guards).
 *
 * Left unset — pg's own actual default — a saturated pool queues a request FOREVER: `connect()` only
 * arms a timeout `if (this.options.connectionTimeoutMillis)`, and that field carries no default of its
 * own in the `Pool` constructor (unlike `max`/`idleTimeoutMillis`, which it does default). A request
 * that never times out is strictly worse than one that fails after a bounded wait: the caller (an HTTP
 * request, a BullMQ job) is left LOOKING alive — no error, no retry, no visible symptom beyond an
 * ever-growing count of requests that will never resolve — until the whole process is restarted. A
 * bounded value turns that into an ordinary thrown error, which this codebase already knows what to do
 * with: a controller error becomes a normal 5xx instead of a hung connection, and a queue job error
 * runs through BullMQ's own existing retry/backoff (or, for a repeatable sweep, is simply picked up
 * again at the next scheduled tick — see e.g. `document-queue.dispatcher.ts`'s own `attempts: 1`
 * sweeps). No new error handling had to be built for this — only the timeout that makes the failure
 * happen instead of nothing happening at all.
 *
 * Default 10s: long enough to absorb an ordinary short burst without spurious failures (this app's own
 * nginx front door does not override `proxy_read_timeout`, so a request still has nginx's own default
 * 60s before IT gives up, regardless of this value); short enough that a genuinely exhausted pool
 * surfaces as a fast, actionable error rather than a slow, silent one. A parsed value that is not a
 * positive, finite number (missing, `0`, a typo) falls back to this SAME 10s rather than to pg's own
 * "no timeout" — the one case this function deliberately does not defer to the library's own fallback,
 * since that fallback is exactly the footgun this file exists to close.
 */
export function readDatabasePoolConnectTimeoutMs(): number {
  const DEFAULT_MS = 10_000;
  const parsed = parseInt(process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS ?? `${DEFAULT_MS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MS;
}

/** The full `pg.PoolConfig` `prisma.service.ts` hands to `PrismaPg` — connection string plus the two
 *  explicit knobs above, assembled in ONE place so the env reads and the connection string are never
 *  duplicated between the real singleton and a test asserting on the shape without constructing a real
 *  `PrismaPg`/`Pool`. */
export function buildDatabasePoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: readDatabasePoolMax(),
    connectionTimeoutMillis: readDatabasePoolConnectTimeoutMs(),
  };
}
