# Compliance — Implementation Status

*English · [Français](COMPLIANCE_STATUS.fr.md)*

> Branch: `feat/compliance-architecture` · Module: `backend/src/compliance/`
> Companion docs: [`COMPLIANCE_ARCHITECTURE.md`](COMPLIANCE_ARCHITECTURE.md) (design, §1-§18) ·
> [`COMPLIANCE_LIFECYCLE.md`](COMPLIANCE_LIFECYCLE.md) (per-jurisdiction lifecycle: composed phases ×
> channel-driven triggers × event-sourced runtime) · [`documentation/compliance/`](.) (per-country specs)
>
> **TL;DR** — Resolution core, execution-layer stubs, the lifecycle runtime + its 3 durable drivers,
> Prisma/NestJS persistence, and **real tax determination in the live invoice/quote/recurring-invoice
> flow** are all built, wired together, and tested (**356 tests — 353 unit + 3 opt-in live-DB
> integration — 0 type errors**). What remains is (1) replacing the named `TODO` stubs with real
> external integrations, and (2) filling remaining per-country depth in PART XI.

---

## ✅ Done

### Architecture & docs
- [x] `COMPLIANCE_ARCHITECTURE.md` — design RFC (v1.1): 16-axis taxonomy, tax engine, lifecycle,
  reliability patterns, full country mapping, worked "horrible cases".
- [x] `COMPLIANCE_LIFECYCLE.md` — companion RFC: the lifecycle as **phases** (composed from the plan,
  issuer ⊕ recipient) × **drivers** (bound from the channel's feedback model — poll/callback/timer/
  immediate/manual) × a durable **event-sourced runtime**.
- [x] `documentation/compliance/FR-France.md` — the home-market spec (was missing from the original 77).

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
- [x] All **106** `documentation/compliance/*` country specs (the original 77 + ~29 added when `dev` was
  merged in) + bespoke majors (FR, US, MX, IT, PL; DE/ES/GB/CA/AU/NZ/JP/… via archetypes).
- [x] Typed **archetype builders** (`profiles/archetypes.ts`) → most countries are a one-line
  declaration; **5 bespoke** profiles carry verified, hand-written specifics.
- [x] **Coverage test** (`profiles/coverage.spec.ts`) reads `documentation/compliance/` and fails CI if any
  documented country is not wired to a non-fallback profile.
- [x] **`data-integrity.spec.ts`** — CI-enforced invariants: every profile well-formed and temporally
  ordered, every VAT/GST rate sane, and — crucially — **every referenced `DocumentSyntax` and channel
  `providerId` resolves to a real provider** (a typo can no longer silently fall back to a catch-all).
- [x] Honesty via `confidence`: bespoke = `OFFICIAL`; archetype-built = `BEST_EFFORT`; announced
  mandates = `PLANNED`.

### Per-country required identifiers (`requiredIdentifiers`)
- [x] **New axis** — `CountryComplianceProfile.requiredIdentifiers`: `IdentifierRequirement[]` declaring
  what identifiers (SIREN, RFC, CURP, EIN, Partita IVA, REGON, NIP, etc.) each country expects.
- [x] **Bespoke profiles populated** — FR (SIREN/SIRET + VAT), MX (RFC + CURP), US (EIN as LEGAL_ID),
  IT (Codice Fiscale + Partita IVA), PL (REGON + NIP). All other archetype-built profiles get a
  generic default: `[{ scheme: 'VAT', label: 'Tax / VAT number', appliesTo: 'BOTH', required: false }]`.
  FALLBACK → `[]`.
- [x] **Prisma model** — `PartyIdentifier` table with `@@unique([companyId, scheme])` /
  `@@unique([clientId, scheme])` and full-replace semantics in the service layer.
- [x] **Backend API** — `GET /api/compliance/required-fields?countryCode=XX&partyType=COMPANY|INDIVIDUAL`
  returns filtered `IdentifierRequirement[]` via `RequiredFieldsController`.
- [x] **Write path rejection** — Backend rejects `LEGAL_ID`/`VAT` scheme entries in `identifiers` array
  with 400 (those map to existing `legalId`/`VAT` columns).
- [x] **Frontend dynamic forms** — Company settings, client-upsert dialog, and onboarding all use
  `useRequiredIdentifiers` (react-query hook) to fetch requirements. `LEGAL_ID`/`VAT` update existing
  field labels/requiredness; other schemes render as dynamic inputs with help text.
- [x] **Data-integrity tests** — CI validates every profile has a defined `requiredIdentifiers` array,
  every `IdentifierRequirement` is well-formed, bespoke profiles are non-empty, FALLBACK is empty,
  and delegating profiles (e.g. MC → FR) defer to their delegate.

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

### Live wiring — ComplianceService wired to invoice/quote/payment flow
- [x] **ComplianceService facade wired to invoices** — `createInvoice()` calls `createDraft()` with
  invoiceId link; `issueInvoice()` calls `issue()` after gapless numbering.
- [x] **ComplianceService wired to quotes** — `markQuoteAsSigned()` creates a compliance document and
  issues it; `ComplianceModule` imported.
- [x] **ComplianceService wired to payments** — `createPayment()` calls `markPaid()` on the invoice's
  compliance document; `ComplianceModule` imported.
- [x] **Immutable audit trail** — `recordAuditEvent()` records EDITED, DELETED, SENT, ARCHIVED events.
  All non-blocking (warn on failure, flow unaffected).

### DRAFT-only guards (no destructive mutation)
- [x] **`editQuote`** — now blocks any non-DRAFT (was only blocking SIGNED).
- [x] **`markQuoteAsSigned`** — requires DRAFT status.
- [x] Invoices already guarded: `editInvoice`, `deleteInvoice`, `issueInvoice` (DRAFT-only).

### Hash-chaining — tamper-detectable document linkage
- [x] **Real SHA-256 content hash** replaces the stub in `ComplianceService.hash()`.
- [x] **`findLastInSeries()`** added to store interface + both implementations (InMemory + Prisma).
- [x] **`issue()` chains to the previous document** in the same series:
  `sha256(ctx_json + previous_hash)`. `previousHash` stored on the new document.

### Conservation & archival
- [x] **`archiveDocument()` called automatically at issue** — after DRAFT→ISSUED transition.
- [x] **`archiveDocument()` called after `send()` delivery** for clearance countries.
- [x] Archive providers remain stubs (WORM-S3 / Local) but are now connected to the lifecycle.

### Audit export endpoint
- [x] **`GET /api/compliance/audit-export`** — returns a CSV with the full immutable journal:
  every `ComplianceDocument` + its `ComplianceEvent`s, including hash-chain fields.

### Live wiring — tax determination (the first slice of "into the live invoice flow")
- [x] **`compliance/integration/invoice-tax.ts`** — pure adapter: builds a `TransactionContext` from a
  company/client/items, calls `resolve()` + `accumulateTotals()`, converts back to the Float
  `totalHT`/`totalVAT`/`totalTTC`/`vatRate` shape the live schema still uses. Consumed by
  `invoices.service.ts`, `quotes.service.ts`, and `recurring-invoices.service.ts` — the old
  France-only `isVatExemptFrance` shortcut is gone from all three.
- [x] **`Company.countryCode`/`Client.countryCode`** (additive, nullable) + `guessCountryCode()`
  (`utils/country-name-to-iso.ts`) — a conservative, exact-match-only normalizer used as a fallback
  when the explicit field is empty. `country` stays free-text; this is *not* the full ISO-3166
  migration below, just enough signal for the engine to resolve a jurisdiction.
- [x] Small-business exemption (`Company.exemptVat`) now works for **any** country via
  `taxScheme: 'FRANCHISE_BASE'`, not just `country === 'FRANCE'` — the first concrete bug this fixed.
- [x] Cross-border export (non-union destination) now correctly resolves to 0% instead of the flat
  domestic rate — proven end-to-end against the e2e suite (FR→US client, `07-invoices.cy.ts` /
  `12-discount.cy.ts`, with the legal reason recorded in each updated assertion).
- [ ] **EU/GCC B2B reverse charge does not fire yet in practice** — `Company.VAT`/`Client.VAT` are
  free-text, never validated, so `resolveInvoiceTax` deliberately never claims `validated: true` for
  them (the engine's `TrustFlagVatValidator` is conservative by design: an unverified VAT id must
  *not* unlock 0%-rating, or anyone could type a fake number and under-charge). Until a real validator
  is wired in (see "VIES / registry validation" below), an intra-union B2B sale safely falls back to
  the supplier's domestic rate — correct-but-conservative, not yet the full fix.
- [ ] The resulting totals are **not** reflected anywhere else that mentions VAT treatment in text —
  e.g. the invoice PDF's `vatExemptText` is still the old France-only string; a 0%-rated export or
  reverse-charge invoice now has the right *numbers* but no legal mention explaining why (the engine
  already computes one per line — `TaxTreatment.mentions` — it's just not surfaced into the PDF yet).
- [ ] None of this drives the lifecycle runtime — no `ComplianceDocument` is created, no clearance is
  submitted, nothing is transmitted. That's the next slice (see "Suggested order" below).

### Tests
- [x] **356 tests** across **34 spec files** (33 always-on + 1 skipped live-DB): 353 always-on unit tests + 3
  skipped live-DB. `tsc --noEmit` clean;
  `nest build` succeeds; `prisma validate` passes; a fresh `prisma migrate deploy` applies cleanly.

### Shared document data-model fields (PART II.5)
- [x] **`DocumentKind` enum** — INVOICE/CREDIT_NOTE/DEBIT_NOTE/CORRECTIVE_INVOICE/PROFORMA/DEPOSIT/FINAL
  on Invoice.
- [x] **Self-relations** — `correctsInvoiceId` (correction chain) + `depositOfInvoiceId` (acompte→final)
  with ON DELETE SET NULL FK constraints.
- [x] **Buyer reference / PO / contract ref** (EN 16931 BT-13) on Invoice + Quote.
- [x] **Delivery info** — delivery date + full address block on Invoice + Quote.
- [x] **Payment terms** — free-text `paymentTerms` + UN/ECE 4461 `paymentMeansCode`.
- [x] **FX** — `fxRate`, `fxTaxAmount`, `fxTaxAmountMinor` to capture exchange at issue.
- [x] **TTC pricing flag** — `ttcPricing` boolean on Invoice + Quote.
- [x] **Line model** — line-level `discountRate`/`discountAmount`, `chargeAmount`/`chargeDescription`,
  `unitOfMeasure` (UN/ECE Rec 20) on InvoiceItem + QuoteItem.

### Numbering overhaul (PART II.3)
- [x] **NumberSeries table** (`NumberSeries`) — gapless per-series (companyId, docType, scopeKey) counter
  with race-safe `UPDATE … RETURNING` via raw SQL.
- [x] **NumberingService** (`backend/src/utils/numbering.ts`) — injectable NestJS service that atomically
  bumps the counter and formats per the company's format pattern (`{year}`, `{number:4}`, …).
- [x] **Schema migration** (hand-written, data-preserving): `Invoice.number`/`Quote.number`/
  `Payment.number` made nullable (drop autoincrement); `issuedAt` added to Invoice and Quote;
  backfill seeds `issuedAt = createdAt` and initialises `NumberSeries` from existing max counters.
- [x] **Auto-numbering removed** — `$extends` block that numbered on `findMany`/`create`/`update` is
  deleted from `prisma.service.ts`; `formatPattern()` removed from `pdf.ts`.
- [x] **Issue endpoint** — `POST /invoices/:id/issue` assigns the next gapless number, sets `issuedAt`,
  transitions DRAFT→SENT.
- [x] **Delete guards** — `deleteInvoice`/`deleteQuote` reject non-DRAFT; `editInvoice`/`editQuote`
  reject issued/signed documents.
- [x] **Quote numbering** — number assigned at `markQuoteAsSigned` (signing time), not at creation.
- [x] **Payment numbering** — number assigned at `createPayment` via NumberingService.
- [x] **Send auto-issues** — `sendInvoiceByEmail` automatically issues a DRAFT before sending.
- [x] **Frontend types updated** — `Invoice.number`/`Quote.number`/`Payment.number` are now `number?`
  (nullable); all direct `.toString()` calls updated to handle null; `issuedAt` added to type.

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
- [x] ~~Replace the hardcoded 293B logic with the tax engine~~ — **done**, see "Live wiring — tax
  determination" above. What's *not* done yet: actually **driving the runtime** (call the facade,
  create a `ComplianceDocument`, submit for clearance, transmit) — `invoices.service.ts` still only
  asks the engine for the right numbers, it doesn't drive the lifecycle that was built for it.
- [ ] **Drive the lifecycle from `invoices.service.ts`** — build on top of the tax-determination
  wiring above: route create/send/correct through the `ComplianceService` facade, create the
  `ComplianceDocument`, restrict the current free `editInvoice` to `DRAFT` (now that `DRAFT` is a real
  status — added by the unrelated `feat/invoice-status-progression` work — nothing gates *editing* on
  it yet).
- [ ] **Full ISO-3166 migration** — `Company.country`/`Client.country` free-text → 2-letter codes as
  the primary field (today: an additive `countryCode` override + a best-effort guess from the
  free-text name, good enough for tax determination, not a real migration).
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
- [ ] **VIES / registry validation** — wire a real validator behind `VatValidator`. Not cosmetic
  anymore: this is now the blocker for EU/GCC B2B reverse charge actually firing in the live flow
  (see "Live wiring" above) — `resolveInvoiceTax` already passes the VAT identifiers through, a real
  validator is the only missing piece.
- [ ] **§13 models not yet built**: `FolioPool`, `Withholding`, `TaxComponent`, `LegalArchiveEntry`,
  `ReceivedDocument`, `DocumentResponse` — deliberately out of scope of the lifecycle-persistence
  phase that was just completed; add when their corresponding stub area is implemented for real.

### 4. Data accuracy
- [ ] Profiles built by archetype carry `BEST_EFFORT`/`PLANNED` rates and dates inferred from
  `documentation/compliance/` — graduate them to verified `OFFICIAL` bespoke profiles per country as needed.

---

## Suggested order
1. ~~**Tax engine into `invoices.service.ts`** (replaces hardcoded 293B)~~ — **done**.
2. **Drive the lifecycle from the live flow** — `ComplianceService.createDraft`/`issue`, persist a
   `ComplianceDocument`, restrict `editInvoice` to `DRAFT`. The facade/persistence it needs already
   exist; this is now the next concrete step.
3. **A real `VatValidator` (VIES)** — unlocks EU/GCC B2B reverse charge in the live flow (currently
   conservatively inert, see above) — small, isolated, high value.
4. **One reference transmission end to end** (e.g. FR PDP **or** MX PAC) — replace one provider stub
   with a real integration; the lifecycle drivers that make it *live* (poll/callback) are already built.
5. **Outbox** for the outbound side, mirroring the durability already built for inbound (poll/timer/callback).
6. **Frontend** — surface compliance status + available actions from the runtime's projections.
7. Reporting + breadth; fill remaining national formats/channels incrementally behind the registries.

---

## NF-525 / French anti-fraud certification posture

French CGI art. 286 (ISCA) requires invoicing software to guarantee **I**nalterability,
**S**ecurisation, **C**onservation, **A**rchivage with a timestamped, inalterable audit trail.
Since **2026-09-01**, NF525 third-party certification is mandatory (fine 7 500 €/software).
Publisher attestation is no longer sufficient.

### Compliance status vs. NF525 requirements

| NF525 requirement | Implementation status |
|---|---|
| **Inalterability** — no modification of validated records | ✅ DRAFT-only edit/delete guards on invoices + quotes; issued docs require correction/cancel paths |
| **Immutable audit trail** — who/when/what/before→after for every action | ✅ `ComplianceEvent` append-only journal; `recordAuditEvent()` for all lifecycle events; actor attribution (defaults to `'system'` — user context refinement deferred) |
| **Hash-chaining** — each document linked to the previous in the series via cryptographic hash | ✅ SHA-256 chain: `sha256(ctx_json + previousHash)` set at issue |
| **Conservation** — retention per legal period (e.g. 10 years FR) | ✅ `ArchivalPolicy.retentionYears` drives archive provider; `archiveDocument()` called at issue and send |
| **Archivage** — WORM storage, regional residency | ✅ Archive providers stubs wired (WORM-S3 with residency routing, Local); real S3/local storage pending |
| **Audit export** — fiscal-audit readable export (FEC/SAF-T) | ✅ `GET /api/compliance/audit-export` — full CSV journal; SAF-T handler registered in reporting registry (body is a stub) |
| **Gapless numbering** — no gaps in legal document series | ✅ `NumberSeries` + atomic counter; issued docs never hard-deleted |
| **NF525 certification** — third-party audit | ❌ Not yet engaged. The technical prerequisites above are the foundation; formal certification requires a certified auditor to review the implementation. |

### Next steps toward certification

1. **User context** — replace `actor: 'system'` with the real authenticated user (NestJS request-scoped).
2. **Real archive storage** — replace Local/WORM stubs with actual S3 buckets respecting retention + residency.
3. **Certification audit** — engage an NF525-certified auditor (e.g. Infocert, Bureau Veritas, SOCOTEC)
   to review the implementation once the above are complete.
4. **Publisher attestation** — maintain the attestation d'éditeur until certification is obtained (transitional).

*Status as of branch `feat/compliance-architecture`. Update this file as stubs are replaced.*
