# Compliance — Implementation Status

> Branch: `feat/compliance-architecture` · Module: `backend/src/compliance/`
> Companion docs: [`COMPLIANCE_ARCHITECTURE.md`](COMPLIANCE_ARCHITECTURE.md) (design, §1-§18) ·
> [`COMPLIANCE_LIFECYCLE.md`](COMPLIANCE_LIFECYCLE.md) (per-jurisdiction lifecycle: composed phases ×
> channel-driven triggers × event-sourced runtime) · [`docs/compliance/`](docs/compliance) (per-country specs)
>
> **TL;DR** — Resolution core, execution-layer stubs, the lifecycle runtime + its 3 durable drivers,
> and Prisma/NestJS persistence are all built, wired together, and tested
> (**317 tests — 314 unit + 3 opt-in live-DB integration — 0 type errors, zero impact on the existing
> invoice flow**). What remains is (1) replacing the named `TODO` stubs with real external
> integrations, and (2) wiring the module into the **live** invoice flow (`invoices.service.ts`).

---

## ✅ Done

### Architecture & docs
- [x] `COMPLIANCE_ARCHITECTURE.md` — design RFC (v1.1): 16-axis taxonomy, tax engine, lifecycle,
  reliability patterns, full country mapping, worked "horrible cases".
- [x] `COMPLIANCE_LIFECYCLE.md` — companion RFC: the lifecycle as **phases** (composed from the plan,
  issuer ⊕ recipient) × **drivers** (bound from the channel's feedback model — poll/callback/timer/
  immediate/manual) × a durable **event-sourced runtime**.
- [x] `docs/compliance/FR-France.md` — the home-market spec (was missing from the original 77).

### Resolution core (pure, no I/O — fully implemented)
- [x] **Canonical model** (`canonical/`) — format-agnostic document, money in integer minor units.
- [x] **Country profiles** (`profiles/`) — declarative, **temporal** (`validFrom/validTo`), with a
  registry, **delegation** (Monaco→FR) and a fail-safe **FALLBACK**.
- [x] **Tax determination engine** (`engine/tax-engine.ts`) — cross-border by composition: domestic
  VAT/GST, intra-EU & intra-GCC reverse charge / intra-union supply, OSS (destination rate from the
  real buyer profile), export, US sales tax + nexus, no-VAT origin, exempt/franchise schemes.
- [x] **Compliance engine** (`engine/compliance-engine.ts`) — `resolve(tx) → CompliancePlan`
  (regime, formats, channels, numbering, lifecycle, archival, reporting, confidence, warnings).

### Country coverage — **106 jurisdictions wired**
- [x] All **106** `docs/compliance/*` country specs (the original 77 + ~29 added when `dev` was
  merged in) + bespoke majors (FR, US, MX, IT, PL; DE/ES/GB/CA/AU/NZ/JP/… via archetypes).
- [x] Typed **archetype builders** (`profiles/archetypes.ts`) → most countries are a one-line
  declaration; **5 bespoke** profiles carry verified, hand-written specifics.
- [x] **Coverage test** (`profiles/coverage.spec.ts`) reads `docs/compliance/` and fails CI if any
  documented country is not wired to a non-fallback profile.
- [x] **`data-integrity.spec.ts`** — CI-enforced invariants: every profile well-formed and temporally
  ordered, every VAT/GST rate sane, and — crucially — **every referenced `DocumentSyntax` and channel
  `providerId` resolves to a real provider** (a typo can no longer silently fall back to a catch-all).
- [x] Honesty via `confidence`: bespoke = `OFFICIAL`; archetype-built = `BEST_EFFORT`; announced
  mandates = `PLANNED`.

### Execution layer — providers (wired end to end; bodies are stubs that log `TODO`)
- [x] **Format**: EN16931 family, PlainPDF, CFDI, FatturaPA, KSA-UBL, FA_VAT, **43 dedicated national
  formats** (NF-e, CL DTE, e-Fapiao, GST IRP, UBL-TR, ETA, eTIMS, JoFotara, TEIF, …), plus the generic
  `NATIONAL_XML` catch-all kept only as a safety net (no documented country defaults to it anymore).
- [x] **Transmission**: Email, Peppol, PDP, PAC, SdI, KSeF, GovPortal, OSE, Print, **50 dedicated
  national-portal providers** (SEFAZ, SII, AFIP, DIAN, ZATCA, IRP, GİB, ANAF, SEF, …) selected via
  `ChannelSpec.providerId` (no collision when several share `GOV_PORTAL_API`); `gov-portal` kept as
  the safety-net default.
- [x] Every transmission provider declares a **`feedback` model** (`SYNC`/`ASYNC_POLL`/
  `ASYNC_CALLBACK`/`NONE` + `pollPolicy`) — this is what drives the lifecycle (see below) per channel,
  not per country.
- [x] **Signing** providers + registry: XAdES, CAdES, PAdES, none.
- [x] **Archive** providers + registry: WORM-S3 (residency routing), Local.
- [x] **Regime** handlers + registry: post-audit, periodic, real-time, clearance (blocking), CTC.
- [x] **Tax-system** handlers + registry: VAT/GST/SalesTax/ConsumptionTax/None — compute money totals
  in integer minor units.
- [x] **Reporting** handlers + registry: EC Sales List, Intrastat, OSS, IOSS, SAF-T, e-reporting,
  sales/purchase ledger, customs export.

### Lifecycle — composed phases × channel-driven triggers × event-sourced runtime
- [x] **Phases** (`lifecycle/phases/`) — pure contributors (issuance, clearance, delivery,
  buyer-response, reporting, corrections), each gated by the resolved plan, composed into one
  `LifecycleGraph` per transaction (`lifecycle/assembler.ts`), validated against the legal superset
  in `lifecycle/state-machine.ts`.
- [x] **Triggers** (`lifecycle/triggers.ts`) — `IMMEDIATE`/`POLL`/`CALLBACK`/`TIMER`/`MANUAL`/
  `CONTINGENCY`, bound from the channel's `feedback` model.
- [x] **Runtime** (`lifecycle/runtime.ts`) — event-sourced interpreter: `dispatch(signal) → Effect[]`;
  `availableActions()` / `pendingDrivers()` projections for a future UI; a stale/inapplicable signal
  is always a safe `NOOP` (never corrupts state); an illegal `COMMAND` throws (immutability guard).
- [x] **3 durable drivers**, each a pure job/store core + a thin injected I/O edge:
  - `poll-scheduler` — `tick()` polls due jobs via the channel's `poll()`, exponential backoff,
    expiry. Proven end-to-end driving an MX clearance to `CLEARED`.
  - `timer-scheduler` — silence-window timers (e.g. **Chile's 8-day silence = acceptance**, wired on
    the CL profile). Proven end-to-end; a stale fire after the document moved on is a safe `NOOP`.
  - `inbound-router` — event-driven (no tick): `register()` + `receive()`, with idempotent dedup of
    at-least-once authority pushes. Proven end-to-end (IT SdI "consegnata" → `CLEARED`; FR PDP
    "approuvée"/"refusée" → `ACCEPTED`/`REFUSED`).

### Persistence — Prisma + NestJS (reviewed; not yet wired into the live invoice flow)
- [x] **Prisma models** (`prisma/schema.prisma`, migration `compliance_lifecycle`): `ComplianceDocument`,
  `ComplianceEvent` (append-only journal), `ComplianceAuthorityId`, `ScheduledJob` (shared by poll +
  timer), `ComplianceCallbackRegistration`, `ComplianceInboundMessage`. Additive only.
- [x] **Prisma adapters** (`persistence/`) implementing the four (now **async**) store ports —
  in-memory implementations are unchanged and still pass the full unit suite.
- [x] **NestJS wiring** (`nest/`): `ComplianceModule`, `ComplianceCron` (`@Interval` ticks for both
  schedulers, with an in-flight guard against overlapping runs), `ComplianceController` (one inbound
  webhook route per channel, shared-secret gated), and the real `ApplySignalService` — loads the
  runtime, dispatches the signal, and persists the status/event update **and** the (de)scheduling of
  drivers **atomically in one Prisma transaction**, cancelling the drivers that guarded the *previous*
  state before arming the ones for the new one.
- [x] **Live-DB integration test** (`nest/apply-signal.live.spec.ts`, opt-in via
  `COMPLIANCE_LIVE_DB_TESTS=1`, skipped by default) proves the above against a real Postgres.

### Operations facade (`operations/compliance-service.ts`) — one method per lifecycle operation, async
- [x] Issuance: `createDraft`, `editDraft` (DRAFT-only), `issue`, `issueAndSend`.
- [x] Sending: `send`, `resend`, `sendViaChannel`.
- [x] Clearance: `submitForClearance`, `pollClearance`, `markCleared`, `markRejected`,
  `enterContingency`, `resubmitFromContingency`.
- [x] Modification: `correct`, `issueCreditNote`, `issueDebitNote`, `issueCorrectiveInvoice`,
  `cancel` (policy-gated), `cancelAndReplace`.
- [x] Response: `openResponseWindow`, `applyResponse`, `handleResponseTimeout`.
- [x] Inbound: `receive`, `acknowledgeInbound` (+ `ReceptionService`).
- [x] Misc: `report`, `markPaid`, `archiveDocument`, `validate`, queries.
- [x] `ComplianceDocumentStore` port — **in-memory and Prisma implementations both available**.

### Tests
- [x] **317 tests** across **30 spec files**: 314 always-on unit tests (pure engine/profiles/
  providers/lifecycle, no I/O) + 3 opt-in live-DB integration tests. `tsc --noEmit` clean; `nest
  build` succeeds; `prisma validate` passes; a fresh `prisma migrate deploy` applies cleanly.

---

## 🚧 To do

### 1. Replace the named `TODO` stubs with real integrations
Every stub logs `TODO` at the exact spot to fill (grep `\.todo(` in `backend/src/compliance/` — **62
markers** as of this writing, each naming the exact schema/API/cert to implement).

| Area | Stub scopes | What to implement |
| --- | --- | --- |
| **Formats** | `format/en16931`, `plain-pdf`, `cfdi`, `fatturapa`, `ksa-ubl`, `fa-vat`, + 43 dedicated national-format stubs, `national-xml` (catch-all) | Real bytes. `en16931` → wrap `@fin.cx/einvoice`; `plain-pdf` → reuse `getInvoicePdf()`; each national stub → its own schema/XSD builder + validation |
| **Transmission** | `email`, `peppol`, `pdp`, `pac`, `sdi`, `ksef`, `ose`, `print`, + 50 dedicated national-portal stubs, `gov-portal` (catch-all) | `email` → `MailService`; others → integrate the certified intermediary / portal (async clearance returns IDs, matching each provider's declared `feedback` model) |
| **Signing** | `signing/xades`, `cades`, `pades` | Real crypto + certificate backends (CSD, ICP-Brasil, X.509, qualified seal) + QR payloads |
| **Archive** | `archive/s3-worm`, `local` | Real WORM storage, retention enforcement, integrity (hash-chain / re-sealing) |
| **Regime** | `regime/clearance`, `decentralized-ctc`, `periodic-reporting`, `real-time-reporting` | Authority interaction + status handling |
| **Lifecycle** | `numbering/folio-pool`, `gapless`, `lifecycle/response`, `lifecycle/corrections/*` | Folio range requests; real hash-chain; correction document build (the response track + silence timers themselves are now real — see above) |
| **Tax** | `taxsystem/sales-tax`, `consumption-tax` | US county/city/district rate stacking; JP-style rounding |
| **Operations** | `operations/issue`, `cancel`, `clearance`, `contingency`, `markPaid`, `validate` | Real hash; authority cancel ack; contingency offline issue; payment e-reporting; validation-report aggregation |
| **Reception** | `reception` | Parse/validate inbound; emit mandated buyer status |

### 2. Platform wiring — what's left after persistence
- [x] ~~NestJS module + Prisma persistence~~ — **done** (see above).
- [ ] **Wire into `invoices.service.ts`** — build the `TransactionContext`, call the engine, drive the
  runtime; restrict the current free `editInvoice` to DRAFT; route create/send/correct through the
  facade. Replace the hardcoded 293B logic with the tax engine. *(This is the next concrete step —
  the facade + persistence it needs now both exist.)*
- [ ] **ISO-3166 migration** — `Company.country`/`Client.country` free-text → 2-letter codes.
- [ ] **Money migration** — `Invoice` `Float` columns → integer minor units.
- [ ] **Outbox + dispatcher** — durable at-least-once *outbound* authority/buyer I/O with idempotency
  (the lifecycle's *inbound* side — poll/timer/callback — is already durable; this is the outbound
  counterpart for `transmit()`/clearance submission itself).
- [ ] **Frontend** — country/compliance config, compliance status display (the runtime already
  exposes `availableActions()`/a timeline-shaped projection), warnings surfacing.

### 3. Deeper modelling (anticipated in the design, not yet built)
- [ ] **QR & signing rules** as profile fields (SA/IT-B2C/PT/LATAM QR; per-country cert type).
- [ ] **Withholding & multi-tax population** — engine currently emits one component for most countries.
- [ ] **Multi-entity / non-established supplier** — app assumes a single `company.findFirst()`.
- [ ] **Certificate lifecycle** — expiry/renewal/HSM monitoring.
- [ ] **VIES / registry validation** — wire a real validator behind `VatValidator`.
- [ ] **§13 models not yet built**: `FolioPool`, `Withholding`, `TaxComponent`, `LegalArchiveEntry`,
  `ReceivedDocument`, `DocumentResponse` — deliberately out of scope of the lifecycle-persistence
  phase that was just completed; add when their corresponding stub area is implemented for real.

### 4. Data accuracy
- [ ] Profiles built by archetype carry `BEST_EFFORT`/`PLANNED` rates and dates inferred from
  `docs/compliance/` — graduate them to verified `OFFICIAL` bespoke profiles per country as needed.

---

## Suggested order
1. **Tax engine into `invoices.service.ts`** (replaces hardcoded 293B) — immediate correctness win,
   low risk, and the facade/persistence it needs already exist.
2. **One reference transmission end to end** (e.g. FR PDP **or** MX PAC) — replace one provider stub
   with a real integration; the lifecycle drivers that make it *live* (poll/callback) are already built.
3. **Outbox** for the outbound side, mirroring the durability already built for inbound (poll/timer/callback).
4. **Frontend** — surface compliance status + available actions from the runtime's projections.
5. Reporting + breadth; fill remaining national formats/channels incrementally behind the registries.

---

*Status as of branch `feat/compliance-architecture`. Update this file as stubs are replaced.*
