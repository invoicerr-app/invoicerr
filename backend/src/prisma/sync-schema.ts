import { execFileSync } from 'child_process';
import { join } from 'path';

import prisma from './prisma.service';

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

function runPrisma(args: string[]): void {
  // `prisma.config.ts`'s `migrations.path` is resolved relative to the
  // subprocess's cwd, not to --schema — run from the backend root (where
  // prisma/migrations is a real sibling of prisma/schema.prisma) so it
  // resolves correctly regardless of where the parent process started.
  execFileSync('npx', ['prisma', ...args, '--schema', SCHEMA_PATH], {
    stdio: 'inherit',
    cwd: BACKEND_ROOT,
  });
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
 */
async function baselineIfNeeded(): Promise<void> {
  if (await migrationsTableExists()) {
    return;
  }

  if (!(await databaseHasExistingData())) {
    // Fresh database: let `migrate deploy` create everything normally.
    return;
  }

  console.log(
    '[sync-schema] Existing database with no migration history detected — baselining migrations confirmed already live as applied.',
  );

  for (const migration of V1_4_4A_BASELINE_MIGRATIONS) {
    console.log(`[sync-schema] Resolving ${migration} as applied...`);
    runPrisma(['migrate', 'resolve', '--applied', migration]);
  }
}

export async function syncDatabaseSchema(): Promise<void> {
  await baselineIfNeeded();
  console.log('[sync-schema] Running migrate deploy...');
  runPrisma(['migrate', 'deploy']);
}
