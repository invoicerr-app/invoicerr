/**
 * Pins `20260913150000_restore_legacy_numbers_payments_signatures` — the migration that closes the
 * gap `20260829233000_suppression_documents_legaux` deliberately left open (see that migration's own
 * header, and this new one's own header, for the full "why"): at backfill time `DocumentInstance.
 * number`/`displayNumber`, `DocumentPayment` and the documentId-keyed `Signature` table did not exist
 * yet, so the raw facts were parked as undeclared `legacyNumber`/`legacyRawNumber`/`legacyPayments`/
 * `legacySignedAt` keys on `DocumentInstance.data`. This spec proves those keys actually make it back
 * into the real columns/tables on a REAL upgrade, not just in the abstract.
 *
 * Same drive-the-real-upgrade-path discipline as `backfill-legacy-documents.spec.ts` (read that file's
 * own header first — this one copies its proven scaffolding rather than importing it, for the same
 * "never widen another spec's module surface" reason it already states): replay the 23 confirmed-live
 * v1.4.4a migrations as PLAIN SQL, baseline them, seed a v1.4.4a-shaped database by hand, then run the
 * REAL `syncDatabaseSchema()` across every migration after them — this one included.
 *
 * ## What v1.4.4a actually looked like for numbering/payments (not what the brief summarizes)
 *
 * The 23-migration baseline's own `CREATE TABLE "Invoice"`/`"Quote"` still has `"number" SERIAL NOT
 * NULL` (auto-incrementing, never null) — `numbering_overhaul` (`$20260625030000`, run for real,
 * AFTER the baseline) is what converts it to nullable `Int`, preserving every existing value. And
 * there was never a "Payment" table at v1.4.4a at all: it was called "Receipt"/"ReceiptItem"
 * (`$20260624130000_rename_receipt_to_payment` renames it, also for real, after the baseline) — and
 * v1.4.4a's own "Receipt" has no `paidAt` column yet either (`$20260624205245_add_paid_at_to_payment`
 * adds it, `NOT NULL DEFAULT CURRENT_TIMESTAMP` — every pre-existing row gets the SAME timestamp, the
 * exact moment that one `ALTER TABLE` statement ran during THIS test's own `migrate deploy`, which is
 * why this spec asserts amounts/methods/notes exactly but only asserts `paidAt` is a `Date`, not a
 * specific value it does not control). So this spec seeds "Receipt"/"ReceiptItem" — the columns that
 * genuinely existed at v1.4.4a — never "Payment" directly.
 *
 * ## Idempotency (constraint 2 — "run it twice")
 *
 * `migrate deploy` itself never re-runs an already-applied migration, so proving "run it twice" means
 * executing this migration's own SQL file content a SECOND time directly against the post-deploy
 * database (exactly the manual probe this task was built and verified against) — not asking Prisma to
 * replay something it considers already done.
 *
 * Run locally:
 *   cd backend && RESTORE_PROBE_TESTS=1 npx vitest run src/prisma/restore-legacy-numbers-payments-signatures.spec.ts
 */

import { vi } from 'vitest';

import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

import { computeSettlement } from '../modules/documents/settlement/compute-settlement';

// See backfill-legacy-documents.spec.ts's own copy of this same list for why it is safe to copy
// (FROZEN — sync-schema.ts#V1_4_4A_BASELINE_MIGRATIONS states "never add to it").
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

const restoreProbeTestsEnabled = process.env.RESTORE_PROBE_TESTS === '1';
const describeGated = restoreProbeTestsEnabled ? describe : describe.skip;

// Vitest splits Jest's single `setTimeout(ms)` (tests AND hooks) into two fields — both need the same
// budget here since `beforeAll` does the real `db push`/baseline/`migrate deploy` work.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const BACKEND_ROOT = join(__dirname, '..', '..');
// The exact prefix this task was told to use for its own throwaway databases (never
// invoicerr_dev/invoicerr_db) — same non-negotiable guard as backfill-legacy-documents.spec.ts's own
// THROWAWAY_DB_PREFIX, copied rather than imported for the same "never widen another spec's module
// surface" reason.
const THROWAWAY_DB_PREFIX = 'invoicerr_numbers_probe_';

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

describeGated('20260913150000 restore — number/displayNumber, DocumentPayment, Signature', () => {
  const dbName = `${THROWAWAY_DB_PREFIX}${process.pid}`;
  assertThrowawayName(dbName);

  let adminClient: Client | undefined;
  let throwawayUrl: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'RESTORE_PROBE_TESTS=1 requires DATABASE_URL — the admin connection (CREATE/DROP DATABASE) is ' +
          'derived from it by swapping the path to /postgres.',
      );
    }
    const baseUrl = new URL(process.env.DATABASE_URL);

    adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') });
    await adminClient.connect();

    assertThrowawayName(dbName);
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE "${dbName}"`);

    throwawayUrl = withDatabase(baseUrl, dbName);

    // Step 1: replay the 23 confirmed-live v1.4.4a migrations as plain SQL (never `prisma db push` —
    // see backfill-legacy-documents.spec.ts's own header on why).
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

    for (const migration of V1_4_4A_BASELINE_MIGRATIONS) {
      execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', migration], {
        cwd: BACKEND_ROOT,
        env: { ...process.env, DATABASE_URL: throwawayUrl },
        stdio: 'inherit',
      });
    }

    // Step 2: seed a v1.4.4a-shaped install by hand — one company, one client, a SIGNED quote (with
    // number/rawNumber/signedAt/signedBy), and TWO invoices each carrying a number/rawNumber and a
    // recorded "Receipt" (the v1.4.4a name for what becomes "Payment" — see this file's own header).
    const seedClient = new Client({ connectionString: throwawayUrl });
    await seedClient.connect();
    try {
      await seedClient.query(`
        INSERT INTO "PDFConfig" (id) VALUES ('pdf-config-1');
        INSERT INTO "Company" (id, name, currency, "foundedAt", address, "postalCode", city, country, phone, email, "pDFConfigId")
        VALUES ('company-1', 'Acme SARL', 'EUR', now(), '1 rue de Paris', '75001', 'Paris', 'France', '+33100000000', 'acme@example.com', 'pdf-config-1');

        INSERT INTO "Client" (id, name, address, "postalCode", city, country)
        VALUES ('client-1', 'Client Corp', '2 avenue de Lyon', '69000', 'Lyon', 'France');

        -- Quote 1: SIGNED, its own number/rawNumber, and the signature audit trail
        -- (signedAt/signedBy) the parent migration preserves as legacySignedAt/legacySignedBy.
        INSERT INTO "Quote" (id, "rawNumber", "clientId", "companyId", "totalHT", "totalVAT", "totalTTC", currency, status, "createdAt", "updatedAt", notes, "validUntil", "signedAt", "signedBy")
        VALUES ('quote-1', 'Q-2025-0001', 'client-1', 'company-1', 100, 20, 120, 'EUR', 'SIGNED', now() - interval '20 days', now() - interval '15 days', 'A quote', now() + interval '10 days', now() - interval '15 days', 'Jane Doe');

        INSERT INTO "QuoteItem" (id, "quoteId", description, quantity, "unitPrice", "vatRate", "order")
        VALUES ('quote-item-1', 'quote-1', 'Consulting', 2, 50, 20, 0);

        -- Invoice 1: raised from the quote, its own number/rawNumber, PARTIALLY paid.
        INSERT INTO "Invoice" (id, "rawNumber", "clientId", "companyId", "quoteId", "totalHT", "totalVAT", "totalTTC", currency, status, "createdAt", "updatedAt", "dueDate", notes)
        VALUES ('invoice-1', 'INV-2025-0001', 'client-1', 'company-1', 'quote-1', 300, 60, 360, 'EUR', 'SENT', now() - interval '10 days', now() - interval '9 days', now() + interval '20 days', 'Thanks for your business');

        INSERT INTO "InvoiceItem" (id, "invoiceId", description, quantity, "unitPrice", "vatRate", "order")
        VALUES ('invoice-1-item-1', 'invoice-1', 'Consulting', 2, 50, 20, 0),
               ('invoice-1-item-2', 'invoice-1', 'Support', 1, 200, 20, 1);

        INSERT INTO "Receipt" (id, "invoiceId", "totalPaid", "paymentMethod", "paymentDetails", "createdAt", "updatedAt")
        VALUES ('payment-1', 'invoice-1', 200.00, 'Bank Transfer', 'IBAN FR7612345', now() - interval '5 days', now() - interval '5 days');

        INSERT INTO "ReceiptItem" (id, "invoiceItemId", "amountPaid", "receiptId")
        VALUES ('payment-1-item-1', 'invoice-1-item-1', 120, 'payment-1'),
               ('payment-1-item-2', 'invoice-1-item-2', 80, 'payment-1');

        -- Invoice 2: standalone, its own (higher) number, FULLY paid in one go.
        INSERT INTO "Invoice" (id, "rawNumber", "clientId", "companyId", "totalHT", "totalVAT", "totalTTC", currency, status, "createdAt", "updatedAt", "dueDate", notes)
        VALUES ('invoice-2', 'INV-2025-0002', 'client-1', 'company-1', 500, 100, 600, 'EUR', 'PAID', now() - interval '3 days', now() - interval '1 days', now() + interval '27 days', '');

        INSERT INTO "InvoiceItem" (id, "invoiceId", description, quantity, "unitPrice", "vatRate", "order")
        VALUES ('invoice-2-item-1', 'invoice-2', 'Website redesign', 1, 500, 20, 0);

        INSERT INTO "Receipt" (id, "invoiceId", "totalPaid", "paymentMethod", "paymentDetails", "createdAt", "updatedAt")
        VALUES ('payment-2', 'invoice-2', 600.00, 'Card', '', now() - interval '1 days', now() - interval '1 days');

        INSERT INTO "ReceiptItem" (id, "invoiceItemId", "amountPaid", "receiptId")
        VALUES ('payment-2-item-1', 'invoice-2-item-1', 600, 'payment-2');
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

  it('restores number/displayNumber, DocumentPayment and Signature on a real upgrade, twice', async () => {
    // Step 3: run the REAL upgrade path. Same `execFileSync` env patch as
    // backfill-legacy-documents.spec.ts's own test — see that file's header for the full "why" (ts-jest
    // does not propagate a `process.env` mutation to a bare `execFileSync` the way plain Node does).
    vi.doMock('child_process', async () => {
      const actual = await vi.importActual('child_process');
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
    vi.resetModules();
    // A dynamic import, not a top-level one: it MUST run after the `resetModules()`/`DATABASE_URL`
    // mutation above so the fresh module instance picks up the throwaway connection string — a plain
    // `require('./sync-schema')` fails outright here (Vite's require shim resolves paths literally,
    // no `.ts`-extension fallback the way a static `import` gets), so this goes through `import()`.
    const { syncDatabaseSchema } = await import('./sync-schema.js');
    await syncDatabaseSchema();

    const db = new Client({ connectionString: throwawayUrl });
    await db.connect();
    try {
      // ## Numbers ------------------------------------------------------------------------------
      const { rows: docs } = await db.query<{
        id: string;
        typeId: string;
        status: string;
        number: number | null;
        displayNumber: string | null;
      }>(`SELECT id, "typeId", status, number, "displayNumber" FROM "DocumentInstance" ORDER BY id`);

      expect(docs).toHaveLength(3);
      const invoice1 = docs.find((d) => d.id === 'invoice-1')!;
      const invoice2 = docs.find((d) => d.id === 'invoice-2')!;
      const quote1 = docs.find((d) => d.id === 'quote-1')!;

      expect(invoice1.number).toBe(1);
      expect(invoice1.displayNumber).toBe('INV-2025-0001');
      expect(invoice2.number).toBe(2);
      expect(invoice2.displayNumber).toBe('INV-2025-0002');
      expect(quote1.number).toBe(1);
      expect(quote1.displayNumber).toBe('Q-2025-0001');
      expect(quote1.status).toBe('signed');

      // The per-(company,type) sequence must be able to hand out the NEXT number without colliding
      // with either restored one.
      const { rows: sequences } = await db.query<{ typeId: string; nextNumber: number }>(
        `SELECT "typeId", "nextNumber" FROM "DocumentNumberSequence" WHERE "companyId" = 'company-1' ORDER BY "typeId"`,
      );
      expect(sequences).toEqual(
        expect.arrayContaining([
          { typeId: 'invoice', nextNumber: 3 },
          { typeId: 'quote', nextNumber: 2 },
        ]),
      );

      // ## Payments / settlement balance ---------------------------------------------------------
      const { rows: payments } = await db.query<{
        id: string;
        documentId: string;
        amountMinor: number;
        currency: string;
        documentAmountMinor: number;
        method: string | null;
        note: string | null;
        paidAt: Date;
      }>(`SELECT id, "documentId", "amountMinor", currency, "documentAmountMinor", method, note, "paidAt"
          FROM "DocumentPayment" ORDER BY id`);

      expect(payments).toHaveLength(2);
      const payment1 = payments.find((p) => p.id === 'payment-1')!;
      expect(payment1.documentId).toBe('invoice-1');
      expect(payment1.amountMinor).toBe(20000); // 200.00 EUR -> minor units
      expect(payment1.documentAmountMinor).toBe(20000); // same currency, never converted
      expect(payment1.currency).toBe('EUR');
      expect(payment1.method).toBe('Bank Transfer');
      expect(payment1.note).toBe('IBAN FR7612345');
      expect(payment1.paidAt).toBeInstanceOf(Date);

      const payment2 = payments.find((p) => p.id === 'payment-2')!;
      expect(payment2.documentId).toBe('invoice-2');
      expect(payment2.amountMinor).toBe(60000); // 600.00 EUR -> minor units
      expect(payment2.documentAmountMinor).toBe(60000);
      expect(payment2.method).toBe('Card');
      expect(payment2.note).toBeNull(); // empty-string paymentDetails -> NULL, never invented

      // The actual settlement balance a real "record-payment" read would compute — invoice-1's
      // 360.00 total minus the one restored 200.00 payment leaves 160.00 outstanding; invoice-2's
      // 600.00 total is fully settled by its own single restored payment.
      const invoice1Settlement = computeSettlement(36000, [{ amountMinor: payment1.documentAmountMinor }]);
      expect(invoice1Settlement.outstandingMinor).toBe(16000);
      expect(invoice1Settlement.settled).toBe(false);
      const invoice2Settlement = computeSettlement(60000, [{ amountMinor: payment2.documentAmountMinor }]);
      expect(invoice2Settlement.outstandingMinor).toBe(0);
      expect(invoice2Settlement.settled).toBe(true);

      // ## Signature ------------------------------------------------------------------------------
      const { rows: signatures } = await db.query<{
        documentId: string;
        typeId: string;
        signedAt: Date;
        isActive: boolean;
        tokenHash: string;
      }>(`SELECT "documentId", "typeId", "signedAt", "isActive", "tokenHash" FROM "Signature"`);

      expect(signatures).toHaveLength(1);
      expect(signatures[0].documentId).toBe('quote-1');
      expect(signatures[0].typeId).toBe('quote');
      expect(signatures[0].isActive).toBe(false); // a restored signature is never replayable, exactly
      // like a real markSignatureSigned() write.
      expect(signatures[0].signedAt).toBeInstanceOf(Date);
      expect(typeof signatures[0].tokenHash).toBe('string');
      expect(signatures[0].tokenHash.length).toBeGreaterThan(0);

      // legacySignedBy has no destination column on the new Signature model — it must still be
      // sitting in DocumentInstance.data, never silently dropped.
      const { rows: quoteData } = await db.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM "DocumentInstance" WHERE id = 'quote-1'`,
      );
      expect(quoteData[0].data.legacySignedBy).toBe('Jane Doe');

      // ## Idempotency (constraint 2 — "run it twice") --------------------------------------------
      // `migrate deploy` never re-runs an applied migration, so prove idempotency by executing this
      // migration's own SQL file content a second time, directly — see this file's own header.
      const migrationSql = readFileSync(
        join(
          BACKEND_ROOT,
          'prisma',
          'migrations',
          '20260913150000_restore_legacy_numbers_payments_signatures',
          'migration.sql',
        ),
        'utf8',
      );
      await db.query(migrationSql);

      const { rows: paymentsAfterRerun } = await db.query(`SELECT id FROM "DocumentPayment" ORDER BY id`);
      expect(paymentsAfterRerun).toHaveLength(2); // no duplicate payments

      const { rows: signaturesAfterRerun } = await db.query(`SELECT id FROM "Signature"`);
      expect(signaturesAfterRerun).toHaveLength(1); // no duplicate signature

      const { rows: numbersAfterRerun } = await db.query<{ id: string; number: number }>(
        `SELECT id, number FROM "DocumentInstance" WHERE id IN ('invoice-1', 'invoice-2', 'quote-1') ORDER BY id`,
      );
      expect(numbersAfterRerun).toEqual([
        { id: 'invoice-1', number: 1 },
        { id: 'invoice-2', number: 2 },
        { id: 'quote-1', number: 1 },
      ]); // unchanged, not doubled/incremented

      const { rows: sequencesAfterRerun } = await db.query<{ typeId: string; nextNumber: number }>(
        `SELECT "typeId", "nextNumber" FROM "DocumentNumberSequence" WHERE "companyId" = 'company-1' ORDER BY "typeId"`,
      );
      expect(sequencesAfterRerun).toEqual([
        { typeId: 'invoice', nextNumber: 3 },
        { typeId: 'quote', nextNumber: 2 },
      ]); // the ratchet did not move backward OR forward a second time
    } finally {
      await db.end();
    }
  });
});
