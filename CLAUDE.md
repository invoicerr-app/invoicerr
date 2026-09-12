# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Four independent npm projects (no workspace root — each has its own `package.json` / `node_modules`):

| Dir | Stack | Purpose |
| --- | --- | --- |
| `backend/` | NestJS 11 + Prisma 7 (Postgres) + BullMQ | REST API (`/api`), the documents module (invoicing + per-country compliance catalogs), queue worker |
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
npx jest src/modules/documents/tax/tax-matrix.spec.ts # a single file
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
npx cypress run --spec "cypress/e2e/21-document-lifecycle.cy.ts"
```

`e2e/cypress/e2e/scenarios/full-lifecycle.cy.ts` — the per-country business-scenario spec — does not
exist in this tree (removed along with the old compliance engine); only its fixture,
`e2e/cypress/fixtures/scenarios.ts`, survives. There is currently no `CYPRESS_scenario=<pair> npx
cypress run --spec "cypress/e2e/scenarios/full-lifecycle.cy.ts"` command to run.

### CI (`.github/workflows/`)
- `cypress.yml` ("Tests", on PR) — biome lint, i18n check, backend jest, a **queue-integration** job
  (real Redis + Postgres, runs `modules/documents/queue/__tests__`), and the Cypress run.
- `scenarios.yml` ("Business Scenarios", on PR) — matrix `fr-pl de-fr it-it pt-de it-pt pl-de` (the
  5-country prune, 2026-09-10, re-pointed fr-be/es-pt/mx-us/us-us onto kept-country pairs — see
  `e2e/cypress/fixtures/scenarios.ts`'s own header for the mapping). Its only step drives
  `cypress/e2e/scenarios/full-lifecycle.cy.ts` — that spec is currently absent (see above), so this
  job cannot pass until it is restored.
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
The generated client lands in `backend/prisma/generated/prisma` and is imported via relative paths
(`../../prisma/generated/prisma/client`). It is **gitignored** (`backend/.gitignore:62`), not
committed — so `npx prisma generate` is required before build/test in any fresh checkout, and a
`git worktree` starts without it (and `generate` itself needs `DATABASE_URL`, so `.env` has to be
in place first). Self-hosted instances ran `db push` until v1.4.4a, so
`src/prisma/sync-schema.ts` (invoked from `main.ts` only in production, API role only) levels legacy
DBs to the frozen `schema-v1.4.4a.prisma`, baselines the frozen migration list, then runs
`migrate deploy`. That baseline list is frozen — never add to it; new migrations must actually run.

### The documents module (`backend/src/modules/documents/`) — the core of this branch
The compliance **engine** this repository used to have — one `CountryComplianceProfile` per country
resolved by `compliance-engine.resolve()` into a `CompliancePlan`, executed by a lifecycle graph
*assembled* per plan — was deleted wholesale in commit `fffbae77` ("refactor!: suppression des
documents légaux et du moteur de conformité", ~298k lines removed), tagged `avant-refonte-documents`
for archaeology. `backend/src/compliance/` (`profiles/`, `engine/`,
`providers/{format,signing,transmission,archive}/`, `lifecycle/`) no longer exists — do not look for
it. What replaced it has a deliberately different shape.

The governing principle survives — **a country is data** — but it is no longer one profile per
country composed by one engine. Instead there are about a dozen narrow, independent catalogs, each
with its own `data/<countryCode>.json`, its own schema (several open with a header explicitly noting
they are "what used to be the removed compliance engine's `CountryComplianceProfile`…" for that one
concern), its own loader, and mostly its own DB mirror + boot-reseed service:

- `country-policy/` — which document **actions** a country allows.
- `country-identifiers/` — which national identifier schemes (SIRET, EIN, VAT…) a party must supply.
- `correction-routes/` — credit-note vs. cancel-and-replace, per country (`cancel-policy.ts`).
- `b2g-routing/` — which transport + format a government buyer requires, per country.
- `transports/channel-policy/` — per-channel mandate rules, evaluated against the invoice's own
  `issueDate`, never the server clock (`mandate.ts`).
- `tax/` — `tax-engine.ts` is the cross-border tax determination engine, composing the seller's and
  buyer's `tax-systems/` catalogs into a per-line `TaxTreatment` (still **composition**, never an N×N
  country-pair matrix); `resolve-invoice-tax.ts` wires it into "send", hard-blocking on an unresolved
  seller or buyer country rather than silently guessing a treatment.
- `vat-rates/` — the seller's own sourced VAT rate catalog (a dropdown's options, not a tax authority).
- `country-fields/` — per-country add/modify/remove overlays on a document type's fields.
- `content-requirements/` — country law requiring a specific EN 16931 field to carry a derivable value.
- `mentions/` — country-mandated free-text legal mentions (BG-1), frozen at issue date.
- `archive/retention/` — retention duration — **France only** today.
- `reporting/` — declarative post-send declaration providers (NAV Hungary, myDATA Greece, AT Portugal).

Every fact in these catalogs carries its own provenance (`kind: 'legal'`, quoting the exact source
text, or `kind: 'unverified'`, with a `resolutionNote`), enforced both when a data file loads and
again at seed time.

**There is no per-country lifecycle graph any more.** The old `lifecycle/` (assembler + event-sourced
runtime, one graph per resolved plan) is gone. What exists is ONE generic, country-blind document
status machine (`descriptors/lifecycle.ts`): a `DocumentTypeDescriptor` declares `statuses` /
`initialStatus`, an action declares `transitions`, `validateLifecycle` checks the declaration at boot,
and `checkTransitionResult` checks every actual write against it. Country nuance survives in exactly
three disconnected places — do not describe a phases/clearance/reporting graph no code assembles:
- `correction-routes/` — which correction path a country allows;
- `conformity/pollers/` — post-send authority status polling, wired per **transport** (pdp, ksef,
  peppol, chorus-pro, anaf, face), not per country;
- `archive/retention/` — retention duration, France only.

`documents.service.ts` is the generic orchestrator every document type shares: `runAction` resolves
the type's descriptor, runs the action's handler, then enforces the lifecycle above. There is no
`InvoicesService` any more — the invoice is one `DocumentTypeDescriptor`
(`descriptors/invoice.descriptor.ts`) registered like every other type, and its own actions
(`actions/invoice-actions.ts`) call `tax/resolve-invoice-tax.ts` at send time rather than trusting a
draft-time stored total.

### Nest wiring of the documents module (two modules, deliberately split)
- `DocumentsCoreModule` — providers only (every registry, `DocumentsService`, the queue dispatcher,
  the boot-reseed services). No controllers, so a worker process can reuse the exact same instances —
  the same split the removed compliance engine's own `ComplianceCoreModule` documented.
- `DocumentsModule` — the HTTP controller plus `DocumentEventsBridge` (SSE); imports Core and
  **re-exports the whole module** (Nest can't re-export an individual token provided by an imported
  module) — the same reason the old `ComplianceModule` re-exported `ComplianceCoreModule`.
- `DocumentsQueueWorkerModule` (`queue/document-queue-worker.module.ts`) — the BullMQ `@Processor()`s,
  importing `DocumentsCoreModule` directly (never `DocumentsModule`, which also carries the HTTP
  controller a worker has no use for). No crons or distributed locks; repeatable jobs + idempotent
  registration do the deduping.

### Deployment topology
One image, two roles. `entrypoint.sh` switches on `ROLE`: default `api` runs nginx + `main.js`;
`ROLE=worker` runs `worker.js` (Nest application context, health check on :3001, no migrations).
`WORKER_INLINE` (default true) controls whether the API also imports `DocumentsQueueWorkerModule` —
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
  self-gate via `liveDescribe(FLAG, [ENV_VARS])` (`modules/documents/transports/live-gate.ts`):
  skipped unless the flag is `1` **and** every credential var is set. A gated spec that passes with
  mocks proves nothing about the integration — see `LIVE_TESTING.md` before claiming a channel works.
- Path alias `@/` → `src/` in both projects (backend also in the jest `moduleNameMapper`).
- Comments in this codebase carry decisions and their rationale (why a guard exists, why a module is
  split). Preserve them when refactoring; match that density when adding non-obvious code.

## Reference docs

- `documentation/compliance/COMPLIANCE_ARCHITECTURE.md`, `COMPLIANCE_LIFECYCLE.md`,
  `COMPLIANCE_STATUS.md`, `COMPLIANCE_BUILD_ORDER.md` — retired 2026-08-29: each is now a short
  pointer noting the v1 engine they described was removed, and referring back to the catalogs
  documented above plus tag `avant-refonte-documents` for anyone doing archaeology.
- `COMPLIANCE_TODO.md` (FR) — exhaustive done/remaining board per channel and format.
- `LIVE_TESTING.md` — required secrets and how to run each real round-trip.
- `CREDENTIALS_GUIDE.md`, `PEPPOL_AP_RESEARCH.md` — per-authority onboarding notes.
- `documentation/docs/developer-guide/` — plugin system, webhooks, MCP server, auth.
