/**
 * Pins the `20260829233000_suppression_documents_legaux` backfill — the `INSERT ... SELECT` into
 * "DocumentInstance" added ahead of that migration's `DROP TABLE` statements so a self-hosted
 * instance's pre-existing Invoice/Quote history survives the upgrade (see that migration's own
 * header for the defect this closes: the plain drop, unmodified, took two real invoices in and
 * produced zero `DocumentInstance` rows out).
 *
 * This is not a synthetic schema built by hand: it drives the REAL upgrade path a self-hosted
 * instance actually takes — `src/prisma/sync-schema.ts`'s own `syncDatabaseSchema()` — against a
 * database seeded the way `sync-schema.ts`'s own header describes a real pre-v1.4.4a install
 * ("every self-hosted instance has been running on `prisma db push` since v1.4.4a"): `db push
 * --schema schema-v1.4.4a.prisma` first, ordinary `INSERT`s using ONLY the columns that existed at
 * that schema (`description`, not `name`; no `issuedAt`/`kind`/`buyerReference`), then
 * `syncDatabaseSchema()` itself — which baselines the 23 confirmed-live v1.4.4a migrations and runs
 * every migration AFTER them for real, this backfill included, exactly like a real self-hosted
 * upgrade would.
 *
 * ## Gating
 *
 * Same convention as `migration-fresh-schema.spec.ts` (`MIGRATION_FRESH_TESTS=1`) and the queue specs
 * (`DOCUMENTS_QUEUE_REDIS_TESTS=1`): one opt-in flag, `DATABASE_URL` already present, no external
 * credentials. A bare offline `npm test` always skips this (no `DATABASE_URL` in that job — see
 * `backend-tests` in `.github/workflows/cypress.yml`), but the flag is what actually decides it.
 *
 * Run locally:
 *   cd backend && BACKFILL_PROBE_TESTS=1 npx jest backfill-legacy-documents --forceExit
 *
 * ## The throwaway database
 *
 * Named `invoicerr_backfill_probe_<pid>` — the exact prefix this task was told to use, with
 * `process.pid` for the same "unique enough, human-traceable, never collides with a concurrent run"
 * reason `migration-fresh-schema.spec.ts` already documents in full for its own throwaway database.
 * `assertThrowawayName` is the same non-negotiable guard-rail, copied rather than imported so this
 * file never has to widen that other spec's own module surface just to reuse one guard: the one thing
 * that must never happen is either spec's CREATE/DROP DATABASE reaching `invoicerr_dev`/`invoicerr_db`.
 *
 * `syncDatabaseSchema()` itself is loaded via a runtime `require`, AFTER `process.env.DATABASE_URL`
 * is pointed at the throwaway database and AFTER `jest.resetModules()` — `src/prisma/prisma.service.ts`
 * reads `process.env.DATABASE_URL` exactly once, at module-evaluation time (`new PrismaPg({
 * connectionString: process.env.DATABASE_URL })`), so a plain top-level `import` would freeze onto
 * whatever `DATABASE_URL` this test FILE happened to load under (jest's per-file module registry)
 * rather than the throwaway one this spec creates in `beforeAll`.
 */
import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

/**
 * Copied from `sync-schema.ts#V1_4_4A_BASELINE_MIGRATIONS` — that list is documented there as
 * FROZEN ("never add to it"), which is what makes copying it here safe rather than a drift risk: a
 * list that can genuinely never change again is not the kind of duplication that rots. Applied here
 * as PLAIN SQL, directly via `psql` (never `prisma db push`/`migrate dev`/`migrate resolve` against
 * an as-yet-untracked database), to build the exact v1.4.4a-era schema shape without depending on
 * `prisma db push` at all — see this file's own header on why: Prisma 7 refuses to run `db push`
 * "invoked by Claude Code" without a live, explicit human confirmation this non-interactive spec
 * cannot obtain, a guard this file does not attempt to route around. `migrate resolve --applied` is
 * run for each of these below (matching exactly what `sync-schema.ts#baselineIfNeeded` itself would
 * do) so that by the time the REAL `syncDatabaseSchema()` runs, `migrationsTableExists()` is already
 * true and its own `baselineIfNeeded()` — which is what would otherwise call `db push` — returns
 * immediately without doing so, exactly like a self-hosted install that has already gone through
 * that one-time leveling would look on its NEXT upgrade. What this does not exercise is
 * `baselineIfNeeded()`'s own `db push` branch itself — untouched, pre-existing code this task did not
 * write — only the backfill this task DID write, which only ever runs from `migrate deploy` either way.
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

const backfillProbeTestsEnabled = process.env.BACKFILL_PROBE_TESTS === '1';
const describeGated = backfillProbeTestsEnabled ? describe : describe.skip;

// `db push` + baselining 23 migrations one by one + `migrate deploy` replaying ~79 more (including
// every intervening schema evolution between v1.4.4a and HEAD) genuinely takes longer than a single
// `migrate deploy` on an empty database (`migration-fresh-schema.spec.ts`'s own 120s budget) — this
// is that same cold-start cost PLUS the baseline loop's own ~23 subprocess spawns.
jest.setTimeout(180_000);

const BACKEND_ROOT = join(__dirname, '..', '..');
const THROWAWAY_DB_PREFIX = 'invoicerr_backfill_probe_';

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

describeGated('20260829233000 backfill — Invoice/Quote history survives the drop', () => {
  const dbName = `${THROWAWAY_DB_PREFIX}${process.pid}`;
  assertThrowawayName(dbName);

  let adminClient: Client | undefined;
  let throwawayUrl: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'BACKFILL_PROBE_TESTS=1 requires DATABASE_URL — the admin connection (CREATE/DROP DATABASE) ' +
          'is derived from it by swapping the path to /postgres.',
      );
    }
    const baseUrl = new URL(process.env.DATABASE_URL);

    adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') });
    await adminClient.connect();

    assertThrowawayName(dbName);
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE "${dbName}"`);

    throwawayUrl = withDatabase(baseUrl, dbName);

    // Step 1: rebuild the legacy scenario — replay the 23 confirmed-live v1.4.4a migrations as PLAIN
    // SQL (never `prisma db push`, see this file's own header), which leaves the database in the
    // exact same shape `db push --schema schema-v1.4.4a.prisma` would.
    const migrationsDir = join(BACKEND_ROOT, 'prisma', 'migrations');
    const replayClient = new Client({ connectionString: throwawayUrl });
    await replayClient.connect();
    try {
      for (const migration of V1_4_4A_BASELINE_MIGRATIONS) {
        const sql = readFileSync(join(migrationsDir, migration, 'migration.sql'), 'utf8');
        await replayClient.query(sql);
      }
    } finally {
      await replayClient.end();
    }

    // Then mark each of those 23 as applied — exactly what `baselineIfNeeded()` itself does, so that
    // once the real `syncDatabaseSchema()` runs below, `migrationsTableExists()` is already true and
    // its own `db push` branch is never entered (see this file's header).
    for (const migration of V1_4_4A_BASELINE_MIGRATIONS) {
      execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', migration], {
        cwd: BACKEND_ROOT,
        env: { ...process.env, DATABASE_URL: throwawayUrl },
        stdio: 'inherit',
      });
    }

    const seedClient = new Client({ connectionString: throwawayUrl });
    await seedClient.connect();
    try {
      await seedClient.query(`
        INSERT INTO "PDFConfig" (id) VALUES ('pdf-config-1');
        INSERT INTO "Company" (id, name, currency, "foundedAt", address, "postalCode", city, country, phone, email, "pDFConfigId")
        VALUES ('company-1', 'Acme SARL', 'EUR', now(), '1 rue de Paris', '75001', 'Paris', 'France', '+33100000000', 'acme@example.com', 'pdf-config-1');

        -- v1.4.4a's "Client" is still single-tenant: no "companyId" column at all (multi-company
        -- support was only added later, by $20260705120000_add_multi_company_schema).
        INSERT INTO "Client" (id, name, address, "postalCode", city, country)
        VALUES ('client-1', 'Client Corp', '2 avenue de Lyon', '69000', 'Lyon', 'France');

        INSERT INTO "Quote" (id, "clientId", "companyId", "totalHT", "totalVAT", "totalTTC", currency, status, "createdAt", "updatedAt", notes)
        VALUES ('quote-1', 'client-1', 'company-1', 100, 20, 120, 'EUR', 'SENT', now() - interval '10 days', now() - interval '9 days', 'A quote');

        INSERT INTO "QuoteItem" (id, "quoteId", description, quantity, "unitPrice", "vatRate", "order")
        VALUES ('quote-item-1', 'quote-1', 'Consulting', 2, 50, 20, 0);

        -- Invoice 1: SENT, raised from the quote above, two lines.
        INSERT INTO "Invoice" (id, "clientId", "companyId", "quoteId", "totalHT", "totalVAT", "totalTTC", currency, status, "createdAt", "updatedAt", "dueDate", notes)
        VALUES ('invoice-1', 'client-1', 'company-1', 'quote-1', 300, 60, 360, 'EUR', 'SENT', now() - interval '8 days', now() - interval '7 days', now() + interval '22 days', 'Thanks for your business');

        INSERT INTO "InvoiceItem" (id, "invoiceId", description, quantity, "unitPrice", "vatRate", "order")
        VALUES
          ('invoice-1-item-1', 'invoice-1', 'Consulting', 2, 50, 20, 0),
          ('invoice-1-item-2', 'invoice-1', 'Support', 1, 200, 20, 1);

        -- Invoice 2: UNPAID (v1.4.4a's InvoiceStatus has no DRAFT/CANCELLED value at all — a real
        -- pre-v1.4.4a install could never have had a "draft" invoice row), standalone, one line.
        INSERT INTO "Invoice" (id, "clientId", "companyId", "totalHT", "totalVAT", "totalTTC", currency, status, "createdAt", "updatedAt", "dueDate", notes)
        VALUES ('invoice-2', 'client-1', 'company-1', 500, 100, 600, 'EUR', 'UNPAID', now() - interval '1 days', now() - interval '1 days', now() + interval '29 days', '');

        INSERT INTO "InvoiceItem" (id, "invoiceId", description, quantity, "unitPrice", "vatRate", "order")
        VALUES ('invoice-2-item-1', 'invoice-2', 'Website redesign', 1, 500, 20, 0);
      `);
    } finally {
      await seedClient.end();
    }
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    try {
      if (adminClient) {
        assertThrowawayName(dbName);
        await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      }
    } finally {
      await adminClient?.end();
    }
  });

  it('carries every invoice/quote across as a DocumentInstance, then the fresh-install path still works', async () => {
    const before = new Client({ connectionString: throwawayUrl });
    await before.connect();
    let beforeCounts: { invoices: string; invoice_items: string; quotes: string; quote_items: string };
    try {
      const { rows } = await before.query(
        `SELECT
           (SELECT count(*) FROM "Invoice") AS invoices,
           (SELECT count(*) FROM "InvoiceItem") AS invoice_items,
           (SELECT count(*) FROM "Quote") AS quotes,
           (SELECT count(*) FROM "QuoteItem") AS quote_items`,
      );
      beforeCounts = rows[0];
    } finally {
      await before.end();
    }
    expect(beforeCounts).toEqual({ invoices: '2', invoice_items: '3', quotes: '1', quote_items: '1' });

    // Step 2: run the REAL upgrade path — baseline the v1.4.4a migrations, then `migrate deploy`
    // every migration after them for real, backfill included.
    //
    // `sync-schema.ts#runPrisma` spawns its `npx prisma ...` subprocesses via `execFileSync` with NO
    // explicit `env` — relying on Node's documented default ("env: process.env"). Verified in
    // isolation (a throwaway one-line jest spec, since deleted) that under THIS repo's ts-jest setup
    // specifically, that default does NOT track a `process.env.X = ...` mutation made from inside a
    // jest test the way a plain Node script does (confirmed the plain-Node case works with the exact
    // same code, outside jest) — the child sees the ORIGINAL `.env`-loaded value, not the throwaway
    // one this test just set, so `runPrisma`'s own subprocess would silently run `migrate deploy`
    // against `invoicerr_dev` instead. Rather than change `runPrisma` itself (real, shipped code this
    // task did not touch, and correct in every OTHER context), this wraps `child_process.execFileSync`
    // for the lifetime of this one test so a call with no explicit `env` gets today's live
    // `process.env` filled in — restoring the behavior `runPrisma`'s own author reasonably expected.
    jest.doMock('child_process', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const actual = jest.requireActual('child_process');
      return {
        ...actual,
        execFileSync: (...callArgs: unknown[]) => {
          const options = (callArgs[2] as Record<string, unknown> | undefined) ?? {};
          const patched = { ...options, env: options.env ?? process.env };
          return (actual as { execFileSync: (...a: unknown[]) => unknown }).execFileSync(
            callArgs[0],
            callArgs[1],
            patched,
          );
        },
      };
    });

    process.env.DATABASE_URL = throwawayUrl;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { syncDatabaseSchema } = require('./sync-schema') as typeof import('./sync-schema');
    await syncDatabaseSchema();

    const after = new Client({ connectionString: throwawayUrl });
    await after.connect();
    try {
      // Step 3: the source tables are gone — this migration's own DROP TABLE statements ran right
      // after the backfill, in the same script.
      const { rows: regclassRows } = await after.query<{ exists: string | null }>(
        `SELECT to_regclass('"Invoice"')::text AS exists`,
      );
      expect(regclassRows[0].exists).toBeNull();

      const { rows: docs } = await after.query<{
        id: string;
        typeId: string;
        status: string;
        data: Record<string, unknown>;
      }>(`SELECT id, "typeId", status, data FROM "DocumentInstance" ORDER BY id`);

      expect(docs).toHaveLength(3);

      const invoice1 = docs.find((d) => d.id === 'invoice-1')!;
      expect(invoice1.typeId).toBe('invoice');
      expect(invoice1.status).toBe('sent'); // old InvoiceStatus.SENT -> new 'sent'
      expect(invoice1.data.client).toBe('client-1');
      expect(invoice1.data.origin).toEqual({ entity: 'quote', id: 'quote-1' });
      expect(invoice1.data.currency).toBe('EUR');
      expect(invoice1.data.clientReference).toBeUndefined(); // buyerReference was never set
      expect(invoice1.data.notes).toBe('Thanks for your business');
      expect(invoice1.data.legacyStatus).toBe('SENT');
      const invoice1Lines = invoice1.data.lines as Array<Record<string, unknown>>;
      expect(invoice1Lines).toHaveLength(2);
      expect(invoice1Lines[0]).toMatchObject({
        description: 'Consulting',
        quantity: 2,
        unit: 'C62',
        unitPrice: 50,
        vatRate: '20',
        discountPercent: 0,
      });
      expect(typeof invoice1Lines[0].$rowId).toBe('string');
      expect((invoice1Lines[0].$rowId as string).length).toBeGreaterThan(0);
      expect(invoice1Lines[1]).toMatchObject({ description: 'Support', quantity: 1, unitPrice: 200 });

      const invoice2 = docs.find((d) => d.id === 'invoice-2')!;
      expect(invoice2.typeId).toBe('invoice');
      expect(invoice2.status).toBe('sent'); // old InvoiceStatus.UNPAID -> new 'sent' (no draft/cancel signal)
      expect(invoice2.data.legacyStatus).toBe('UNPAID');
      expect(invoice2.data.origin).toBeUndefined(); // no quoteId on this one
      const invoice2Lines = invoice2.data.lines as Array<Record<string, unknown>>;
      expect(invoice2Lines).toHaveLength(1);
      expect(invoice2Lines[0]).toMatchObject({
        description: 'Website redesign',
        quantity: 1,
        unitPrice: 500,
      });

      const quote1 = docs.find((d) => d.id === 'quote-1')!;
      expect(quote1.typeId).toBe('quote');
      expect(quote1.status).toBe('sent'); // old QuoteStatus.SENT -> new 'sent'
      expect(quote1.data.client).toBe('client-1');
      expect(quote1.data.currency).toBe('EUR');
      const quoteLines = quote1.data.lines as Array<Record<string, unknown>>;
      expect(quoteLines).toHaveLength(1);
      expect(quoteLines[0]).toMatchObject({
        description: 'Consulting',
        quantity: 2,
        unitPrice: 50,
        vatRate: '20',
      });
    } finally {
      await after.end();
    }
  });
});
