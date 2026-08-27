# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Four independent npm projects (no workspace root — each has its own `package.json` / `node_modules`):

| Dir | Stack | Purpose |
| --- | --- | --- |
| `backend/` | NestJS 11 + Prisma 7 (Postgres) + BullMQ | REST API (`/api`), compliance engine, queue worker |
| `frontend/` | React 19 + Vite 7 + TanStack Query + Tailwind 4 | SPA, file-based routes via generouted |
| `e2e/` | Cypress 15 | End-to-end + per-country business scenarios |
| `documentation/` | Docusaurus 3 | Public docs + the 100+ per-country compliance specs |

## Commands

All commands are run from inside the relevant project directory.

### Backend
```bash
npm install
npx prisma generate            # required before build/test — client lands in prisma/generated/prisma
npm run start:dev              # watch mode, :3000
npm run start:test             # loads .env.test (:4000, DB on :5433) — what e2e expects
npm run build                  # nest build. Use this (or tsc -b) to verify, NOT tsc --noEmit
npm run lint                   # biome check .   (lint:fix to autofix, format to format)
npm test                       # jest, all *.spec.ts under src/
npx jest src/compliance/engine/tax-matrix.spec.ts     # a single file
npm test -- -t "OSS destination rate"                 # a single test by name
npx prisma migrate dev                                # create + apply a migration
```

### Frontend
```bash
npm run dev                    # :5173
npm run start:test             # loads .env.test (:6284, backend at :4000)
npm run build                  # tsc -b && vite build
npm run lint
npm run i18n:check             # fails if a used t() key is missing from locales/en
```

### E2E (needs backend on :4000, frontend on :6284, Postgres :5433, Redis :6379, Mailpit :1025/:8025)
```bash
cd e2e && npm ci
npm run e2e:run                # the numbered suites (cypress/e2e/*.cy.ts)
npx cypress run --spec "cypress/e2e/07-invoices.cy.ts"
CYPRESS_scenario=fr-be npx cypress run --spec "cypress/e2e/scenarios/full-lifecycle.cy.ts"
```

### CI (`.github/workflows/`)
- `cypress.yml` ("Tests", on PR) — biome lint, i18n check, backend jest, a **queue-integration** job
  (real Redis + Postgres, runs `compliance/nest/queue/__tests__`), and the Cypress run.
- `scenarios.yml` ("Business Scenarios", on PR) — matrix `fr-be de-fr it-it es-pt mx-us us-us`, each
  driving `scenarios/full-lifecycle.cy.ts` against a real stack.
- `compliance-live.yml` — real-API round-trips, `workflow_dispatch` only. See `LIVE_TESTING.md`.

## Architecture

### Backend layering
`Controller → Service → Prisma`. Controllers never touch Prisma and never use `any`; they only
declare Swagger metadata and delegate. Multi-tenancy is enforced by the `@ActiveCompany()` param
decorator (throws 403 if no active company) — nearly every service method takes `companyId` first
and scopes its queries by it. `AuthGuard` + `RolesGuard` are global `APP_GUARD`s; `@Public()` opts
out, `@Roles()` gates by `CompanyRole`. Auth is better-auth (`src/lib/auth.ts`) with an API-key
fallback in `AuthGuard`; the library's own guard is disabled in `app.module.ts` because it does not
know about API keys.

**Never `import type` for a class used as a DI token** — the type-only import is erased and Nest
resolves `undefined`. Biome's `useImportType` is deliberately `off` in `backend/biome.json` for this
reason. Booting the app is the real check that DI is wired.

`prisma` is imported as a singleton default export from `@/prisma/prisma.service`; multi-write
operations go through `prisma.$transaction`.

### Prisma / migrations
Generated client is committed to `backend/prisma/generated/prisma` and imported via relative paths
(`../../prisma/generated/prisma/client`). Self-hosted instances ran `db push` until v1.4.4a, so
`src/prisma/sync-schema.ts` (invoked from `main.ts` only in production, API role only) levels legacy
DBs to the frozen `schema-v1.4.4a.prisma`, baselines the frozen migration list, then runs
`migrate deploy`. That baseline list is frozen — never add to it; new migrations must actually run.

### The compliance module (`backend/src/compliance/`) — the core of this branch
Design doc: `documentation/compliance/COMPLIANCE_ARCHITECTURE.md` (§14 = directory map).
Lifecycle doc: `documentation/compliance/COMPLIANCE_LIFECYCLE.md`. Status: `COMPLIANCE_STATUS.md`
and the root `COMPLIANCE_TODO.md`.

The governing principle is **a country is data**. No business code names a country:

```
TransactionContext ──► engine/compliance-engine.resolve() ──► CompliancePlan
                          (reads profiles/data/*.ts, temporal by issue date)
                                        │
                          execution/executor.process():
                          totals → number → build → sign → regime → transmit → archive → report
```

- `profiles/` — declarative `CountryComplianceProfile`s, all temporal (`validFrom`/`validTo`),
  built mostly from `archetypes.ts`; 5 bespoke (FR, IT, PL, MX, US). Monaco delegates to FR; unknown
  countries hit `fallback.ts` with `confidence: UNVERIFIED`. `coverage.spec.ts` reads
  `documentation/compliance/*.md` and fails if a documented country has no profile;
  `data-integrity.spec.ts` fails if a referenced syntax or channel `providerId` doesn't resolve.
- `engine/tax-engine.ts` — cross-border tax by **composing** two profiles (never an N×N matrix).
- `providers/{format,signing,transmission,archive}/` — capability layers behind registries. Adding a
  jurisdiction means adding a profile plus, at most, one strategy.
- `lifecycle/` — the graph is *assembled* per plan (`assembler.ts`), then interpreted by
  `runtime.ts`, which consumes **signals** (`COMMAND`, `AUTHORITY_ACK`, `POLL_RESULT`,
  `INBOUND_STATUS`, `TIMER_ELAPSED`) and emits **effects** (`SCHEDULE_POLL`, `ARM_TIMER`,
  `AWAIT_CALLBACK`). Status is a projection of an append-only event log, not a mutated column.
- `operations/compliance-service.ts` — one method per lifecycle operation; the facade
  `InvoicesService` calls.
- `reception/` — inbound direction (we are the recipient).

`invoices.service.ts` stays orchestration: build the context (`invoices.helpers.ts`), resolve the
plan, drive the runtime. Note `issueInvoice` **re-runs tax resolution at issuance** rather than
trusting draft-time stored totals, and hard-blocks when the buyer country is unresolved.

### Nest wiring of compliance (three modules, deliberately split)
- `ComplianceCoreModule` — providers only (stores, registries with credentials, executor,
  `ApplySignalService`, `InboxPoller`). No controllers, so the worker can reuse the exact instances.
- `ComplianceModule` — controllers + controller-only services; imports Core and **re-exports the
  whole module** (Nest can't re-export an individual token provided by an imported module), so
  `InvoicesModule` can inject Core tokens.
- `ComplianceWorkerModule` — the BullMQ `@Processor()`s. There are no crons or distributed locks;
  repeatable jobs + deterministic `jobId`s do the deduping.

### Deployment topology
One image, two roles. `entrypoint.sh` switches on `ROLE`: default `api` runs nginx + `main.js`;
`ROLE=worker` runs `worker.js` (Nest application context, health check on :3001, no migrations).
`WORKER_INLINE` (default true) controls whether the API also imports `ComplianceWorkerModule` —
`docker-compose.scale.yml` sets it to `false` and scales dedicated workers. Redis is required for
the backend to boot at all, which is why every CI job that starts the backend provisions one.

### Frontend
Routes are file-based (`@generouted/react-router`): `src/pages/(app)/…` behind `_layout.tsx`,
`src/pages/auth/…` public; `src/router.ts` is **generated — do not edit**. Data access is
`useApiQuery` / `useApiMutation` (`hooks/use-api-query.ts`) over `authenticatedFetch`
(`hooks/use-fetch.ts`, `credentials: "include"`, redirects to `/auth/sign-in` on 401); per-domain
hooks live in `hooks/queries/`. UI is shadcn-style Radix primitives in `components/ui`. All
user-facing strings go through `t()` with the key defined in `src/locales/en/translation.json` —
other locales are Weblate-managed, `npm run i18n:check` gates PRs.

## Conventions

- **Biome is the only linter/formatter.** Backend: single quotes, semicolons always, 110 cols.
  Frontend: double quotes, semicolons as-needed, 110 cols. CI runs `biome ci .` (no writes).
- Tests are colocated `*.spec.ts` next to the code. `*.live.spec.ts` hit real external APIs and
  self-gate via `liveDescribe(FLAG, [ENV_VARS])` (`providers/transmission/live-gate.ts`): skipped
  unless the flag is `1` **and** every credential var is set. A gated spec that passes with mocks
  proves nothing about the integration — see `LIVE_TESTING.md` before claiming a channel works.
- Path alias `@/` → `src/` in both projects (backend also in the jest `moduleNameMapper`).
- Comments in this codebase carry decisions and their rationale (why a guard exists, why a module is
  split). Preserve them when refactoring; match that density when adding non-obvious code.

## Reference docs

- `documentation/compliance/COMPLIANCE_ARCHITECTURE.md` — the design RFC.
- `documentation/compliance/COMPLIANCE_LIFECYCLE.md` — phases × drivers × event-sourced runtime.
- `COMPLIANCE_TODO.md` (FR) — exhaustive done/remaining board per channel and format.
- `LIVE_TESTING.md` — required secrets and how to run each real round-trip.
- `CREDENTIALS_GUIDE.md`, `PEPPOL_AP_RESEARCH.md` — per-authority onboarding notes.
- `documentation/docs/developer-guide/` — plugin system, webhooks, MCP server, auth.
