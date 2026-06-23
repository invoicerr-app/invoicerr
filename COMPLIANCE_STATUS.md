# Compliance — Implementation Status

> Branch: `feat/compliance-architecture` · Module: `backend/src/compliance/`
> Companion docs: [`COMPLIANCE_ARCHITECTURE.md`](COMPLIANCE_ARCHITECTURE.md) (design) · [`docs/compliance/`](docs/compliance) (per-country specs)
>
> **TL;DR** — The full compliance *scaffolding* is done end to end and tested in isolation
> (**177 passing tests, 0 type errors, zero impact on the existing invoice flow**). What remains is
> (1) replacing the named `TODO` stubs with real external integrations, and (2) wiring the module into
> NestJS + Prisma and the live invoice flow.

---

## ✅ Done

### Architecture & docs
- [x] `COMPLIANCE_ARCHITECTURE.md` — design RFC (v1.1) with the 16-axis taxonomy, tax engine,
  lifecycle, reliability patterns, full country mapping, and worked "horrible cases".
- [x] `docs/compliance/FR-France.md` — the home-market spec (was missing from the 77).

### Resolution core (pure, no I/O — fully implemented)
- [x] **Canonical model** (`canonical/`) — format-agnostic document, money in integer minor units.
- [x] **Country profiles** (`profiles/`) — declarative, **temporal** (`validFrom/validTo`), with a
  registry, **delegation** (Monaco→FR) and a fail-safe **FALLBACK**.
- [x] **Tax determination engine** (`engine/tax-engine.ts`) — cross-border by composition: domestic
  VAT, intra-EU reverse charge / intra-Community supply, OSS, export, US sales tax + nexus, no-VAT
  origin. Multi-component tax + withholding types in the model.
- [x] **Compliance engine** (`engine/compliance-engine.ts`) — `resolve(tx) → CompliancePlan`
  (regime, formats, channels, numbering, lifecycle, archival, reporting, confidence, warnings).

### Country coverage — **84 jurisdictions wired**
- [x] All **77** `docs/compliance/*` countries + 7 majors (FR, US, MX, IT, PL bespoke; DE, ES, GB).
- [x] Typed **archetype builders** (`profiles/archetypes.ts`) → each country is a one-line declaration.
- [x] **Coverage test** reads `docs/compliance/` and fails CI if any country is not wired.
- [x] Honesty via `confidence`: bespoke 5 = `OFFICIAL`; archetype-built = `BEST_EFFORT`; announced
  mandates = `PLANNED`.

### Execution layer (wired end to end; provider bodies are stubs that log `TODO`)
- [x] **Format** providers + registry: EN16931, PlainPDF, CFDI, FatturaPA, KSA-UBL, FA_VAT, NATIONAL_XML.
- [x] **Transmission** providers + registry: Email, Peppol, PDP, PAC, SdI, KSeF, GovPortal, OSE, Print
  — with **provider-id selection** (no collision between national portals on `GOV_PORTAL_API`).
- [x] **Signing** providers + registry: XAdES, CAdES, PAdES, none.
- [x] **Archive** providers + registry: WORM-S3 (residency routing), Local.
- [x] **Regime** handlers + registry: post-audit, periodic, real-time, clearance (blocking), CTC.
- [x] **Tax-system** handlers + registry: VAT/GST/SalesTax/ConsumptionTax/None — compute money totals.
- [x] **Reporting** handlers + registry: EC Sales List, Intrastat, OSS, IOSS, SAF-T, e-reporting,
  sales/purchase ledger, customs export.
- [x] **Lifecycle**: state machine (illegal transitions throw), gapless + folio-pool numbering,
  correction strategies, response tracker (silence=acceptance).
- [x] **ComplianceExecutor** — runs the whole pipeline from a plan.

### Operations facade (`operations/compliance-service.ts`) — one method per lifecycle operation
- [x] Issuance: `createDraft`, `editDraft` (DRAFT-only), `issue`, `issueAndSend`.
- [x] Sending: `send`, `resend`, `sendViaChannel`.
- [x] Clearance: `submitForClearance`, `pollClearance`, `markCleared`, `markRejected`,
  `enterContingency`, `resubmitFromContingency`.
- [x] Modification: `correct`, `issueCreditNote`, `issueDebitNote`, `issueCorrectiveInvoice`,
  `cancel` (policy-gated), `cancelAndReplace`.
- [x] Response: `openResponseWindow`, `applyResponse`, `handleResponseTimeout`.
- [x] Inbound: `receive`, `acknowledgeInbound` (+ `ReceptionService`).
- [x] Misc: `report`, `markPaid`, `archiveDocument`, `validate`, queries.
- [x] `ComplianceDocumentStore` port (in-memory now) + in-memory document records.

---

## 🚧 To do

### 1. Replace the named `TODO` stubs with real integrations
Every stub logs `TODO` at the exact spot to fill (grep `\.todo(` in `backend/src/compliance/`).

| Area | Stub scopes | What to implement |
| --- | --- | --- |
| **Formats** | `format/en16931`, `plain-pdf`, `cfdi`, `fatturapa`, `fa-vat`, `ksa-ubl`, `national-xml` | Real bytes. `en16931` → wrap the existing `@fin.cx/einvoice`; `plain-pdf` → reuse `getInvoicePdf()`; national XMLs → per-country builders + XSD/Schematron validation |
| **Transmission** | `email`, `peppol`, `pdp`, `pac`, `sdi`, `ksef`, `gov-portal`, `ose`, `print` | `email` → `MailService`; others → integrate the certified intermediary / portal (async clearance returns IDs) |
| **Signing** | `signing/xades`, `cades`, `pades` | Real crypto + certificate backends (CSD, ICP-Brasil, X.509, qualified seal) + QR payloads |
| **Archive** | `archive/s3-worm`, `local` | Real WORM storage, retention enforcement, integrity (hash-chain / re-sealing) |
| **Regime** | `regime/clearance`, `decentralized-ctc`, `periodic-reporting`, `real-time-reporting` | Authority interaction + status handling |
| **Lifecycle** | `numbering/folio-pool`, `gapless`, `lifecycle/response`, `lifecycle/corrections/*` | Folio range requests; real hash-chain; persisted status events; correction document build |
| **Tax** | `taxsystem/sales-tax`, `consumption-tax` | US county/city/district rate stacking; JP-style rounding |
| **Operations** | `operations/issue`, `cancel`, `clearance`, `contingency`, `markPaid`, `validate` | Real hash; authority cancel ack; clearance outbox; contingency offline issue; payment e-reporting; validation-report aggregation |
| **Reception** | `reception` | Parse/validate inbound; emit mandated buyer status |

### 2. Platform wiring (not yet started)
- [ ] **NestJS module** — `ComplianceModule` + a Nest `ComplianceService` wrapping the facade.
- [ ] **Prisma persistence** — replace `InMemoryComplianceDocumentStore`; add the `ComplianceDocument`,
  `ComplianceEvent`, `TaxComponent`, `Withholding`, `AuthorityIdentifier`, `TransmissionAttempt`,
  `OutboxMessage`, `LegalArchiveEntry`, `FolioPool`, `ReceivedDocument` models (architecture §13).
- [ ] **ISO-3166 migration** — `Company.country`/`Client.country` free-text → 2-letter codes.
- [ ] **Money migration** — `Invoice` `Float` columns → integer minor units.
- [ ] **Wire into `invoices.service.ts`** — build the `TransactionContext`, call the engine, drive the
  state machine; restrict the current free `editInvoice` to DRAFT; route create/send/correct through
  the facade. Replace the hardcoded 293B logic with the tax engine.
- [ ] **Outbox + dispatcher** — durable at-least-once authority/buyer I/O with idempotency.
- [ ] **Scheduler** — fire `handleResponseTimeout` for silence=acceptance windows.
- [ ] **Frontend** — country/compliance config, compliance status display, warnings surfacing.

### 3. Deeper modelling (anticipated in the design, not yet built)
- [ ] **QR & signing rules** as profile fields (SA/IT-B2C/PT/LATAM QR; per-country cert type).
- [ ] **Withholding & multi-tax population** — engine currently emits one component for most countries.
- [ ] **OSS destination rates** — use the buyer profile's rate (placeholder today).
- [ ] **Multi-entity / non-established supplier** — app assumes a single `company.findFirst()`.
- [ ] **Certificate lifecycle** — expiry/renewal/HSM monitoring.
- [ ] **VIES / registry validation** — wire a real validator behind `VatValidator`.

### 4. Data accuracy
- [ ] Profiles built by archetype carry `BEST_EFFORT`/`PLANNED` rates and dates inferred from
  `docs/compliance/` — graduate them to verified `OFFICIAL` bespoke profiles per country as needed.

---

## Suggested order
1. NestJS + Prisma wiring (store + models) — unlocks persistence for everything else.
2. Tax engine into `invoices.service.ts` (replaces hardcoded 293B) — immediate correctness win, low risk.
3. Lifecycle/immutability into the invoice flow + format layer (`en16931` real via `@fin.cx/einvoice`).
4. One reference transmission end to end (e.g. FR PDP **or** MX PAC) incl. clearance/outbox.
5. Reporting + breadth; fill remaining national formats/channels incrementally behind the registries.

---

*Status as of branch `feat/compliance-architecture`. Update this file as stubs are replaced.*
