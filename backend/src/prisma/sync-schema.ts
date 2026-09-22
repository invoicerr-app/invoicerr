import { execFileSync } from 'child_process';
import { join } from 'path';

import prisma from './prisma.service';
import { seedCountryPolicies } from '../modules/documents/country-policy/seed';
import { seedCountryIdentifierRequirements } from '../modules/documents/country-identifiers/seed';

/**
 * Every self-hosted instance has been running on `prisma db push` since
 * v1.4.4a (the last published release whose image is confirmed to still be
 * the one in circulation — v1.4.5a was tagged, released, then deleted
 * before anyone pulled it). `db push` always converges the live database
 * to the schema that shipped with whatever image is running, so every
 * instance's actual schema matches *at least* v1.4.4a's cumulative state.
 *
 * This is the exact list of migrations that existed in v1.4.4a's
 * `prisma/migrations/` — see
 * https://github.com/invoicerr-app/invoicerr/tree/v1.4.4a/backend/prisma/migrations
 * Baselining (marking as applied without running their SQL) is safe for
 * these, and only these: anything not in this list is genuinely new since
 * the last thing that was ever live, and must run for real via
 * `migrate deploy` — including its data backfills.
 *
 * This list is frozen. Never add to it — new migrations should just run.
 */
const V1_4_4A_BASELINE_MIGRATIONS = [
  '20250906170944_initial_migration',
  '20250927133908_make_contact_names_optionals',
  '20251005123952_',
  '20251016182514_add_individual_required_fields',
  '20251019151109_add_plugin_types',
  '20251108171408_add_quote_status_rejected',
  '20251108172255_add_webhook_url_to_plugins',
  '20251108174326_add_webhook_secret_hash_to_plugins',
  '20251109131946_usage_of_webhook_secret_and_not_secret_hash',
  '20251123174134_add_webhook_models',
  '20251123174805_add_comprehensive_webhook_events',
  '20251123175246_add_comprehensive_webhook_events',
  '20251123180353_added_more_webhook_types',
  '20251123194540_add_webhook_company_relation',
  '20251127192241_remove_unexisting_plugins_types',
  '20251207090458_add_better_auth_integration',
  '20251207091839_added_optional_name',
  '20251207094504_update_firsname_to_firstname',
  '20251207132152_add_invitation_codes',
  '20251213184817_add_log_table',
  '20260203050340_support_fractional_quantities',
  '20260204182900_add_address_line2_and_state',
  '20260219120000_add_discount_rate_percent',
] as const;

// Resolves from dist/src/prisma (prod) or src/prisma (dev/ts-node) to the
// backend root either way, without depending on the parent process's cwd
// (entrypoint.sh `cd`s into backend/src before starting node).
const BACKEND_ROOT = join(__dirname, '..', '..');
const SCHEMA_PATH = join(BACKEND_ROOT, 'prisma', 'schema.prisma');
// Frozen full schema as it shipped in v1.4.4a. Only used to level a legacy
// `db push`-era instance (which may be *below* v1.4.4a) up to the exact
// v1.4.4a state before we baseline the v1.4.4a migrations as applied — see
// baselineIfNeeded(). Never pushed against an already-migrated DB.
const V1_4_4A_SCHEMA_PATH = join(BACKEND_ROOT, 'prisma', 'schema-v1.4.4a.prisma');

/**
 * `DATABASE_URL_UNPOOLED` — Neon's own name for the direct (non-PgBouncer) connection string
 * (https://neon.com/docs/guides/prisma: pooled = `...-pooler.<region>.aws.neon.tech`, direct drops
 * the `-pooler` segment). `prisma.service.ts`'s runtime client always uses the POOLED `DATABASE_URL`
 * — many short-lived connections from replicated api/worker pods is exactly what a pooler is for.
 * `migrate deploy`/`db push` are the opposite: a handful of DDL statements per deploy, but Prisma
 * Migrate takes a session-level advisory lock that PgBouncer's transaction-mode pooling does not
 * reliably preserve across statements — so these two CLI subprocesses get the DIRECT URL instead,
 * by overriding just THEIR OWN env (never `process.env` itself): `prisma.config.ts`'s
 * `datasource.url` resolves `env('DATABASE_URL')` at the time the CLI subprocess reads it, so this
 * override is invisible to the long-lived Nest process's own `PrismaPg` adapter (already
 * constructed, pooled, in `prisma.service.ts` before `syncDatabaseSchema()` ever runs).
 * Unset on a non-pooled setup (plain `docker-compose.yml` Postgres, or self-hosted) — falls back to
 * `DATABASE_URL` and behaves exactly as before this variable existed.
 */
function directDatabaseUrlEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL };
}

function runPrisma(args: string[]): void {
  // `prisma.config.ts`'s `migrations.path` is resolved relative to the
  // subprocess's cwd, not to --schema — run from the backend root (where
  // prisma/migrations is a real sibling of prisma/schema.prisma) so it
  // resolves correctly regardless of where the parent process started.
  execFileSync('npx', ['prisma', ...args, '--schema', SCHEMA_PATH], {
    stdio: 'inherit',
    cwd: BACKEND_ROOT,
    env: directDatabaseUrlEnv(),
  });
}

/**
 * How the live database's shape relates to the frozen v1.4.4a datamodel.
 *
 * `undetermined` is a first-class outcome, not an error case to collapse into one of the other two:
 * every caller below treats it as "assume healthy, change nothing". The repair this verdict gates
 * rewrites Prisma's own migration history, so the only safe reading of "I could not establish what
 * this database looks like" is to leave it alone.
 */
type LiveSchemaComparison = 'identical-to-v1.4.4a' | 'beyond-v1.4.4a' | 'undetermined';

/**
 * Asks Prisma itself whether the live database is still shaped exactly like v1.4.4a.
 *
 * `migrate diff` is read-only (it introspects and prints; it never writes to either side), and
 * `--exit-code` turns its answer into a process status: 0 = the two sides are identical, 2 = they
 * differ, 1 = the command itself failed. Prisma's introspection deliberately ignores its own
 * `_prisma_migrations` bookkeeping table, so the comparison is purely about user tables, columns,
 * enums and indexes — which is exactly the question being asked here.
 *
 * Not routed through `runPrisma()`: that helper appends `--schema`, which `migrate diff` rejects (it
 * takes `--from-…`/`--to-…` pairs instead), and it inherits stdio. This one captures instead. The
 * healthy answer here is "your database is nothing like v1.4.4a", which `migrate diff` renders as a
 * long `[-] Removed tables` list — an alarming thing to print into the boot log of an instance where
 * nothing is wrong. It is surfaced only when the comparison could not be made at all. The FROM side is
 * the live database behind `prisma.config.ts`'s `env('DATABASE_URL')`, resolved inside this
 * subprocess, so the direct/unpooled override applies here as it does to `migrate deploy`.
 */
function compareLiveSchemaToV1_4_4a(): LiveSchemaComparison {
  try {
    execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        V1_4_4A_SCHEMA_PATH,
        '--exit-code',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: BACKEND_ROOT, env: directDatabaseUrlEnv() },
    );
    return 'identical-to-v1.4.4a';
  } catch (error) {
    const { status, stderr } = error as { status?: number | null; stderr?: Buffer | string };
    if (status === 2) {
      return 'beyond-v1.4.4a';
    }
    console.warn(
      `[sync-schema] Could not compare the live schema against v1.4.4a (prisma migrate diff exited ` +
        `with ${String(status)}) — assuming the database is healthy and changing nothing.`,
    );
    if (stderr?.length) {
      console.warn(`[sync-schema] ${String(stderr).trim()}`);
    }
    return 'undetermined';
  }
}

/**
 * The migrations `_prisma_migrations` claims ran successfully and that are NOT part of the frozen
 * v1.4.4a baseline above.
 *
 * "Claims successfully" is Prisma's own encoding: `finished_at` set and `rolled_back_at` unset. A row
 * with `finished_at IS NULL` is a FAILED migration, which claims nothing — Prisma keeps it precisely
 * so `migrate deploy` refuses to move on (P3009) until a human decides. That distinction is
 * load-bearing for the detection below: a database that was correctly baselined and then had its
 * first real migration fail cleanly has a failed row and no false claim, and must keep tripping P3009
 * rather than be "repaired" behind the operator's back.
 */
async function migrationsClaimedBeyondV1_4_4a(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations"
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
     ORDER BY migration_name`,
  );
  const baseline = new Set<string>(V1_4_4A_BASELINE_MIGRATIONS);
  return rows.map((row) => row.migration_name).filter((name) => !baseline.has(name));
}

/**
 * Repairs a database whose `_prisma_migrations` history lies about its own schema, and returns the
 * migration names whose false "applied" records were retracted (empty when nothing was wrong).
 *
 * ## The state this exists for
 *
 * The published `:latest` image (v1.4.5c) runs `prisma db push --accept-data-loss` against the FROZEN
 * `schema-v1.4.4a.prisma` on every single container start — not once, every boot. `db push` converges
 * the database to the datamodel it is handed, so on an instance that had already migrated forward it
 * silently DROPS every table and column the post-v1.4.4a migrations created, while `_prisma_migrations`
 * keeps its rows saying those migrations ran. `syncDatabaseSchema()` then sees the history table
 * exists, considers the database already on the migrate system, and `migrate deploy` finds every one
 * of those migrations marked applied and skips them.
 *
 * The result is a database SHAPED like v1.4.4a whose history CLAIMS far more. Upgrading it fails
 * partway through, in the worst possible way: `migrate deploy` skips the migrations it wrongly thinks
 * ran (the `Receipt`→`Payment` rename among them) and then aborts with P3018 on the first migration
 * that touches what they were supposed to have created — `ALTER TABLE "Payment"` against a database
 * where `Payment` never came into existence — roughly a hundred migrations short of the target, after
 * having already committed part of the way there.
 *
 * ## Why this detection cannot misfire on a healthy database
 *
 * Two independent conditions must BOTH hold, and no healthy database can satisfy them together:
 *
 *  1. the history claims at least one post-v1.4.4a migration ran successfully, and
 *  2. the live schema is, per `prisma migrate diff`, identical to the frozen v1.4.4a datamodel —
 *     not "close to", not "missing a column": no difference at all, in either direction.
 *
 * On a healthy database those contradict each other by construction. Every migration outside the
 * frozen baseline changes the schema (the earliest of them creates a table), so one that genuinely
 * ran leaves the database demonstrably past v1.4.4a and (2) is false. Conversely a database that
 * really is at v1.4.4a has only baseline migrations recorded — or, on a legacy `db push` instance, no
 * history table at all, which never reaches this function — so (1) is false. A database this repair
 * fires on has therefore already proven it is inconsistent with itself.
 *
 * The two other paths through this file are equally safe from it: a legacy instance with no
 * `_prisma_migrations` is handled by `baselineIfNeeded()`'s other branch and is never asked, and a
 * database caught mid-baseline (the 23 rows written, the deploy not yet run) has nothing outside the
 * baseline and fails (1). An `undetermined` comparison — the diff subprocess itself failing — is
 * treated as healthy, so a transient failure can only ever mean "skip the repair", never "perform it".
 *
 * ## What this deliberately does NOT repair
 *
 * The exactness of (2) is what makes the repair safe, and it is also its boundary: a database that
 * has already been PART of the way through the failed upgrade — the P3018 abort commits some of the
 * migrations that ran before it — is no longer identical to v1.4.4a, so the comparison comes back
 * `beyond-v1.4.4a` and nothing happens. That is the intended answer, not an oversight. Such a
 * database carries a failed migration row, `migrate deploy` stops on it with P3009 by design, and
 * what remains to be undone is real schema, not just bookkeeping — deciding that from in here, with
 * no way to tell a half-applied upgrade from a healthy one that merely looks unfamiliar, is exactly
 * the guess that would destroy data. Detecting the corruption BEFORE the first deploy attempt, which
 * is what this function does, is what keeps a database from ever reaching that state.
 *
 * ## The repair, and why it is a DELETE
 *
 * The rows are the only thing wrong: the schema is genuinely at v1.4.4a and the migrations recorded
 * beyond it genuinely did not survive. Removing those rows restores the truth — the history then says
 * exactly what the schema shows — and `migrate deploy`, immediately after, runs every one of them for
 * real, backfills included, in order.
 *
 * Prisma has no CLI verb for this. `migrate resolve --applied` only ever ADDS a row, and
 * `--rolled-back` refuses (P3012) any migration that is not in a failed state, which these are not:
 * they are recorded as complete successes. Writing the table directly is the only mechanism
 * available, and it is the same table `migrate resolve` would have written.
 *
 * Failed rows outside the baseline are deleted too, deliberately. Condition (2) has just established
 * that the live schema carries no trace of ANY post-v1.4.4a migration, so a failed one left nothing
 * behind either and re-running it is precisely the right outcome — the P3009 gate it would otherwise
 * raise protects a partially-applied migration, and there is provably nothing partial here.
 *
 * Concurrent replicas booting together each run this; the DELETE is idempotent (the second one
 * removes no rows) and `migrate deploy` takes its own advisory lock afterwards.
 */
export async function repairV1_4_4aLevelingIfCorrupted(): Promise<string[]> {
  const claimedBeyondBaseline = await migrationsClaimedBeyondV1_4_4a();
  // Cheapest question first: on a healthy database this single query is the whole cost when the
  // answer is "nothing beyond the baseline", and the `migrate diff` subprocess below only runs for
  // databases that have something to contradict in the first place.
  if (claimedBeyondBaseline.length === 0) {
    return [];
  }

  if (compareLiveSchemaToV1_4_4a() !== 'identical-to-v1.4.4a') {
    return [];
  }

  console.warn(
    '[sync-schema] BROKEN MIGRATION HISTORY DETECTED. This database is shaped exactly like v1.4.4a, ' +
      `yet its migration history claims ${claimedBeyondBaseline.length} later migration(s) already ran. ` +
      'That is what the v1.4.5c image did on every boot: it re-pushed the frozen v1.4.4a schema over ' +
      'your database, dropping what those migrations had created while their records stayed behind.',
  );
  console.warn(
    `[sync-schema] Retracting those false records so they run for real: ${claimedBeyondBaseline.join(', ')}`,
  );

  // Placeholders rather than an interpolated list: the baseline names are a frozen literal in this
  // file, but the query still goes through the driver's own parameter binding.
  const placeholders = V1_4_4A_BASELINE_MIGRATIONS.map((_, index) => `$${index + 1}`).join(', ');
  const deleted = await prisma.$executeRawUnsafe(
    `DELETE FROM "_prisma_migrations" WHERE migration_name NOT IN (${placeholders})`,
    ...V1_4_4A_BASELINE_MIGRATIONS,
  );

  console.warn(
    `[sync-schema] Removed ${deleted} false migration record(s). The v1.4.4a baseline is untouched; ` +
      'migrate deploy will now apply everything after it, in order, with its data backfills.',
  );

  return claimedBeyondBaseline;
}

async function tableExists(tableName: string): Promise<boolean> {
  // Cast to text: the pg driver adapter can't deserialize the native
  // `regclass` type returned by `to_regclass` directly.
  const rows = await prisma.$queryRawUnsafe<{ exists: string | null }[]>(
    `SELECT to_regclass('"${tableName}"')::text AS exists`,
  );
  return rows[0]?.exists != null;
}

async function migrationsTableExists(): Promise<boolean> {
  return tableExists('_prisma_migrations');
}

async function databaseHasExistingData(): Promise<boolean> {
  return tableExists('Company');
}

/**
 * `db push` (used in prod until now) never touches `prisma/migrations/`, so
 * existing self-hosted databases have the full cumulative schema but no
 * `_prisma_migrations` history. Running `migrate deploy` on those as-is
 * would fail trying to replay migration #1 against tables that already
 * exist. We baseline once: mark exactly the migrations confirmed already
 * live (V1_4_4A_BASELINE_MIGRATIONS) as already applied, then let
 * `migrate deploy` actually run everything newer — for real, backfills
 * included.
 *
 * Before baselining, we level the schema up to v1.4.4a with a one-off
 * `db push` against the frozen v1.4.4a schema. A legacy instance may be
 * running a version *below* v1.4.4a, so its DB can be a subset of v1.4.4a;
 * marking the 23 v1.4.4a migrations "applied" on such a DB would otherwise
 * be a lie (their changes aren't all there) and cause drift. The push only
 * adds what's missing (their descriptions are still non-NULL — the
 * NULL-clearing migration is post-v1.4.4a), and this whole branch is gated
 * on `!migrationsTableExists()`, so it never runs against a DB already on
 * the migrate-deploy system (where pushing back to v1.4.4a would drop every
 * newer table/column). This used to live in entrypoint.sh but ran
 * unconditionally there, wrongly converging already-migrated instances back
 * down to v1.4.4a on every boot.
 *
 * The presence of `_prisma_migrations` is NOT on its own proof that the database is consistent, and
 * treating it as such was this function's one real defect: the v1.4.5c image kept doing that
 * unconditional v1.4.4a push in its own entrypoint, so a history table can perfectly well sit on top
 * of a schema that was levelled back underneath it. `repairV1_4_4aLevelingIfCorrupted()` — read its
 * header — is the second question this branch now asks: does the schema actually match what that
 * history claims?
 */
async function baselineIfNeeded(): Promise<void> {
  if (await migrationsTableExists()) {
    await repairV1_4_4aLevelingIfCorrupted();
    return;
  }

  if (!(await databaseHasExistingData())) {
    // Fresh database: let `migrate deploy` create everything normally.
    return;
  }

  console.log(
    '[sync-schema] Legacy db-push instance detected — leveling schema up to v1.4.4a before baselining.',
  );
  execFileSync('npx', ['prisma', 'db', 'push', '--accept-data-loss', '--schema', V1_4_4A_SCHEMA_PATH], {
    stdio: 'inherit',
    cwd: BACKEND_ROOT,
    env: directDatabaseUrlEnv(),
  });

  console.log('[sync-schema] Baselining migrations confirmed already live as applied.');

  for (const migration of V1_4_4A_BASELINE_MIGRATIONS) {
    console.log(`[sync-schema] Resolving ${migration} as applied...`);
    runPrisma(['migrate', 'resolve', '--applied', migration]);
  }
}

export async function syncDatabaseSchema(): Promise<void> {
  await baselineIfNeeded();
  console.log('[sync-schema] Running migrate deploy...');
  runPrisma(['migrate', 'deploy']);

  // The document country-action policy (backend/src/modules/documents/country-policy/) is read from
  // its JSON files and seeded here on every production boot — a self-hosted instance that pulls a
  // new image with an updated fr.json/us.json gets the update on its next restart, the same way
  // `prisma migrate dev`/`db seed` already re-seeds it for dev and CI (see prisma.config.ts).
  // Idempotent (seedCountryPolicies' own doc comment): safe to run on every boot, never just once.
  //
  // `purgeRemovedCountries: false` — DELIBERATELY, even though this runs once per boot rather than
  // per-replica like `boot-reseed.ts`'s own online path. This function has no way to tell "this
  // instance's image genuinely dropped a country" apart from "this is an OLD replica, mid-rolling-
  // deployment, whose own image just hasn't caught up to the newer one that already seeded that
  // country" — the exact race `seedCountryPolicies`'s own `purgeRemovedCountries` doc comment names.
  // A self-hosted single-instance deploy restarting on a new image is indistinguishable, from in
  // here, from one replica of a multi-replica rolling upgrade — so this path only ever ADDS/UPDATES
  // rows for the countries its OWN catalog still names, never deletes a whole country's rows. A
  // country genuinely removed from `data/*.json` is purged only by the explicit, single-run
  // `npm run catalogs:release` (`backend/scripts/release-catalogs.ts`) — see that file's own header,
  // and run it once per deployment that actually drops a country, never automatically.
  console.log('[sync-schema] Seeding document country-action policy (no whole-country purge)...');
  const summary = await seedCountryPolicies(prisma, undefined, false);
  console.log(
    `[sync-schema] Document country policy: ${summary.upserted} upserted, ${summary.deleted} deleted (stale).`,
  );

  // Same reasoning, same idempotency, same "never purge a whole country here" rule, for the
  // SEPARATE country identifier-requirements catalog (backend/src/modules/documents/country-identifiers/)
  // — see that seed's own header.
  console.log('[sync-schema] Seeding country identifier requirements (no whole-country purge)...');
  const identifierSummary = await seedCountryIdentifierRequirements(prisma, undefined, false);
  console.log(
    `[sync-schema] Country identifier requirements: ${identifierSummary.upserted} upserted, ` +
      `${identifierSummary.deleted} deleted (stale).`,
  );
}
