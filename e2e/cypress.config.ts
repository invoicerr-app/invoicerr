import { defineConfig } from "cypress";
import { Client } from "pg";

export default defineConfig({
  // The suite runs 15 specs back to back in one CI job with video capture on, which
  // grows the Electron renderer's heap until it crashes ("Renderer process just
  // crashed", seen on 14-articles). Both settings below are Cypress' own remedy:
  // release each spec's memory instead of keeping every test's DOM snapshots around.
  experimentalMemoryManagement: true,
  numTestsKeptInMemory: 0,
  e2e: {
    video: true,
    experimentalStudio: true,
    baseUrl: process.env.FRONTEND_URL || "http://localhost:6284",
    specPattern: "cypress/e2e/**/*.cy.{js,ts}",
    supportFile: "cypress/support/e2e.ts",
    env: {
      apiUrl: process.env.VITE_BACKEND_URL || "http://localhost:4000",
    },
    setupNodeEvents(on) {
      on("task", {
        // `prisma migrate reset --force` used to run here, but it DROPS and recreates
        // the whole schema while the backend is still running and holding pooled
        // connections — the backend's own logger writes to `Log` on every request, so
        // that drop raced with in-flight queries and broke every spec at the auth step
        // (Postgres logged `relation "public.Log" does not exist`). Truncating the
        // existing tables clears the data without ever touching the schema.
        async resetDatabase() {
          const client = new Client({
            connectionString:
              process.env.DATABASE_URL ||
              "postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db?schema=public",
          });
          await client.connect();
          // No catch below on purpose: a failed reset must throw and fail the spec
          // loudly instead of returning null and surfacing as a confusing error later.
          // The `finally` only guarantees the connection is closed either way.
          try {
            // Read the table list from Postgres instead of hardcoding it so this
            // doesn't silently drift when the Prisma schema gains new models.
            const { rows } = await client.query(
              `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`,
            );
            if (rows.length === 0) {
              return null;
            }
            const tables = rows.map((row: { tablename: string }) => `"${row.tablename}"`).join(", ");
            // RESTART IDENTITY resets serial/identity sequences back to their seed;
            // CASCADE follows foreign keys so table order doesn't matter.
            await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
            return null;
          } finally {
            await client.end();
          }
        },

        /**
         * F-008 — put an invoice into an authority-failure state so the SCREEN can be asserted.
         *
         * Driving this through a real authority is impossible offline: no channel has credentials
         * in CI, which is the whole of F-009/F-013. The backend projection that writes these rows
         * is covered by 19 jest tests in apply-signal-reject-projection.spec.ts; what no jest test
         * can cover is whether the invoice list and detail view actually SHOW the failure, which is
         * the finding. So this task writes exactly what ApplySignalService writes — the invoice
         * status, plus a compliance document carrying the authority's wording on its event — and
         * the spec asserts what the user sees.
         *
         * It writes the same shape, not a convenient one: if the projection's output changes, this
         * task has to change with it, and the spec fails until it does.
         */
        async failLastInvoice({ status, detail }: { status: string; detail: string }) {
          const client = new Client({
            connectionString:
              process.env.DATABASE_URL ||
              "postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db?schema=public",
          });
          await client.connect();
          try {
            const { rows } = await client.query(
              `SELECT id FROM "Invoice" ORDER BY "createdAt" DESC LIMIT 1`,
            );
            if (rows.length === 0) throw new Error("failLastInvoice: no invoice to fail");
            const invoiceId = rows[0].id as string;
            const documentId = `e2e-doc-${invoiceId}`;

            await client.query(`UPDATE "Invoice" SET status = $1::"InvoiceStatus" WHERE id = $2`, [
              status,
              invoiceId,
            ]);
            await client.query(
              `INSERT INTO "ComplianceDocument" (id, "invoiceId", status, ctx, "updatedAt")
               VALUES ($1, $2, $3::"ComplianceStatus", '{}'::jsonb, now())
               ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
              [documentId, invoiceId, status],
            );
            await client.query(
              `INSERT INTO "ComplianceEvent" (id, "documentId", type, actor, detail)
               VALUES ($1, $2, 'REJECT', 'system', $3)`,
              [`${documentId}-ev`, documentId, detail],
            );
            return invoiceId;
          } finally {
            await client.end();
          }
        },
      });
    },
  }
});
