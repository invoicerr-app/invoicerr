/**
 * The migration-vs-schema enum tripwire (TODO_LIBRE.md L3 / TODO_ISSUES.md "Dérive
 * migration-vs-schema sur les enums : aucun tripwire automatisé sur base fraîche").
 *
 * The class of bug this closes: `20260903170000_restore_document_settled_after_enum_rebuild`'s own
 * header (read it before touching this file) proves that `migrate deploy` on a FRESH database
 * replays migration directories in lexicographic timestamp order, which is not always the order
 * they were authored or the order they happen to already be applied in on a database that has been
 * migrating forward incrementally for a while. There, a later-authored migration that ADDED an enum
 * value (`ALTER TYPE ... ADD VALUE`) sorted BEFORE an earlier-authored migration that RECONSTRUCTS
 * the same enum type from a fixed value list (`CREATE TYPE ..._new` / cast / rename — the only way
 * Postgres can remove a value) written before that value existed — so a fresh `migrate deploy`
 * silently ends up with a narrower enum than the one every already-migrated database has, and than
 * the one `prisma/generated/prisma/enums.ts` claims. That specific mine was found and fixed by hand
 * (17 `WebhookEvent` values verified with psql, the missing 18th caught by mutating the `_new` list
 * during validation). Nothing before this file made that check automatic, or ran it for every enum
 * rather than the one under active work.
 *
 * What this spec actually proves, on a database `migrate deploy` has NEVER touched before: for every
 * enum Postgres ends up with (via `pg_enum`) and every enum the generated Prisma client claims to
 * export (`Object.values` on each member of `enums.ts`), the two sides name the same enums with the
 * same value sets. Both directions are checked — an enum (or a value) on one side and not the other
 * is a drift either way, not just a subset check — because a `CREATE TYPE` that never got dropped, or
 * a schema.prisma enum whose migration never ran, would be just as real a divergence as a missing
 * value and just as invisible to a spot check.
 *
 * ## Gating
 *
 * Follows the queue specs' own pattern (`modules/documents/queue/__tests__/*.redis.spec.ts`:
 * `DOCUMENTS_QUEUE_REDIS_TESTS=1`), not `live-gate.ts`'s `liveDescribe` — this needs one opt-in flag
 * and an already-present `DATABASE_URL`, no external credentials to demand or warn about missing.
 * Gated on `MIGRATION_FRESH_TESTS=1` rather than merely "a `DATABASE_URL` happens to be set", for the
 * exact same reason the queue specs gate explicitly: a bare offline `npm test` run always has
 * `DATABASE_URL` unset (see `backend-tests` in `.github/workflows/cypress.yml`, which never sets one
 * for the "Run backend unit tests" step) so it would already skip, but making the flag the actual
 * condition keeps the intent — "did someone ask for this" — explicit rather than incidental.
 *
 * Run locally:
 *   cd backend && MIGRATION_FRESH_TESTS=1 npx jest migration-fresh-schema --forceExit
 *
 * (`--forceExit`: the throwaway database's own `pg.Client` connections close themselves in
 * `afterAll`, but Prisma's own migrate-deploy subprocess and this file's admin connection can leave
 * the process with lingering handles past the last assertion — the same tolerance the queue specs
 * already accept for BullMQ/ioredis.)
 *
 * ## The throwaway database, and why it can never be `invoicerr_dev` / `invoicerr_db` / `invoicerr_test`
 *
 * The admin connection (used to CREATE and later DROP the throwaway database) is derived from
 * `DATABASE_URL` by swapping the path to `/postgres` — the same "connect to the maintenance database
 * to run CREATE/DROP DATABASE" pattern every manual verification of this bug used by hand. The
 * throwaway database itself is named `invoicerr_migration_fresh_<pid>`: `process.pid` rather than
 * `Date.now()` because this file runs under jest, where a pid is already a unique-enough,
 * human-traceable handle for "which run left this behind" without reaching for wall-clock time (the
 * CI workflow context this task was read against rules out `Date.now()` for exactly this kind of
 * name precisely because two things in the same second can collide there — a pid never collides
 * with a concurrent process on the same machine).
 *
 * `assertThrowawayName` is the actual guard-rail, not just the naming convention: every CREATE and
 * DROP this file issues passes through it first, and it refuses any name that doesn't carry the
 * `invoicerr_migration_fresh_` prefix. The one thing that must never happen is this spec reaching a
 * real database — the dev watcher's `invoicerr_dev` (backend `.env`) or `invoicerr_db` (docker
 * compose), or the queue-integration job's own `invoicerr_test` — because a stray `DROP DATABASE`
 * against any of those would be catastrophic and because a `migrate deploy` against an ALREADY
 * migrated database is not what this spec is testing in the first place (the whole point is a
 * database that has never seen a single migration).
 */
import 'dotenv/config';

import { execFileSync } from 'child_process';
import { join } from 'path';

import { Client } from 'pg';

import * as generatedEnums from '../../prisma/generated/prisma/enums';

const migrationFreshTestsEnabled = process.env.MIGRATION_FRESH_TESTS === '1';
const describeGated = migrationFreshTestsEnabled ? describe : describe.skip;

// `migrate deploy` alone takes ~10-20s against a cold throwaway database (schema + seed-free), on
// top of CREATE DATABASE and two short-lived `pg` connections — generous headroom over jest's 5s
// default so a slow CI runner doesn't turn a passing tripwire into a flaky one.
jest.setTimeout(120_000);

// Resolves to the backend project root the same way `src/prisma/sync-schema.ts` does, so `npx prisma
// migrate deploy` finds `prisma/schema.prisma` and `prisma/migrations/` as real siblings regardless
// of the parent process's own cwd.
const BACKEND_ROOT = join(__dirname, '..', '..');

const THROWAWAY_DB_PREFIX = 'invoicerr_migration_fresh_';

function assertThrowawayName(name: string): asserts name is string {
  if (!name.startsWith(THROWAWAY_DB_PREFIX) || !/^[a-z0-9_]+$/i.test(name)) {
    throw new Error(
      `refusing to operate on database "${name}": it does not carry the required ` +
        `"${THROWAWAY_DB_PREFIX}" throwaway prefix — this guard exists so a bug in this spec can ` +
        'never reach a real database (invoicerr_dev / invoicerr_db / invoicerr_test).',
    );
  }
}

// Builds a connection string identical to `base` except for the path (the target database) — and
// drops any query string (Prisma's own `?schema=public` is meaningless to a plain `pg` connection
// and irrelevant here: the enum comparison below explicitly filters `pg_namespace.nspname = 'public'`
// regardless of search_path).
function withDatabase(base: URL, database: string): string {
  const url = new URL(base.toString());
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

describeGated('migration-vs-schema enum tripwire (fresh Postgres)', () => {
  const dbName = `${THROWAWAY_DB_PREFIX}${process.pid}`;
  assertThrowawayName(dbName);

  let adminClient: Client | undefined;
  let throwawayUrl: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'MIGRATION_FRESH_TESTS=1 requires DATABASE_URL — the admin connection (CREATE/DROP DATABASE) ' +
          'is derived from it by swapping the path to /postgres.',
      );
    }
    const baseUrl = new URL(process.env.DATABASE_URL);

    adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') });
    await adminClient.connect();

    // Defensive, not expected: a previous crashed run under the SAME pid (a prior jest process that
    // died before its own afterAll ran) may have left this exact name behind. `WITH (FORCE)` also
    // covers a lingering connection from that same dead run.
    assertThrowawayName(dbName);
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE "${dbName}"`);

    throwawayUrl = withDatabase(baseUrl, dbName);

    // The exact command the queue-integration CI job already runs against its own empty Postgres
    // (`.github/workflows/cypress.yml`, "Apply migrations (empty dev DB)") — no flags of its own that
    // would make this a different code path, only a different, disposable target database. `inherit`
    // so a failure here shows the real prisma output in the test run rather than a bare exit code.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: throwawayUrl },
      stdio: 'inherit',
    });
  });

  afterAll(async () => {
    // try/finally: the throwaway database must be dropped even if the comparison test above threw
    // (mutated migrations are expected to make it throw — that is the whole point of this spec).
    try {
      if (adminClient) {
        assertThrowawayName(dbName);
        await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      }
    } finally {
      await adminClient?.end();
    }
  });

  it('has the same enums, with the same values, on the freshly migrated database and the generated client', async () => {
    const freshClient = new Client({ connectionString: throwawayUrl });
    await freshClient.connect();

    let dbEnums: Map<string, string[]>;
    try {
      // Every enum type in the `public` schema, values in their `pg_enum` order — discovered by
      // introspection, not by reading the list of enums out of schema.prisma: an enum that a
      // migration created but that no longer has (or never had) a matching `enum` block would
      // otherwise be invisible to this check, which is exactly the "present on one side only" half
      // of the tripwire.
      const { rows } = await freshClient.query<{ enum_name: string; value: string }>(
        `SELECT t.typname AS enum_name, e.enumlabel AS value
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public'
         ORDER BY t.typname, e.enumsortorder`,
      );
      dbEnums = new Map();
      for (const { enum_name, value } of rows) {
        const values = dbEnums.get(enum_name) ?? [];
        values.push(value);
        dbEnums.set(enum_name, values);
      }
    } finally {
      await freshClient.end();
    }

    // The generated client's own enum exports (`prisma/generated/prisma/enums.ts`) — every export in
    // that file is one enum object (`export const X = { A: 'A', ... } as const`), one per `enum`
    // block in schema.prisma at generation time, so `Object.keys` here IS the client-side enum list,
    // discovered the same "don't hand-maintain the list" way as the database side above.
    const clientEnumsRaw = generatedEnums as unknown as Record<string, Record<string, string>>;
    const clientEnums = new Map<string, string[]>(
      Object.entries(clientEnumsRaw).map(([name, members]) => [name, Object.values(members)]),
    );

    const allNames = new Set<string>([...dbEnums.keys(), ...clientEnums.keys()]);
    const problems: string[] = [];

    for (const name of [...allNames].sort()) {
      const dbValues = dbEnums.get(name);
      const clientValues = clientEnums.get(name);

      if (!dbValues) {
        problems.push(
          `"${name}": exported by the generated client, but no such enum type exists on ` +
            'the freshly migrated database',
        );
        continue;
      }
      if (!clientValues) {
        problems.push(
          `"${name}": exists on the freshly migrated database, but the generated client exports no ` +
            'such enum',
        );
        continue;
      }

      const dbSet = new Set(dbValues);
      const clientSet = new Set(clientValues);
      const onlyInDb = dbValues.filter((v) => !clientSet.has(v));
      const onlyInClient = clientValues.filter((v) => !dbSet.has(v));

      if (onlyInDb.length > 0 || onlyInClient.length > 0) {
        const parts: string[] = [];
        if (onlyInDb.length > 0) parts.push(`only in the database: [${onlyInDb.join(', ')}]`);
        if (onlyInClient.length > 0) parts.push(`only in the generated client: [${onlyInClient.join(', ')}]`);
        problems.push(`"${name}" diverges — ${parts.join('; ')}`);
      }
    }

    if (problems.length > 0) {
      throw new Error(
        'migration-vs-schema enum drift on a freshly migrated database:\n' +
          problems.map((p) => `  - ${p}`).join('\n'),
      );
    }
  });
});
