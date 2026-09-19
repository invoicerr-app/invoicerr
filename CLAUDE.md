# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Four independent npm projects (no workspace root — each has its own `package.json` / `node_modules`):

| Dir | Stack | Purpose |
| --- | --- | --- |
| `backend/` | NestJS 11 + Prisma 7 (Postgres) + BullMQ | REST API (`/api`), the documents module (invoicing + per-country compliance catalogs), queue worker |
| `frontend/` | React 19 + Vite 7 + TanStack Query + Tailwind 4 | SPA, file-based routes via generouted |
| `e2e/` | Cypress 15 | End-to-end + per-country business scenarios |
| `documentation/` | Docusaurus 3 | Public docs + the five in-scope per-country compliance specs |

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
npm test                       # vitest run, all *.spec.ts under src/
npx vitest run src/modules/documents/tax/tax-matrix.spec.ts # a single file
npm test -- -t "OSS destination rate"                        # a single test by name
npx prisma migrate dev                                # create + apply a migration
```

**A `data/xx.json` you ADD while a watcher is running never reaches the running server.**
`nest start --watch` copies the assets declared in `nest-cli.json` once at startup and then watches
the files it already knows for changes; `watchAssets: true` covers EDITING one, not CREATING one.
Measured 2026-09-13 on a live dev stack: `vat-rates/data/` held five country files and `dist/` only
two, `transports/channel-policy/data/` five against three. Every per-country rule in this repo lives
in one of those files, so a stale `dist/` means the server is quietly answering from a different
catalogue than the one on disk — and any "verified against the running stack" claim about country
data is then worthless. Before trusting such a check, or before an e2e run that depends on a recently
added catalogue, compare the two directories (`ls src/**/data/*.json | wc -l` against
`ls dist/src/**/data/*.json | wc -l`) and restart the backend if they differ. Production is not
affected: the Docker image runs a fresh `nest build`.

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

`e2e/cypress/e2e/scenarios/full-lifecycle.cy.ts` — the per-country business-scenario spec — was
restored after the old compliance engine's removal (see the file's own header for what it now
asserts against, and why some outcomes deliberately contradict `e2e/cypress/fixtures/scenarios.ts`'s
own narration comments). Run one leg standalone with `CYPRESS_scenario=<pair> npx cypress run --spec
"cypress/e2e/scenarios/full-lifecycle.cy.ts"` — the exact command `scenarios.yml` runs per matrix job
(needs :4000/:6284/:5433/:6379/:8025 up, per the E2E section above).

### CI (`.github/workflows/`)
- `cypress.yml` ("Tests", on PR) — biome lint, i18n check, backend vitest, a **queue-integration** job
  (real Redis + Postgres, runs `modules/documents/queue/__tests__`), and the Cypress run.
- `scenarios.yml` ("Business Scenarios", on PR) — matrix `fr-pl de-fr it-it pt-de it-pt pl-de` (the
  5-country prune, 2026-09-10, re-pointed fr-be/es-pt/mx-us/us-us onto kept-country pairs — see
  `e2e/cypress/fixtures/scenarios.ts`'s own header for the mapping). Its only step drives
  `cypress/e2e/scenarios/full-lifecycle.cy.ts` — all six legs green as of run `34874375005` (commit
  `b41e99a9`, 2026-09-14).
- `compliance-live.yml` — real-API round-trips, `workflow_dispatch` only. See
  `documentation/docs/developer-guide/live-testing.md`.

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
`sync-schema.ts` also reseeds the country-policy/country-identifiers catalogs on every boot but never
purges a whole removed country (nor do the b2g-routing/country-policy/country-identifiers
`OnModuleInit` boot services) — only the explicit, single-run `npm run catalogs:release`
(`backend/scripts/release-catalogs.ts`) does, wired as a Helm pre-upgrade hook Job for Kubernetes.

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
- `mentions/` — country-mandated free-text legal mentions (BG-1), frozen at issue date. **France only,
  and that is a researched conclusion, not a gap** — the other four countries' statutes were read and
  every mention they require is either a structured field or conditioned on the transaction, which
  this resolver (country + date, nothing else) cannot express. Read `mentions/data/all.ts`'s header
  before assuming there is a hole to fill. Distinct from the per-country wordings the TAX engine
  emits, which live in `tax/tax-engine.ts`'s own `LOCALIZED_MENTION` table.
- `archive/retention/` — how long an archived document must be kept, and **what that duration is
  counted from** (`origin`, mandatory per rule, never defaulted). DE/FR/PL/PT today; Italy is
  deliberately absent because DPR 600/1973 art. 22 makes the obligation run until tax assessments
  close, which has no computable terminus this schema can express.
- `reporting/` — declarative post-send declaration providers. **Portugal (AT) only** today; the
  Hungarian (NAV) and Greek (myDATA) providers were deleted with the five-country prune, so this
  catalog is now the thinnest of the thirteen rather than the broadest. France's own obligation IS
  established (CGI art. 290) but is discharged through the accredited platform (the PDP), which this
  catalog cannot express — a fact here names a `providerId`.
- `domestic-reverse-charge/` — the statutory categories in which the BUYER, not the seller, owes the
  VAT on a purely domestic supply (construction subcontracting, waste, scrap, greenhouse-gas
  allowances, gas and electricity to a reseller…). DE/FR/IT/PT, 32 sourced categories; Poland has none
  today. **Read by nothing yet, deliberately**: the tax engine has no domestic reverse-charge branch,
  and wiring one is its own piece of work. `DESIGN.md` next to the schema states what the catalog does
  NOT model (buyer-status tests, thresholds, Italy's "contraente generale" carve-out) and — important,
  dated — that it has **no temporal axis** while five Italian categories expire 2026-12-31.

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
  chorus-pro), not per country;
- `archive/retention/` — retention duration and its counting origin, DE/FR/PL/PT.

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
  mocks proves nothing about the integration — see `documentation/docs/developer-guide/live-testing.md`
  before claiming a channel works.
- Path alias `@/` → `src/` in both projects (backend resolves it via `vite-tsconfig-paths` in
  `vitest.config.ts`, reading the same `tsconfig.json` `paths` entry `nest build` already uses).
- Comments in this codebase carry decisions and their rationale (why a guard exists, why a module is
  split). Preserve them when refactoring; match that density when adding non-obvious code.

## Reference docs

- `documentation/compliance/COMPLIANCE_ARCHITECTURE.md`, `COMPLIANCE_LIFECYCLE.md`,
  `COMPLIANCE_STATUS.md`, `COMPLIANCE_BUILD_ORDER.md` — retired 2026-08-29: each is now a short
  pointer noting the v1 engine they described was removed, and referring back to the catalogs
  documented above plus tag `avant-refonte-documents` for anyone doing archaeology.
- `documentation/docs/developer-guide/live-testing.md` — required secrets and how to run each real
  round-trip.
- `documentation/docs/developer-guide/credentials-guide.md` — per-authority onboarding notes.
- `documentation/docs/developer-guide/` — extension points, webhooks, MCP server, auth.

## Working with the owner

- **Every decision goes through the question tool (`AskUserQuestion`), never through prose.** The
  owner is not always looking at the screen: a choice written at the end of a report, in a tracking
  file or in a bullet list is a choice nobody makes. Before the tool call, fire the desktop
  notification + sound (`notify-send -u critical … && paplay …`). Group the decisions that belong
  together in one call, state the real consequence of each option, and recommend one.
- The owner writes in French; answer in French. Every `.md` file in this repository is in English.
- Sub-agents write the code; the main session orchestrates, verifies (real builds, real runs) and
  commits. Every sub-agent is launched with `model: "sonnet"`.
