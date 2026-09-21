/**
 * Pins `20260921130000_restore_backfilled_api_key_read_scopes` — the compatibility migration that
 * re-grants scopes to API keys still carrying the exact five-scope set
 * `20260705130000_add_api_key_scopes_and_pdf_download_token` backfilled onto every pre-existing key
 * (`quotes:write`, `invoices:write`, `clients:write`, `articles:write`, `articles:read`). See that new
 * migration's own header for the full "why" — this spec only proves the SQL does what it claims,
 * against a real Postgres instance, not the app-level `scopes.ts` in isolation.
 *
 * ## Gating
 *
 * Same convention as the other migration probes in this directory (`RESTORE_PROBE_TESTS=1`,
 * `BACKFILL_PROBE_TESTS=1`, `MIGRATION_FRESH_TESTS=1`): one opt-in flag, `DATABASE_URL` already
 * present, no external credentials. A bare offline `npm test` always skips this (no `DATABASE_URL` in
 * that job — see `backend-tests` in `.github/workflows/cypress.yml`).
 *
 * Run locally:
 *   cd backend && API_KEY_SCOPES_PROBE_TESTS=1 npx vitest run src/prisma/restore-backfilled-api-key-read-scopes.spec.ts
 *
 * ## What this drives
 *
 * `prisma migrate deploy` against a FRESH throwaway database — the entire migration chain, this new
 * migration included — which is itself the proof the SQL applies cleanly (a syntax error, an unknown
 * column, a bad cast, would fail `beforeAll` outright, the same way it would fail a real deploy). Three
 * `api_key` rows are then seeded directly (one carrying exactly the old five-scope backfill in
 * SHUFFLED order — proving the match really is order-insensitive, not an accidental exact-array
 * comparison — one with a deliberately narrow, already-chosen scope set, one with no scopes at all),
 * and the migration's own `migration.sql` content is re-run directly (the same "prove the WHERE clause
 * itself, not just that the migration ran once at an empty table" pattern
 * `restore-legacy-numbers-payments-signatures.spec.ts` already uses for its own idempotency check) —
 * because at the point `migrate deploy` first executed this statement the table had no rows yet, so
 * that first run alone proves nothing about which rows the fingerprint does or does not match.
 *
 * ## The throwaway database
 *
 * Named `invoicerr_api_key_scopes_probe_<pid>` — same non-negotiable guard-rail as every other spec in
 * this directory (`assertThrowawayName`, copied rather than imported so this file never has to widen
 * another spec's module surface): the one thing that must never happen is this spec's CREATE/DROP
 * DATABASE reaching `invoicerr_dev` (backend `.env`) or `invoicerr_db` (`.env.test`/docker compose).
 */

import { vi } from 'vitest';

import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

const apiKeyScopesProbeTestsEnabled = process.env.API_KEY_SCOPES_PROBE_TESTS === '1';
const describeGated = apiKeyScopesProbeTestsEnabled ? describe : describe.skip;

// `migrate deploy` against a fresh, empty database replays the FULL migration chain (138+ files as of
// this writing) — generous headroom over the runner's 5s default, matching `migration-fresh-schema.
// spec.ts`'s own budget for the same "cold database, whole chain" shape.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const BACKEND_ROOT = join(__dirname, '..', '..');
const MIGRATION_DIR = '20260921130000_restore_backfilled_api_key_read_scopes';

const THROWAWAY_DB_PREFIX = 'invoicerr_api_key_scopes_probe_';

function assertThrowawayName(name: string): asserts name is string {
  if (!name.startsWith(THROWAWAY_DB_PREFIX) || !/^[a-z0-9_]+$/i.test(name)) {
    throw new Error(
      `refusing to operate on database "${name}": it does not carry the required ` +
        `"${THROWAWAY_DB_PREFIX}" throwaway prefix — this guard exists so a bug in this spec can ` +
        'never reach a real database (invoicerr_dev / invoicerr_db).',
    );
  }
}

function withDatabase(base: URL, database: string): string {
  const url = new URL(base.toString());
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

// The exact 5-scope set 20260705130000's own backfill wrote, in an order that is NOT the order the
// original migration's SQL literal used — asserting the fingerprint match survives shuffling is the
// whole point of seeding it this way rather than copying the original literal order verbatim.
const OLD_BACKFILL_SCOPES_SHUFFLED = [
  'clients:write',
  'quotes:write',
  'articles:read',
  'invoices:write',
  'articles:write',
];

// Mirrors the new migration's own SET clause literally (not imported from `scopes.ts` — the migration
// is a frozen snapshot, and so is this expectation of what it does).
const EXPECTED_GRANTED_SCOPES = new Set([
  'articles:read',
  'quotes:read',
  'invoices:read',
  'clients:read',
  'credit-notes:read',
  'expenses:read',
  'received-invoices:read',
  'company:read',
  'api-keys:read',
  'webhooks:read',
  'billing:read',
  'time-tracking:read',
  'quotes:write',
  'invoices:write',
  'credit-notes:write',
  'expenses:write',
  'received-invoices:write',
  'clients:write',
  'articles:write',
]);

describeGated('20260921130000 restore — backfilled API key read scopes', () => {
  const dbName = `${THROWAWAY_DB_PREFIX}${process.pid}`;
  assertThrowawayName(dbName);

  let adminClient: Client | undefined;
  let throwawayUrl: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'API_KEY_SCOPES_PROBE_TESTS=1 requires DATABASE_URL — the admin connection (CREATE/DROP ' +
          'DATABASE) is derived from it by swapping the path to /postgres.',
      );
    }
    const baseUrl = new URL(process.env.DATABASE_URL);

    adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') });
    await adminClient.connect();

    assertThrowawayName(dbName);
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE "${dbName}"`);

    throwawayUrl = withDatabase(baseUrl, dbName);

    // The real upgrade path, on a database `migrate deploy` has never touched — proves the new
    // migration's SQL applies cleanly as part of the whole chain, exactly like a real deploy would run
    // it.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: throwawayUrl },
      stdio: 'inherit',
    });

    // Seed one Company + one User (api_key.companyId/userId are both FK-enforced,
    // ON DELETE CASCADE) and three api_key rows in the three states the migration's WHERE clause has
    // to tell apart.
    const seedClient = new Client({ connectionString: throwawayUrl });
    await seedClient.connect();
    try {
      await seedClient.query(
        `INSERT INTO "Company" (id, name, "foundedAt", address, "postalCode", city, country, phone, email)
         VALUES ('company-1', 'Acme SARL', now(), '1 rue de Paris', '75001', 'Paris', 'France', '+33100000000', 'acme@example.com')`,
      );
      await seedClient.query(
        `INSERT INTO "user" (id, firstname, lastname, email, "updatedAt")
         VALUES ('user-1', 'Jane', 'Doe', 'jane@example.com', now())`,
      );

      // Row A: exactly the old backfill's five scopes, shuffled — must be upgraded.
      await seedClient.query(
        `INSERT INTO "api_key" (id, name, "keyPrefix", "keyHash", "userId", "companyId", scopes)
         VALUES ('key-old-backfill', 'legacy key', 'inv_abcd', 'hash-old-backfill', 'user-1', 'company-1', $1::TEXT[])`,
        [OLD_BACKFILL_SCOPES_SHUFFLED],
      );

      // Row B: a deliberately narrow, already-chosen scope set — must be left untouched.
      await seedClient.query(
        `INSERT INTO "api_key" (id, name, "keyPrefix", "keyHash", "userId", "companyId", scopes)
         VALUES ('key-deliberate', 'read-only key', 'inv_efgh', 'hash-deliberate', 'user-1', 'company-1', ARRAY['invoices:read']::TEXT[])`,
      );

      // Row C: no scopes at all (the default for a key minted after the original backfill) — must be
      // left untouched.
      await seedClient.query(
        `INSERT INTO "api_key" (id, name, "keyPrefix", "keyHash", "userId", "companyId", scopes)
         VALUES ('key-empty', 'brand new key', 'inv_ijkl', 'hash-empty', 'user-1', 'company-1', ARRAY[]::TEXT[])`,
      );
    } finally {
      await seedClient.end();
    }
  });

  afterAll(async () => {
    try {
      if (adminClient) {
        assertThrowawayName(dbName);
        await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      }
    } finally {
      await adminClient?.end();
    }
  });

  it('upgrades only the row fingerprinted as the untouched old backfill, any order, and leaves the rest alone', async () => {
    // `migrate deploy` already ran this migration's UPDATE once, against an EMPTY api_key table (the
    // rows above did not exist yet) — that run alone proves nothing about the WHERE clause's actual
    // matching behavior. Re-running the migration's own file content directly, now that the three rows
    // exist, is what actually exercises the fingerprint.
    const migrationSql = readFileSync(
      join(BACKEND_ROOT, 'prisma', 'migrations', MIGRATION_DIR, 'migration.sql'),
      'utf8',
    );

    const db = new Client({ connectionString: throwawayUrl });
    await db.connect();
    try {
      await db.query(migrationSql);

      const { rows } = await db.query<{ id: string; scopes: string[] }>(
        `SELECT id, scopes FROM "api_key" ORDER BY id`,
      );
      const byId = new Map(rows.map((r) => [r.id, r.scopes]));

      // Row A: upgraded to exactly the full granted set — order-independent comparison, since a
      // Postgres TEXT[] UPDATE has no guaranteed element order of its own to assert on.
      const upgraded = new Set(byId.get('key-old-backfill'));
      expect(upgraded).toEqual(EXPECTED_GRANTED_SCOPES);
      expect(upgraded.has('clients:read')).toBe(true);
      expect(upgraded.has('invoices:read')).toBe(true);
      expect(upgraded.has('credit-notes:write')).toBe(true);
      expect(upgraded.has('api-keys:write')).toBe(false);
      expect(upgraded.has('billing:write')).toBe(false);
      expect(upgraded.has('company:write')).toBe(false);
      expect(upgraded.has('webhooks:write')).toBe(false);
      expect(upgraded.has('time-tracking:write')).toBe(false);

      // Row B: a deliberately-chosen scope set — the migration must never override an owner's own
      // choice, so this stays exactly as seeded.
      expect(byId.get('key-deliberate')).toEqual(['invoices:read']);

      // Row C: no scopes at all — cardinality alone already fails the fingerprint, so this stays
      // empty rather than being treated as "nothing chosen yet, so grant everything".
      expect(byId.get('key-empty')).toEqual([]);

      // Idempotency: running the same migration content a second time must not change an
      // already-upgraded row (it no longer carries the old 5-scope fingerprint) or touch the other two.
      await db.query(migrationSql);
      const { rows: rowsAfterRerun } = await db.query<{ id: string; scopes: string[] }>(
        `SELECT id, scopes FROM "api_key" ORDER BY id`,
      );
      const byIdAfterRerun = new Map(rowsAfterRerun.map((r) => [r.id, r.scopes]));
      expect(new Set(byIdAfterRerun.get('key-old-backfill'))).toEqual(EXPECTED_GRANTED_SCOPES);
      expect(byIdAfterRerun.get('key-deliberate')).toEqual(['invoices:read']);
      expect(byIdAfterRerun.get('key-empty')).toEqual([]);
    } finally {
      await db.end();
    }
  });
});
