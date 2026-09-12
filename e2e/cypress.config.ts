import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { defineConfig } from "cypress";
import { Client } from "pg";

/**
 * TODO_PRODUIT.md T2 / PLAN-V2 R9 — the "receiver" side for `42-webhooks.cy.ts`. A vanilla
 * `node:http` server, started ONCE for the whole run (module-level state in this Node plugin
 * process — the same process every `on("task", ...)` handler already runs in, see the file's other
 * tasks above), because the backend under test needs a REAL, network-reachable URL to POST to: a
 * `cy.intercept` only ever sees traffic the BROWSER makes, never a server-to-server POST the backend
 * issues on its own (`WebhookDispatcherService` → `GenericDriver` → `fetch`). Same host, same
 * "localhost" reachability every other e2e port already relies on (Postgres :5433, Redis :6399,
 * Mailpit :1025/:8025) — the backend and Cypress run on the SAME machine in this harness, never
 * across a container boundary that would make "localhost" mean something different to each side.
 */
let webhookReceiverUrl: string | null = null;
const receivedWebhookRequests: unknown[] = [];

function startWebhookReceiver(): Promise<string> {
  if (webhookReceiverUrl) return Promise.resolve(webhookReceiverUrl);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          // GenericDriver always sends JSON — an unparsable body would itself be a finding, kept
          // as the raw string rather than swallowed.
        }
        receivedWebhookRequests.push(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      webhookReceiverUrl = `http://127.0.0.1:${address.port}`;
      resolve(webhookReceiverUrl);
    });
  });
}

export default defineConfig({
  // The suite runs 15 specs back to back in one CI job with video capture on, which
  // grows the Electron renderer's heap until it crashes ("Renderer process just
  // crashed", seen on 14-articles). Both settings below are Cypress' own remedy:
  // release each spec's memory instead of keeping every test's DOM snapshots around.
  experimentalMemoryManagement: true,
  numTestsKeptInMemory: 0,
  //
  // Those two settings are NOT enough, and the record should say so rather than leave the next
  // person to re-derive it. With both enabled, the Electron renderer still crashes intermittently:
  // measured across eight runs it hit 17-invoice-rejection, 08-payments and 10-recurring-invoices,
  // at position 2 of 17 as readily as at position 17, and in a three-spec run as readily as a
  // seventeen-spec one. Instrumenting the spec through a Node-side task — the browser console dies
  // with the renderer — put the crash at one exact step: clicking the first option of a Radix
  // select inside a dialog. Same step, three different specs.
  //
  // The same suite on FIREFOX passes: 17/17, including 17-invoice-rejection, which had never once
  // been green under Electron. So this is an Electron/Chromium-headless problem with Radix's
  // select, not a memory budget and not a defect in the specs. Running e2e on Firefox is the known
  // workaround:  ./scripts/e2e-worktree.sh --browser firefox
  //
  // CI now runs FIREFOX for exactly this reason — `.github/workflows/cypress.yml` and
  // `scenarios.yml` both pass `--browser firefox`. Measured 2026-09-12: 18-onboarding-wizard,
  // 25-document-settlement and 29-document-recurrence crash the Electron renderer even when each
  // is run ALONE in a fresh process, and all four of the specs that were red under Electron pass
  // on Firefox 154 with zero renderer crashes. Electron stays the default for a bare local
  // `cypress run`; pass `--browser firefox` to reproduce what CI does.
  e2e: {
    video: true,
    baseUrl: process.env.FRONTEND_URL || "http://localhost:6284",
    specPattern: "cypress/e2e/**/*.cy.{js,ts}",
    supportFile: "cypress/support/e2e.ts",
    env: {
      apiUrl: process.env.VITE_BACKEND_URL || "http://localhost:4000",
    },
    setupNodeEvents(on) {
      on("task", {
        /**
         * Print a step to the RUNNER's stdout, not the browser console.
         *
         * 17-invoice-rejection crashes the Electron renderer partway through its first test, and a
         * crashed renderer takes its console with it — which is why five runs produced the same
         * eleven-line "we detected that the renderer crashed" and nothing about where. A task runs
         * in the Node process, so whatever it printed before the crash survives in the run log.
         */
        logStep(message: string) {
          // eslint-disable-next-line no-console
          console.log(`[step ${new Date().toISOString().slice(11, 23)}] ${message}`);
          return null;
        },
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
            //
            // `DocumentCountryActionRule`, `CountryIdentifierRequirement`, and `B2gRoutingRule` are
            // excluded on purpose, alongside `_prisma_migrations`: all three are REFERENCE data
            // mirrored from backend/src/modules/documents/{country-policy,country-identifiers,
            // b2g-routing}/data/*.json, never per-spec fixture data a test creates and expects
            // wiped. Truncating any of them here would leave the backend running EMPTY until the
            // next reseed: `DocumentCountryActionRule` empty means "a country with no policy rows
            // blocks every document action" (country-policy.ts) — a 403 on every document action in
            // every later spec; `CountryIdentifierRequirement` empty means every country looks like
            // it has NO identifier-requirements file at all (country-identifiers.ts) — the
            // client/company/onboarding identifier fields this task exists to keep visible would
            // silently stop rendering for the rest of the run; `B2gRoutingRule` empty means every
            // government client looks like it has no B2G rule at all (`40-b2g-routing.cy.ts` is the
            // one spec that reads it).
            //
            // HISTORY: until the "seed drift" fix, `DocumentCountryActionRule` and
            // `CountryIdentifierRequirement` were seeded ONLY at migration time
            // (`seedCountryPolicies()`/`seedCountryIdentifierRequirements()` from `prisma/seed.ts`'s
            // `migrations.seed` hook — see prisma.config.ts) — a JSON-only edit to
            // `country-policy/data/*.json` reached neither an already-migrated e2e database nor a
            // simply-restarted dev backend without someone remembering to run `prisma db seed` by
            // hand, and silently 403'd every document action in the meantime (TODO_ISSUES.md's
            // "`resetAndSeed` ne re-sème pas la politique pays"). `B2gRoutingRule` never had that
            // problem: it was always upserted at BACKEND BOOT (`B2gRoutingBootUpsertService`, an
            // `OnModuleInit` — see `schema.prisma`'s own comment on that model). Both other tables
            // now share that EXACT mechanism (`CountryPolicyBootReseedService` /
            // `CountryIdentifierRequirementsBootReseedService`, registered in
            // `documents-core.module.ts` next to `B2gRoutingBootUpsertService` — see each service's
            // own header for the drift-detect-then-reseed logic), so all three tables are excluded
            // from truncation for the SAME reason now: the backend process behind this e2e run
            // booted ONCE, before this task ever runs, and stays running for the whole suite —
            // truncating any of them here would leave it EMPTY until a full backend restart, which
            // nothing in a Cypress run ever triggers. `resetDatabase` no longer needs to TRIGGER a
            // reseed itself (the backend's own boot already did it, unconditionally, before the
            // suite started) — it VERIFIES one actually happened, right below, instead of quietly
            // trusting it and letting a real gap resurface as the exact silent 403 this fix exists
            // to prevent.
            const { rows } = await client.query(
              `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                 AND tablename NOT IN ('_prisma_migrations', 'DocumentCountryActionRule', 'CountryIdentifierRequirement', 'B2gRoutingRule')`,
            );
            if (rows.length > 0) {
              const tables = rows.map((row: { tablename: string }) => `"${row.tablename}"`).join(", ");
              // RESTART IDENTITY resets serial/identity sequences back to their seed;
              // CASCADE follows foreign keys so table order doesn't matter.
              await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
            }

            // Verification, not re-triggering: see the HISTORY note above for why re-seeding from
            // HERE would be the wrong fix (the backend already did it once, at boot, before this
            // suite even started, and stays running the whole run — a second reseed from this Node
            // process would just duplicate logic that already lives in TypeScript on the backend
            // side). An empty reference table at this point means the backend's own boot-time
            // reseed either never ran or failed — exactly the silent-403 failure mode this whole
            // mechanism exists to turn loud, so this throws by name rather than let the next spec
            // discover it as an unexplained 403.
            for (const table of ["DocumentCountryActionRule", "CountryIdentifierRequirement", "B2gRoutingRule"]) {
              const { rows: countRows } = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
              if (countRows[0].count === 0) {
                throw new Error(
                  `resetDatabase: "${table}" is empty after reset — the backend's boot-time reseed ` +
                    "either hasn't run yet or failed. Every document action will 403 for the rest of " +
                    "this run until the backend under test is (re)started with a working reseed.",
                );
              }
            }
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
            // A unique id per call: the same invoice is deliberately driven through several
            // failure states in one spec, and a fixed id collided on the primary key the second
            // time round.
            await client.query(
              `INSERT INTO "ComplianceEvent" (id, "documentId", type, actor, detail)
               VALUES (gen_random_uuid()::text, $1, 'REJECT', 'system', $2)`,
              [documentId, detail],
            );
            return invoiceId;
          } finally {
            await client.end();
          }
        },

        /**
         * Read back everything the compliance layer recorded for one invoice.
         *
         * The transmission reference an authority hands back — for the FR PDP,
         * `"<companyId>|<superpdp invoice id>"` — is on no HTTP response. `POST /api/invoices/send`
         * answers `{ delivered: false }` and nothing else, because the send is queued; the ref
         * arrives later and is written to `ScheduledJob.ref` (the poll job) and to
         * `ComplianceCallbackRegistration.correlationKey`. Neither table is exposed by
         * `GET /api/invoices/:id`.
         *
         * So the only way to assert "the platform really answered, and this is the number it gave"
         * is to read the rows the runtime wrote. That is the FACT; the invoice screen's wording,
         * which lags a queue, is not.
         */
        async complianceRefs(invoiceId: string) {
          const client = new Client({
            connectionString:
              process.env.DATABASE_URL ||
              "postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db?schema=public",
          });
          await client.connect();
          try {
            const { rows: docs } = await client.query(
              `SELECT id, status, number, kind FROM "ComplianceDocument" WHERE "invoiceId" = $1`,
              [invoiceId],
            );
            if (docs.length === 0) return null;
            const documentId = docs[0].id as string;
            const { rows: events } = await client.query(
              `SELECT type, detail, at FROM "ComplianceEvent" WHERE "documentId" = $1 ORDER BY at`,
              [documentId],
            );
            const { rows: jobs } = await client.query(
              `SELECT kind, status, "providerId", ref, awaiting FROM "ScheduledJob" WHERE "documentId" = $1`,
              [documentId],
            );
            const { rows: callbacks } = await client.query(
              `SELECT channel, "correlationKey", awaiting, status FROM "ComplianceCallbackRegistration" WHERE "documentId" = $1`,
              [documentId],
            );
            const { rows: authorityIds } = await client.query(
              `SELECT scheme, value FROM "ComplianceAuthorityId" WHERE "documentId" = $1`,
              [documentId],
            );
            return { ...docs[0], events, jobs, callbacks, authorityIds };
          } finally {
            await client.end();
          }
        },

        // TODO_PRODUIT.md T2 / PLAN-V2 R9 — see this file's own header just above for why a real
        // `node:http` server, not a `cy.intercept`, is what a server-to-server webhook needs.
        startWebhookReceiver() {
          return startWebhookReceiver();
        },
        getWebhookRequests() {
          return [...receivedWebhookRequests];
        },
        clearWebhookRequests() {
          receivedWebhookRequests.length = 0;
          return null;
        },
      });
    },
  }
});
