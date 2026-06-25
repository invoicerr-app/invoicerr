# Master roadmap — legally-correct, country-aware document subsystem (end to end)

> Single progressive plan for the whole document subsystem: quotes, invoices, recurring, corrections,
> payments — plus the cross-cutting legal/functional axes a real invoicing product must have. It folds
> in the earlier briefs (country/money migration, per-country required fields, frontend country-aware,
> the frontend analysis), which were deleted. `TODO_REVIEW_PARTY_IDENTIFIER.md` was a one-shot review
> note (already completed + self-deleted by the executor).
>
> This v2 was rewritten after a feature/legal audit (web research on invoicing-software features +
> EU/FR e-invoicing law) — see "Sources" at the bottom. The audit surfaced **structural** items that
> are cheap now and a painful rewrite later; they are marked 🏛️ **structural**.
>
> Work top-to-bottom; PART II unblocks the rest. Check a box only when implemented **and** verified
> (tsc + jest + a disposable-DB migration check where relevant).

## Legend
`[ ]` todo · `[~]` partial · `[x]` done&verified · 🔒 blocks others · ⚖️ legal-correctness ·
🧨 data-destructive if naive · 🏛️ structural (data-model-shaping; anticipate now or pay later)

## How to use this document — for the executor (opencode)
This is an **executable, living roadmap** — work it; do **not** delete it (unlike the one-shot
`TODO_REVIEW_*.md` notes). Operating contract:

1. **Work directly in the current branch — no PRs.** Commit straight to it. **One cohesive section per
   commit**, never bundle unrelated sections (especially never bundle a destructive migration with
   anything else). Pick the next work respecting dependencies: PART II foundations come first;
   otherwise follow the **"Suggested execution order"** at the bottom.
2. **Consume the engine, don't rebuild it** (see I.0): the per-country legal logic lives in
   `backend/src/compliance/` (the `ComplianceService` facade + profiles). Call it; if something is
   missing, add a **declarative profile axis**, never a per-country `if`. Keep `backend/src/compliance/**`
   pure (no NestJS/Prisma imports).
3. **Migrations**: additive by default; **data-preserving** (hand-write the backfill `INSERT…SELECT`
   **before** any `DROP`/destructive step — Prisma won't). Apply/reset **only against a disposable
   Postgres**, never the shared dev DB and never production.
4. **Reuse, don't duplicate**: the `ComplianceService` facade, `decimalsFor`/`toMinor`/`fromMinor`,
   the `PartyIdentifier` generic-table pattern, the single `form-schema` endpoint, and the shared
   frontend components (`country-select`, `<DynamicFields>`, …). No second mechanism for the same job.
5. **Frontend**: never a per-country `if` — render from the server descriptor or the resolved `plan`;
   add every new string to **all 18 locales** (`frontend/src/locales/*`); put `data-cy` on every new
   interactive element. (Full conventions in VI.0.)
6. **Verify before ticking a box** — don't trust, verify: `npx tsc --noEmit` (backend **and**
   frontend) + `npx jest` (backend) + **actually run the relevant Cypress e2e** (not just tsc/jest) +
   a disposable-DB `prisma migrate deploy` when a migration is involved. A box is `[x]` only when it
   passed. **When you add/move/rename a module, provider, or `@Injectable()`, also boot the app
   (`nest start`) and confirm "Nest application successfully started" with no DI resolution error** —
   tsc and jest do NOT exercise the Nest DI graph (a missing provider registration went undetected for
   3 sections this way). For `tsc -b`, read the real exit code — `| tail`/`| grep` masks it.
7. **On completion of a section**: tick its boxes here **and** add one line to
   `documentation/compliance/COMPLIANCE_STATUS.md`.
8. **When a legal specific is ambiguous**, flag it / leave the item `[~]` with a note — do **not**
   guess at a legal rule.

## Traceability — GitHub issue ↔ section
Open issues this roadmap answers (keep in sync when issues are opened/closed):

| Issue | Title | Section(s) |
|-------|-------|-----------|
| #189 ⚖️P1 | E-invoicing compliance (Factur-X, **PDP/PA via plugins**, audit trail) | PART X.1, II.4, IX |
| #264 ⚖️P1 | **PL: KSeF** (legal XML, gateway upload, UPO/KSeF ID) | PART X.1 (named target) |
| #186 ⚖️P1 | Functional video review (draft/lock/credit-note/catalog/deposit/AP…) | I.1, II.3✅, II.5, III.3, III.4, IV, VI.10, VII |
| #191 P2 | Invoice workflow rework (draft✅, lock✅, credit notes, no-dup, partial✅) | I.1, II.3✅, III.1, IV |
| #322 ⚖️P2 | Warn user the invoice will be **locked** before issue | VI.4 (issue confirm = lock warning) |
| #134 P1 | Credit notes (avoir) | PART IV |
| #203 | Deposit invoices (factures d'acompte) | III.4 |
| #202 P2 | Recurring invoices (fix + generate real invoices) | III.3 |
| #326 P1 | Partial invoicing | III.5 (✅ partial payments) / III.1 |
| #300 P2 / #181 P2 | Discounts / fractional units | II.5 (line model), VI.3 |
| #251 P2 | No due date in 2027 | VI.3 (payment terms / due-date rule) |
| #258 P2 | Client-scoped doc id instead of INV | II.3 `seriesScope`, II.5 |
| #340 P3 | Import back-dated invoice for history migration | II.5 (`issuedAt` set on import; no gap in live series) |
| #192 P2 | Revenue calculation | V.4 |
| #198 P2 / #254 P1 | Quote/Invoice interface rework / line-item transfer | VI.3, VI.6 |
| #253 ⚖️P3 | DE: expense tracking + EÜR (GoBD) | **OUT OF SCOPE** (invoicing only — see VII note) |

---

# PART I — Principles & the legal model

## I.0 The one orienting principle
The compliance engine (`backend/src/compliance/`) **already models most per-country legal variation as
data** — consume it, don't rebuild it:
- `operations/compliance-service.ts` `ComplianceService` facade: full lifecycle (`createDraft`,
  `editDraft` DRAFT-only, `issue`, `send`, `submitForClearance`, `correct`, `issueCreditNote`,
  `issueDebitNote`, `issueCorrectiveInvoice`, `cancel`, `cancelAndReplace`, `openResponseWindow`,
  `markPaid`, `archiveDocument`, `validate`).
- `correct()` dispatches on `plan.lifecycle.correctionModel` (CREDIT_NOTE / CORRECTIVE_INVOICE /
  CANCEL_AND_REPLACE); `cancel()` is gated by the per-country `cancellation` policy.
- `profiles/schema.ts`: `LifecyclePolicy { immutableAfter, correctionModel, cancellation, response,
  contingency }`, `NumberingRule { model, seriesScope, hashChain }`, `ArchivalPolicy { retentionYears,
  residency, archivedForm, integrity }`.
- Prisma already has `ComplianceDocument` (FK `invoiceId`), `ComplianceEvent` (append-only journal),
  archival/driver tables; `ComplianceModule` wires the facade onto the Prisma store.

**Architecture decision (final):** `Invoice`/`Quote` rows stay the entities the UI edits; every
lifecycle transition drives `ComplianceService`, which persists/links a `ComplianceDocument` and runs
the runtime; status/number/correction links reflect back onto the row. Modules call the facade — no
parallel lifecycle.

## I.1 Two-phase existence
DRAFT (working edit, **not** a legal document — no number, freely editable/deletable) vs ISSUED (and
beyond). **Issuance ≠ sending** (you can issue without emailing, and re-send). Today the app conflates
them — add an explicit issue step.

## I.2 Numbering law ⚖️
Number assigned **only at DRAFT→ISSUED**, never at creation/read/for a draft. **Gapless per series**
(`NumberingRule.seriesScope`), `{year}` from the **issue date**. Consequence: an **issued document is
never hard-deleted** (gap) — only cancelled. `AUTHORITY_RANGE` (MX folios) → number from the authority
at clearance.

## I.3 Immutability & modification per country ⚖️
DRAFT → free edit. ISSUED → governed by `immutableAfter` (ISSUE / CLEARANCE / NEVER) + `correctionModel`
(edit vs credit note vs corrective invoice vs cancel&replace) + `cancellation` policy. The UI surfaces
**only the action the country allows**.

## I.4 Document-type taxonomy 🏛️
The subsystem must model more than "invoice": **proforma** (non-legal pre-doc), **quote/devis**,
**deposit/advance invoice (facture d'acompte)** + its **final invoice with deduction**, **invoice**,
**credit note**, **debit note**, **corrective invoice**, **payment receipt** (MX complemento), and —
for reception — **received/inbound documents** (PART VII). The canonical model has `DocumentKind`;
the live `Invoice` table needs a `kind` + correction/deposit links (PART II / III).

## I.5 Software-level inalterability (ISCA / FR anti-fraud / NF525) 🏛️⚖️
French CGI art. 286: software used to invoice **B2C** must guarantee **I**nalterability,
**S**ecurisation, **C**onservation (6–10 yrs), **A**rchivage, with a **timestamped, inalterable audit
trail**, and — since **2026-09-01** — **NF525 third-party certification** (internal attestation no
longer sufficient; fine 7 500 €/software). This is not a feature, it's a constraint on the whole data
model: append-only history, no destructive edits/deletes of validated records, hash-chaining, audit
export. Foundational — see PART II.4.

## I.6 Wire the whole system end-to-end BEFORE deepening per-country stubs 🔒 (priority rule)
**Breadth-first, not depth-first.** The first goal is a **fully connected vertical slice**: every live
flow (invoice/quote/recurring/payment/correction/cancel) routed through the `ComplianceService` facade,
**and** every screen wired to the real backend (issue/correct/cancel/mentions/lifecycle UI). Today the
engine is built but **not called from `src/modules/*`** (only TODO comments) — that gap is the top
priority. Only **after** the frontend and backend are connected end-to-end do we go back and fill the
per-country execution depth: the execution stubs **enumerated in PART XI** (≈43 national formats + ≈50
authority portals + the fixed provider/handler stubs — far more than the 62 raw `.todo()` call-sites,
because two of them are data-driven families that fire once per country), graduating archetype profiles
to verified `OFFICIAL`, and real clearance transmission (PART X). In short: **connect everything first,
perfect each country second.** A country running on a `FALLBACK`/`BEST_EFFORT` plan but fully wired is
more valuable now than one `OFFICIAL` country with the rest disconnected. Surface plan `confidence`
(OFFICIAL/BEST_EFFORT/FALLBACK) in the UI (VI.4) so users see the maturity while breadth lands first.

---

# PART II — Foundations 🔒 (do first; everything depends on these)

## II.1 Finish PartyIdentifier 🔒
- [x] `legalId`/`VAT` → generic `PartyIdentifier` table, per-country required identifiers, dynamic
  forms, data-preserving migration (backfill before DROP). *(done by the executor; verify the e2e
  fixture fixes + required-enforcement landed before relying on it.)*

## II.2 Money Float→minor units — Phase 4 cutover 🧨
Phases 1–3 done (additive `*Minor`, backfill, dual-write, stats in minor units). Remaining:
- [ ] Cutover in its own commit once dual-write soaked: confirm no reader uses the Float columns, drop
  them, rename `*Minor`→base, switch reads off `fromMinor`. `quantity`/`vatRate`/`discountRate` stay
  Float (not money).

## II.3 Numbering overhaul ⚖️🔒🧨 — ✅ DONE & verified (commits `7fcbed2` + numbering fixes; **unit tests still owed**)
~~Today `prisma.service.ts` (`$extends`) numbers **every** Quote/Invoice/Payment on create, update, **and
on every `findMany`** — so drafts get legal numbers merely by being listed; `number` is
`autoincrement()` consumed at creation with gaps on draft deletion; `formatPattern` uses `createdAt`.~~
(Fixed: `$extends` removed; `NumberingService` + `NumberSeries`; gapless, atomic, starting-number-aware,
`seriesScope`-driven; reviewed in `TODO_REVIEW_NUMBERING.md` and corrected.)
- [x] ⚖️ Remove the auto-numbering `$extends` entirely.
- [x] ⚖️ Make `number` nullable (drop `autoincrement()`), add `issuedAt DateTime?`. Draft = all null.
  Backfill existing issued rows (`issuedAt = createdAt`, keep numbers).
- [x] ⚖️ Gapless per-series counter assigned transactionally at issue (`NumberSeries` keyed by
  `(companyId, docType, scopeKey)`, bumped via `INSERT…ON CONFLICT…RETURNING` **inside the caller's
  `$transaction`** so counter+row are atomic). Race-safe. `scopeKey` from `seriesScope`; year from
  `issuedAt`. First number = company `*StartingNumber`.
- [x] ⚖️ Issued documents never hard-deleted (`deleteInvoice`/`deleteQuote`/`editInvoice` → DRAFT only;
  `editQuote` blocked once SIGNED).
- [~] Drive off `plan.numbering`: `GAPLESS_SELF` → local counter (done; resolved from the country
  profile); `AUTHORITY_RANGE` → **currently refuses self-assignment (throws)** — the provisional
  number / real-at-clearance path is deferred to PART X.1.
- [ ] Tests: issue assigns next gapless number; deleting a draft leaves no gap; concurrent issues
  don't collide; listing drafts assigns nothing. **Not yet written** — `utils/numbering.ts` has no
  dedicated unit test (the 352 green are pre-existing engine tests). ⚠️ owed.

## II.4 Inalterability & audit trail (ISCA / anti-fraud) 🏛️⚖️🔒
The keystone legal constraint (I.5). Much aligns with existing pieces (`ComplianceEvent` append-only
journal, `NumberingRule.hashChain`, `ArchivalPolicy.integrity: HASH_CHAIN`) — but the **live**
Invoice/Quote/Payment flow isn't covered.
- [ ] ⚖️ **Immutable audit trail**: every state-changing action on an issued document (issue, send,
  correct, cancel, pay, status change) appends a timestamped, user-attributed, **non-editable** record
  (who/when/what/before→after). There is a `log` table today — assess whether it meets ISCA or whether
  the `ComplianceEvent` journal becomes the system of record for live documents.
- [ ] ⚖️ **No destructive mutation of validated records**: enforce at the service layer (and ideally DB
  triggers/permissions) that issued docs can't be updated/deleted outside the correction/cancel paths.
- [ ] **Hash-chaining**: chain issued documents (prev-hash → current) so tampering is detectable, per
  `NumberingRule.hashChain` / `ArchivalPolicy.integrity`. Wire the engine's hash logic to live issue.
- [ ] **Conservation & archival**: retention per `ArchivalPolicy.retentionYears`/`residency`; archived
  form per profile; the WORM/local archive providers exist as stubs — connect at issue/clearance.
- [ ] **Audit export**: a fiscal-audit export (FR **FEC**, others **SAF-T**) of the immutable journal
  in an auditor-readable format. The engine has reporting handlers (SAF-T etc.) — surface a real export.
- [ ] **Certification posture**: document the NF525 path / publisher attestation as a project goal;
  the above are its technical prerequisites. (No code, but track it so the data model stays compatible.)

## II.5 Shared document data-model fields 🏛️
Add the legally/functionally required fields the canonical model already anticipates but the live
tables lack (additive). These touch Invoice + Quote + line items:
- [x] `kind` (INVOICE/CREDIT_NOTE/DEBIT_NOTE/CORRECTIVE_INVOICE/PROFORMA/DEPOSIT/FINAL) + `issuedAt`
  + `correctsInvoiceId` (self-relation) + `depositOfInvoiceId` (self-FK, linking logic in III.4).
- [x] **Buyer reference / PO / contract ref** (EN 16931 BT-13; mandatory for B2G Chorus Pro: service
  code / engagement number). Free-text + optional structured.
- [x] **Delivery info**: delivery date + delivery address (EN 16931 BG-13; FR 2026 new mandatory
  "adresse de livraison" when ≠ billing).
- [x] **Payment terms**: explicit due-date rule, payment means code (EN 16931 BG-16), and the
  country-mandated penalty/indemnity mentions (PART V.1).
- [x] **FX**: when invoice currency ≠ company base/tax currency, capture the exchange rate + tax
  amount in the tax currency at issue (engine `requiresTaxCurrency`). 🏛️ — retrofitting FX later is
  painful.
- [x] **Tax-inclusive (TTC) pricing flag** 🏛️: B2C/retail enters prices VAT-inclusive. Store whether a
  line/document is entered inclusive or exclusive and round per the country's rule. Affects the money
  model — decide now (the minor-units work is the right time).
- [x] **Line model**: line-level discounts/allowances + charges (shipping/handling) and a real
  **unit of measure** code (EN 16931) beyond the current `ItemType`. (Couples with multi-tax, PART X.)
> **Already done — no work here** (verified 2026-06-25): client **B2B/B2C** (`ClientType
> {INDIVIDUAL,COMPANY}`, default COMPANY) is modeled and wired front+back (`client-upsert.tsx` toggle,
> `required-fields` filters identifiers by `partyType`). Email is **not** a primary key (`id` is a
> cuid) and `contactEmail` is already optional — #186's "email = PK" is stale. Residue lives in
> existing items: the B2C **TTC default** = the tax-inclusive flag above; the **buyer SIREN** mention
> = V.1.

---

# PART III — Per-document-type work

## III.1 Invoices ⚖️
- [ ] Explicit **issue/finalize** action (`POST /invoices/:id/issue`): validate draft → `issue` via
  facade → assign gapless number (II.3) → set `issuedAt` → persist/link `ComplianceDocument` →
  DRAFT→ISSUED(UNPAID); clearance countries then `submitForClearance` (PART X).
- [ ] Restrict `editInvoice` to **DRAFT only**; issued → return the country-allowed action (PART IV).
  Route create/edit through `createDraft`/`editDraft`.
- [ ] `sendInvoiceByEmail` = send only (no numbering side-effect); sending an un-issued draft issues
  it first.
- [ ] Reconcile `InvoiceStatus` with compliance statuses (add ISSUED/PENDING_CLEARANCE/CLEARED/
  CANCELLED/CORRECTED or map) — one vocabulary, not two.
- [ ] Frontend: progression view gains **Issue** before Send; edit disabled once issued; correction/
  cancel actions per country (PART IV).

## III.2 Quotes (devis) ⚖️
- [ ] Guard `editQuote`: a **SIGNED** quote is immutable (today unguarded) — re-issue a version.
- [ ] Quote numbering follows II.3 (`docType='quote'`).
- [ ] `createInvoiceFromQuote`: only from an accepted/signed status; creates a DRAFT invoice (it does),
  stamps `quoteId`; issue via III.1.
- [ ] Frontend: disable edit on signed; "Convert to invoice" only when allowed.

## III.3 Recurring invoices (factures récurrentes) ⚖️
Today: daily `@Cron`, generates via `createInvoice` (→ DRAFT but **immediately numbered by the
$extends bug**), optional `autoSend`, advances `nextInvoiceDate` (which wrongly snaps every result to
the next **Monday**).
- [ ] ⚖️ A `RecurringInvoice` is a **template, not a legal document** (no number — keep it so).
- [ ] ⚖️ Each cycle generates an `Invoice` as **DRAFT, unnumbered** (needs II.3), then: `autoIssue`
  (new flag, distinct from `autoSend`) → issue (+ send if `autoSend`); else leave DRAFT for review.
- [ ] ⚖️ **Idempotency**: unique `(recurringInvoiceId, periodKey)` so a re-run/overlap/retry can't
  double-generate. Current `count` check is insufficient.
- [ ] ⚖️ **Issue date = scheduled cycle date** (not cron-run day); **catch up** missed cycles
  individually with their correct dates after downtime.
- [ ] Fix `calculateNextInvoiceDate` (drop the force-to-Monday loop; anchor on the template start day;
  only WEEKLY/BIWEEKLY are weekday-based).
- [ ] Failure handling: issue ok + send fails → stays ISSUED, send retried (consumer of the outbox,
  PART IX); never silently advance past a failed cycle.
- [ ] Template controls: pause/resume, skip next, end now; editing the template never mutates already-
  issued invoices.
- [ ] Frontend: expose autoIssue/autoSend/pause/skip; list shows next/last run, generated count,
  failed cycles needing attention.

## III.4 Deposit (acompte) & proforma documents 🏛️⚖️
- [x] **Proforma**: a non-legal pre-invoice (no number, not in the gapless series); convertible to a
  real invoice. New `kind = PROFORMA`.
- [x] **Deposit/advance invoice (facture d'acompte)** ⚖️: in FR a deposit payment **requires** a
  deposit invoice; the **final invoice deducts** the deposited amount and references the deposit
  invoice(s). Model the deposit→final link and the deduction line; both are numbered legal documents.
- [x] Frontend: "Request deposit" / "Issue deposit invoice", and final-invoice UI that shows/deducts
  prior deposits.

## III.5 Payments (receipts → payments) ⚖️
Partial payments + minor-units done. Remaining:
- [ ] Payment-receipt numbering follows II.3 (`docType='payment'`).
- [ ] Overpayment/refund reconciles with the correction model (may require a credit note per country,
  not a silent negative row).
- [ ] Clearance countries: a payment receipt may itself need reporting/clearance (MX complemento) —
  via the engine (PART X).

---

# PART IV — Corrections, cancellation & the per-country modification system ⚖️
Engine-side built; wire it + UI + links.
- [ ] Schema: `kind` + `correctsInvoiceId` (II.5); corrections are themselves issued, numbered docs.
- [ ] Endpoints delegating to the facade: `POST /invoices/:id/correct` (engine picks credit-note vs
  corrective), `.../cancel` (rejected with the policy reason if forbidden), `.../cancel-and-replace`.
- [ ] ⚖️ Enforce immutability per `immutableAfter`; the API returns the allowed action(s).
- [ ] Frontend: on an issued invoice, replace "Edit" with the country-correct set (Edit-draft / Credit
  note / Corrective invoice / Cancel / Cancel&replace), driven by the resolved plan; show the
  correction↔original link both ways.
- [ ] Tests: FR issued → only credit-note/corrective + edit refused; `cancellation.allowed=false` →
  cancel refused with reason; links round-trip.

---

# PART V — Cross-cutting commercial/legal features

## V.1 Mandatory mentions per country (beyond tax) 🏛️⚖️
Today only a hardcoded FR-293B tax line. Required set is broader and per-country:
- [ ] Profile axis for mandatory **mentions**: payment due date/terms, **late-payment penalty rate**
  (FR 0.5%/month min), **fixed recovery indemnity** (FR €40), discount-for-early-payment terms, the
  seller's legal form/capital/RCS, delivery address, nature of operation, buyer SIREN (FR 2026), and
  the **tax mentions** the engine already computes (`plan.tax.mentions`: reverse charge/export/293B).
- [ ] Render all applicable mentions on the PDF + e-invoice + surface in `invoice-view`. (Subsumes the
  old "legal mentions" frontend task.) Missing mentions are fineable (FR €15/mention) — treat as ⚖️.

## V.2 Dunning / reminders / collections
The app has an OVERDUE status but no workflow.
- [ ] Configurable dunning: scheduled reminders before/after due date, escalation levels, auto-applied
  penalties/indemnity (V.1), per-client overrides; templated emails. Naturally rides the cron + outbox
  (PART IX).
- [ ] Frontend: reminder schedule config, per-invoice dunning state, "send reminder now".

## V.3 Multi-currency correctness
- [ ] FX rate capture at issue (II.5) + show base-currency equivalents; enforce/ warn on
  `requiresTaxCurrency` (e.g. MX must invoice in MXN).

## V.4 AR reporting
- [ ] Customer statements (relevé de compte), AR aging report, outstanding/overdue dashboards. (The
  fiscal-audit export FEC/SAF-T is II.4.)

---

# PART VI — Frontend (exhaustive, screen-by-screen)

This is the single complete catalogue of frontend work; the per-section "Frontend:" lines above are
pointers into it. Every item names the real component(s). Nothing here renders a per-country `if` — UI
reads from the server descriptor (`form-schema`) or the document's resolved `plan`.

## VI.0 Cross-cutting conventions (apply to every item below)
- [ ] **i18n — 18 locales**: `frontend/src/locales/{ar,cs,da,de,en,es,fr,he,it,ja,ko,nl,pl,pt-BR,ru,sv,uk,zh-Hans}/translation.json`.
  Every new string is a `t()` key added to **all** locales (at minimum en+fr translated, the rest
  copied from en as fallback — never a hardcoded literal). Country/scheme **labels come from the
  backend descriptor**, not from i18n, so they stay correct per country.
- [ ] **RTL**: `ar` and `he` are right-to-left — new layouts must not break under `dir="rtl"`; the
  rendered PDF must also handle RTL for those buyer/seller locales.
- [ ] **`data-cy`** on every new interactive element (inputs, buttons, selects, rows) — the e2e suite
  selects by `data-cy`; follow the existing `entity-field`/`entity-action` naming.
- [ ] **Reuse** existing shared components: `country-select`, `currency-select`, `date-picker`,
  `search-input`, `article-picker`, `payment-breakdown` — and the new `<DynamicFields>` (VI.1). Never
  fork a second variant.
- [ ] **Query hygiene**: invalidate the right `queryKeys` after every mutation (the codebase uses
  TanStack Query); add new `use-*` hooks under `frontend/src/hooks/`.
- [ ] **Types**: keep `frontend/src/types/*.ts` in sync with the API (every new field/relation).

## VI.1 Shared descriptor infra 🔒 (build first — VI.2/VI.3 depend on it)
- [ ] `frontend/src/hooks/use-form-schema.ts` — generalise `use-required-identifiers.ts` into one hook
  keyed on `(countryCode, partyType)` returning `{ identifiers, address, bankDetails, mentions,
  defaults }`.
- [ ] `frontend/src/components/dynamic-fields.tsx` — one renderer for descriptor-driven fields
  (text + pattern hint + required + helpText; field-array for repeatable schemes, mirroring
  `invoice-line-items-editor.tsx`'s `useFieldArray`). **Refactor the existing inline identifier
  rendering** in `client-upsert.tsx`/`company.settings.tsx`/`onboarding.tsx` into this component.
- [ ] Backend: widen `GET /api/compliance/required-fields` → `GET /api/compliance/form-schema`
  returning all descriptor sections (keep a thin alias or migrate the caller; no two endpoints).

## VI.2 Entity forms — company & client
Files: `settings/_components/company.settings.tsx`, `clients/_components/client-upsert.tsx`,
`components/onboarding.tsx`.
- [x] Dynamic identifiers (done — PART II.1) and country-driven required validation (done).
- [ ] **Address ⚖️ (descriptor-driven)**: region/state field visibility + label
  ("State"/"Province"/"Prefecture"/"Region") and postal-code required/pattern come from
  `schema.address`; today `state` is hardcoded optional and postal uses one global regex.
- [ ] **Bank details ⚖️ (company only)**: replace the single free-text field in
  `payment-methods/_components/payment-method-upsert.tsx` (and the `PaymentMethod.details` model) with
  structured per-country schemes (IBAN/BIC, US routing+account, UK sort code, MX CLABE, IN IFSC…)
  rendered via `<DynamicFields>` from `schema.bankDetails` resolved on the **company's** country.
- [ ] **Defaults**: date format defaulted from country; currency already via `use-country-to-currency`
  — add a non-blocking warning when invoice currency ≠ `schema.defaults.taxCurrency` (e.g. MX→MXN).

## VI.3 Document forms — invoice / quote / recurring line items
Files: `invoices/_components/invoice-upsert.tsx`, `quotes/_components/quote-upsert.tsx`,
`invoices/_components/recurring-invoices/recurring-invoices-upsert.tsx`,
`invoices/_components/invoice-line-items-editor.tsx`.
- [ ] **Buyer reference / PO / contract ref** field (mandatory for B2G); **delivery date + delivery
  address** fields (FR 2026 mandatory when ≠ billing) — bound to the new model fields (II.5).
- [ ] **Line items editor**: line-level **discount/allowance**, **charges** (shipping/handling) rows,
  a real **unit-of-measure** select, and a **TTC/HT (tax-inclusive) toggle** that recomputes the
  displayed totals per the country's rounding rule (II.5).
- [ ] **FX**: when invoice currency ≠ company base currency, show the captured rate + base-currency
  equivalent (read-only) (V.3).
- [ ] Currency/identifier prefill from the selected client.

## VI.4 Invoice lifecycle UI ⚖️
Files: `invoices/_components/invoice-progression.tsx`, `invoice-view.tsx`, `invoice-list.tsx`,
`invoices/index.tsx`.
- [ ] **Issue/finalize step**: progression view gains an explicit **Issue** step *before* Send
  (calls `POST /invoices/:id/issue`), with a confirm dialog. ⚖️ The dialog **must warn the document
  will be locked / non-editable for regulatory compliance** before confirming (#322). A DRAFT shows a
  **"no number yet"** state (the draft watermark exists); the legal number appears only after issue.
- [ ] **Edit gating**: "Edit" is enabled only while DRAFT; once issued it is replaced by the
  country-correct actions (VI.5).
- [ ] **Status model**: list filters + badges for the reconciled statuses (DRAFT/ISSUED/SENT/
  PENDING_CLEARANCE/CLEARED/PAID/OVERDUE/CANCELLED/CORRECTED/ARCHIVED); the multi-select status filter
  added by dev must include the new ones.
- [ ] **Compliance status display**: surface the resolved plan's `confidence` (OFFICIAL/BEST_EFFORT/
  FALLBACK) and `warnings`, plus clearance state (PENDING/CLEARED) and `availableActions()` from the
  runtime, on `invoice-view.tsx`.

## VI.5 Corrections & cancellation UI ⚖️
File: `invoice-view.tsx` (+ list row actions).
- [ ] On an **issued** invoice, replace "Edit" with the **country-correct action set** read from the
  plan: Edit-draft | Issue credit note | Issue corrective invoice | Cancel | Cancel & replace —
  driven by `plan.lifecycle.correctionModel`/`cancellation`, never a hardcoded `if`.
- [ ] Show the **correction ↔ original link** on both documents; a "Corrections" section listing
  related credit/corrective notes; a `kind` badge (Invoice / Credit note / Corrective / Deposit /
  Proforma).
- [ ] Surface the policy reason when an action is refused (e.g. "cancellation not allowed — issue a
  credit note").

## VI.6 Quotes UI ⚖️
Files: `quotes/_components/quote-upsert.tsx`, `quote-view.tsx`, `quote-list.tsx`.
- [ ] Disable edit on a **SIGNED** quote (re-issue a version instead); show version/lineage.
- [ ] "Convert to invoice" only enabled from an accepted/signed status.

## VI.7 Recurring invoices UI
Files: `invoices/_components/recurring-invoices/{recurring-invoices-upsert,recurring-invoices-list,recurring-invoices-view}.tsx`.
- [ ] Template editor exposes **autoIssue** (new) vs **autoSend**, **pause/resume**, **skip next
  cycle**, **end now**.
- [ ] List/view shows **next run**, **last run**, **generated count**, and **failed cycles needing
  attention** (with a retry action); a list of the invoices generated by the template.

## VI.8 Deposit & proforma UI ⚖️
Files: invoice create flow + `invoice-view.tsx`.
- [x] "Request deposit / Issue deposit invoice (acompte)" action; **proforma** create + "Convert to
  invoice"; final-invoice UI that **shows and deducts** prior deposit invoices; `kind` badges (VI.5).

## VI.9 Payments UI ⚖️
Files: `payments/_components/{payment-upsert,payment-list,payment-pdf-view}.tsx`,
`invoices/_components/payment-received-dialog.tsx`, `components/payment-breakdown.tsx`.
- [ ] Show the payment **receipt legal number** (II.3); a **refund/overpayment** path that routes
  through the country-correct correction (credit note) instead of a silent negative row (III.5).

## VI.10 Mentions & PDF rendering ⚖️
Files: server template `backend/src/modules/invoices/templates/base.template.ts` (+ quotes/payments
templates), `invoices/_components/invoice-pdf-view.tsx`, `quotes/_components/quote-pdf-view.tsx`,
`payments/_components/payment-pdf-view.tsx`, `settings/_components/pdf.settings.tsx`.
- [ ] Render **all mandatory mentions** (tax mentions from `plan.tax.mentions` **and** the non-tax
  legal ones from V.1: payment terms, late-penalty rate, €40 indemnity, delivery address, nature of
  operation, buyer SIREN) — replacing the hardcoded FR-293B `vatExemptText`. Surface the same in
  `invoice-view.tsx`.
- [ ] `pdf.settings.tsx`: add label entries for the new fields/mentions; ensure the in-app PDF preview
  components reflect them.

## VI.11 Dunning / reminders UI
Files: new settings section + `invoice-view.tsx`/`invoice-list.tsx`, `invoices/index.tsx`.
- [ ] Reminder-schedule config (escalation levels, offsets, templates) in settings; per-invoice
  **dunning state**; a **"send reminder now"** action; an overdue dashboard/widget (V.2).

## VI.12 AR reporting UI
- [ ] **Customer statement** (relevé de compte) page per client; **AR aging** report/dashboard;
  outstanding/overdue totals (V.4). (Fiscal-audit FEC/SAF-T export is a backend download — II.4.)

## VI.13 Reception / AP UI 🏛️
- [ ] A **"Received invoices"** inbox (new route under `pages/(app)/`): list, view, and **acknowledge**
  inbound e-invoices, with the mandated buyer-status actions (PART VII). New `router.ts` entry + nav.

## VI.14 Multi-entity UI 🏛️
- [ ] An **entity switcher** in the sidebar/top-nav; all screens scope to the active entity; per-entity
  settings (numbering series, identifiers, bank details, templates) (PART VIII).

---

# PART VII — Reception / inbound (the AP side) 🏛️⚖️
**Legal, not optional for the home market:** from **2026-09-01 every French business must be able to
*receive* e-invoices** (emission for SMEs follows 2027). The app is AR-only today; the engine already
models inbound (`ReceptionService`, inbound-router, `ComplianceInboundMessage`, reception stubs).
- [x] **Scope decided (2026-06-25): Option A — legal-minimum reception only.** Accept, store, and
  acknowledge an inbound e-invoice (via PDP/Peppol/SdI) + emit the mandated buyer status. **No** AP /
  expense / accounting module (that side is out of scope — see the note below). Build exactly enough to
  satisfy the FR 2026-09 reception obligation, nothing more.
- [ ] Wire the inbound router/reception facade to a stored `ReceivedDocument`, with buyer-status
  emission where mandated (FR statuses: accepted/refused/pending), and a UI to view/acknowledge
  received invoices (VI.13). Scope stays minimal per the decision above.
- [ ] This is a whole new document direction — anticipate the data model now (II.5 `direction`
  already exists on `ComplianceDocument`). Couples with the reception stubs in XI.7.

> **Out of scope (decided 2026-06-25):** expense tracking / purchase accounting / EÜR (#253, #186
> item 5). This product does **invoicing only** — no bookkeeping of supplier expenses. The inbound
> `ReceivedDocument` model (above) stays minimal (legal e-invoice reception), not an AP/expense ledger.

---

# PART VIII — Multi-entity / multi-company 🏛️
The app assumes a single issuer (`company.findFirst()` everywhere). Real use (groups, multiple legal
entities, non-established VAT registrations) needs several.
- [ ] Anticipate the data model: documents, numbering series, identifiers, bank details, templates all
  become **per-entity**. Even if multi-entity ships later, the schema/queries should stop hardcoding
  "the one company" so it isn't a later rewrite. At minimum: a real `companyId` scoping on every
  query and numbering series keyed per entity (II.3 already does `companyId`).
- [ ] Entity switcher in the UI; per-entity settings.

---

# PART IX — Durable outbound I/O — outbox on **BullMQ** ⚖️
Inbound is durable; outbound (transmit, submit-for-clearance, recurring auto-send, dunning) is not.
- [ ] Transactional **outbox** + **BullMQ** worker (Redis): intent written in the same tx as the
  status change; worker does the real call with retries/backoff/idempotency key; marks done only on
  confirmed response. Prevents double-submitting a numbered legal document and silent send drops.
- [ ] Route `transmit()`/`submitForClearance`/recurring send/dunning through it. Add the queue module
  + worker + health, consistent with how `ComplianceCron` is wired.

---

# PART X — Deferred breadth (gated on the above)

## X.1 First real clearance country, end-to-end ⚖️ (issues #189, #264, #186)
- [ ] ⚖️ **Plugin model for PDP/PA / clearance gateways** (#189): a transmission-provider plugin
  interface (authenticate → build legal payload → submit → poll/ack → store authority id + receipt),
  registered per country in the engine's `providers/transmission/`, mirroring the signing-plugin
  pattern. Each country binds its provider declaratively in the profile — never a per-country `if`.
- [ ] Drive the lifecycle end-to-end for **one** clearance country as the reference implementation —
  pick from: **FR PDP** (Factur-X + PDP), **PL KSeF** (#264: legal XML → MF gateway → UPO/KSeF ID;
  refs: CIRFMF/ksef-docs, ksef-client-ts), or **MX PAC** (CFDI/folios). Real transmission; unblocks
  real `AUTHORITY_RANGE` numbering (II.3 — replaces the current throw) + payment clearance (III.5).
- [ ] Generalise from that one to the other named targets (FR / PL / MX) once the seam is proven.

## X.2 Other deferred breadth
- [ ] Multi-tax / withholding line items (engine models `TaxComponent[]`/`Withholding`; live line +
  column don't) — couples with the line model (II.5).
- [ ] QR & signing on the PDF (after signing providers are real).
- [ ] Document taxonomy / B2G specifics (Chorus Pro service code ↔ buyer reference V/II.5;
  boleta/guía/complemento).
- [ ] Invoice rendered in the buyer's mandated language.
- [ ] Graduate archetype profiles to verified `OFFICIAL` (per-country sign-off that the resolved plan
  matches the law; flip `confidence` once a real document has cleared end-to-end for that country).
- [ ] Fill the execution stubs — **enumerated one-by-one in PART XI** (every `.todo()` is its own box).
- [ ] Online payment collection (pay-by-link) — optional product feature, not legal.

---

# PART XI — Execution stubs, enumerated (the `.todo()` inventory) 🔒-LAST
**This is the depth phase (I.6): do it only once everything is wired end-to-end.** Each box maps to a
real `log.todo(...)` site in `backend/src/compliance/` — **except** the two data-driven families
(`XI.1-NAT` formats, `XI.2-NAT` portals) where a single `format/${spec.id}` / `transmission/${spec.id}`
call-site fires once per country spec, so each country gets its own box. Each stub currently logs a TODO
and returns a placeholder; "done" = the placeholder is replaced by the real implementation **and** there
is a test (unit or fixture) proving it. Group rules:
- **Purity**: keep `compliance/**` free of NestJS/Prisma. A stub that needs I/O (network, disk, DB)
  takes its dependency as an injected provider/port — the Nest layer supplies the concrete adapter.
- **Acceptance per group** is stated under each heading; a box is `[x]` only when it meets that bar.
- A stub that needs real credentials/sandbox (clearance gateways) is `[~]` with a note until the
  sandbox is wired (don't fake a pass).

## XI.1 Format providers — build + validate national payloads
File: `providers/format/providers.ts`. **Acceptance:** builds a schema-valid artifact from a canonical
document **and** `validate` runs the official schema/Schematron against a committed sample fixture.
- [ ] `format/en16931` — build the artifact via `@fin.cx/einvoice` (`EInvoice.embedInPdf`/`exportXml`)
  for the requested syntax (UBL / CII / Factur-X). *(EU generic — FR/BE/etc.)*
- [ ] `format/en16931` — validate against the **EN 16931 Schematron**.
- [ ] `format/fatturapa` — build **FatturaPA 1.2** XML for SdI. *(IT)*
- [ ] `format/fatturapa` — validate against the **SdI XSD**.
- [ ] `format/cfdi` — build **SAT CFDI 4.0** XML (Comprobante, Conceptos, Impuestos, UsoCFDI). *(MX)*
- [ ] `format/cfdi` — validate against the **SAT XSD + business rules**.
- [ ] `format/fa-vat` — build **Polish FA_VAT (FA(2)/FA(3))** XML for KSeF. *(PL — #264)*
- [ ] `format/fa-vat` — validate against the **Ministry of Finance XSD**.
- [ ] `format/ksa-ubl` — build **ZATCA UBL 2.1 + KSA extension** and the QR payload. *(SA)*
- [ ] `format/ksa-ubl` — validate against **ZATCA rules**.
- [ ] `format/national-xml` — build the national clearance XML for `ctx.supplier.countryCode` (generic
  fallback until a dedicated per-country provider exists).
- [ ] `format/national-xml` — validate against the national schema.
- [ ] `format/plain-pdf` — render the PDF via the existing `getInvoicePdf()` Handlebars template (the
  non-clearance default channel; reuse, don't fork).

## XI.1-NAT National format specs (43) — `providers/format/national-formats.ts`
Data-driven family: the file loops the spec table and fires `format/${spec.id}` **build + validate**
per country. Each box below = build the country's payload from its `buildHint` **and** validate per its
national schema (`validateHint`). One box per country (build+validate together). *(`id` ↔ spec.)*
**LATAM**
- [ ] `ar-fe` Argentina Factura Electrónica
- [ ] `bo-fe` Bolivia Facturación Electrónica
- [ ] `nfe` Brazil NF-e family
- [ ] `cl-dte` Chile DTE
- [ ] `cr-fe` Costa Rica Factura Electrónica v4.4
- [ ] `do-ecf` Dominican Republic e-CF
- [ ] `ec-fe` Ecuador comprobantes electrónicos
- [ ] `gt-fel` Guatemala FEL
- [ ] `pa-fe` Panama FE/CF
- [ ] `py-de` Paraguay e-Kuatia DE
- [ ] `sv-dte` El Salvador DTE (JSON)
- [ ] `uy-cfe` Uruguay CFE/DFE
- [ ] `ve-fe` Venezuela Factura Electrónica

**Africa**
- [ ] `ng-firs` Nigeria FIRS e-invoice
- [ ] `ke-etims` Kenya eTIMS
- [ ] `gh-evat` Ghana E-VAT
- [ ] `rw-ebm` Rwanda EBM
- [ ] `tz-vfd` Tanzania VFD
- [ ] `ug-efris` Uganda EFRIS
- [ ] `zm-smartinvoice` Zambia Smart Invoice
- [ ] `zw-fdms` Zimbabwe FDMS
- [ ] `ci-fne` Ivory Coast FNE
- [ ] `bj-mecef` Benin e-MECeF

**MENA & Türkiye**
- [ ] `jo-jofotara` Jordan JoFotara
- [ ] `tn-teif` Tunisia TEIF
- [ ] `tr-efatura` Turkey UBL-TR
- [ ] `eg-eta` Egypt ETA e-invoice

**Asia**
- [ ] `id-efaktur` Indonesia e-Faktur
- [ ] `tw-egui` Taiwan eGUI
- [ ] `kz-esf` Kazakhstan ESF
- [ ] `ph-eis` Philippines EIS
- [ ] `th-etax` Thailand e-Tax Invoice
- [ ] `np-cbms` Nepal CBMS
- [ ] `bd-nbr` Bangladesh NBR e-invoice
- [ ] `pk-fbr` Pakistan FBR XIR
- [ ] `cn-efapiao` China e-Fapiao
- [ ] `in-irp` India GST e-invoice
- [ ] `vn-tt78` Vietnam TT78 e-invoice

**Europe (national, outside EN 16931)**
- [ ] `es-facturae` Spain Facturae
- [ ] `ua-taxinvoice` Ukraine tax-invoice
- [ ] `me-fiscal` Montenegro fiscalization
- [ ] `hr-eracun` Croatia e-Račun
- [ ] `al-fiscalization` Albania fiscalization

## XI.2 Transmission providers — submit + poll per channel
File: `providers/transmission/providers.ts`. **Acceptance:** real call behind the transmission-plugin
interface defined in **X.1** (auth → submit → store authority id/receipt; poll maps remote status →
`ComplianceEvent`). Gateways needing sandbox creds stay `[~]` until the sandbox is configured.
- [ ] `transmission/sdi` — submit FatturaPA to **SdI**, await receipt/notifica. *(IT)*
- [ ] `transmission/sdi` — poll SdI notifiche.
- [ ] `transmission/pdp` — annuaire lookup + deliver to recipient **PDP** + push e-reporting. *(FR)*
- [ ] `transmission/pdp` — poll PDP lifecycle statuses.
- [ ] `transmission/pac` — submit to **PAC** for SAT clearance, await UUID/folio fiscal. *(MX)*
- [ ] `transmission/pac` — poll PAC clearance result.
- [ ] `transmission/ksef` — authenticate (token/seal) + submit FA_VAT to **KSeF**, await KSeF reference
  number. *(PL — #264)*
- [ ] `transmission/ksef` — poll KSeF **UPO**/status.
- [ ] `transmission/ose` — submit to **OSE**, await CDR. *(PE / LATAM OSE model)*
- [ ] `transmission/peppol` — **SMP/SML lookup** for the buyer's Peppol id + deliver. *(EU Peppol)*
- [ ] `transmission/gov-portal` — submit to a generic government clearance/reporting API.
- [ ] `transmission/print` — produce a printable representation with QR (offline/contingency channel).
- [ ] `transmission/email` — send artifacts to the buyer via `MailService` (the default non-EDI channel;
  the Nest adapter injects `MailService`, the provider stays pure).

## XI.2-NAT National portal specs (50) — `providers/transmission/national-portals.ts`
Data-driven family: the file loops the spec table and fires `transmission/${spec.id}` **submit + poll**
per country. Each box = real submit to that authority + poll its authorization status (behind the X.1
plugin interface; `[~]` until its sandbox creds exist). One box per authority (submit+poll together).
**LATAM**
- [ ] `afip` Argentina ARCA/AFIP WSFE
- [ ] `bo-sin` Bolivia SIN
- [ ] `sefaz` Brazil SEFAZ
- [ ] `sii` Chile SII
- [ ] `dian` Colombia DIAN
- [ ] `cr-hacienda` Costa Rica Hacienda
- [ ] `dgii` Dominican Republic DGII
- [ ] `sri` Ecuador SRI
- [ ] `gt-sat` Guatemala SAT (FEL)
- [ ] `pa-dgi` Panama DGI
- [ ] `sifen` Paraguay SIFEN
- [ ] `sv-mh` El Salvador MH
- [ ] `uy-dgi` Uruguay DGI
- [ ] `seniat` Venezuela SENIAT

**Africa**
- [ ] `firs` Nigeria FIRS
- [ ] `ke-kra` Kenya KRA eTIMS
- [ ] `gh-gra` Ghana GRA E-VAT
- [ ] `rw-rra` Rwanda RRA EBM
- [ ] `tz-tra` Tanzania TRA VFD
- [ ] `ug-ura` Uganda URA EFRIS
- [ ] `zm-zra` Zambia ZRA Smart Invoice
- [ ] `zw-zimra` Zimbabwe ZIMRA FDMS
- [ ] `ci-dgi` Ivory Coast DGI (FNE/SIGF)
- [ ] `bj-dgi` Benin DGI e-MECeF

**MENA & Türkiye**
- [ ] `zatca` Saudi Arabia ZATCA FATOORA
- [ ] `jofotara` Jordan JoFotara
- [ ] `tn-ttn` Tunisia TTN / El Fatoura
- [ ] `gib` Turkey GİB
- [ ] `eg-eta` Egypt ETA

**Asia**
- [ ] `id-coretax` Indonesia DGT e-Faktur/Coretax
- [ ] `tw-mof` Taiwan MoF
- [ ] `kz-isesf` Kazakhstan IS ESF
- [ ] `ph-bir` Philippines BIR EIS
- [ ] `th-rd` Thailand RD
- [ ] `np-ird` Nepal IRD CBMS
- [ ] `bd-nbr` Bangladesh NBR
- [ ] `pk-fbr` Pakistan FBR
- [ ] `cn-sta` China STA (Golden Tax IV)
- [ ] `in-irp` India IRP (GSTN/NIC)
- [ ] `vn-gdt` Vietnam GDT
- [ ] `myinvois` Malaysia MyInvois (LHDNM)

**Europe**
- [ ] `es-aeat` Spain AEAT SII/Verifactu
- [ ] `ua-dps` Ukraine DPS
- [ ] `me-fiscal` Montenegro fiscalization
- [ ] `hr-fiskalizacija` Croatia Fiskalizacija 2.0
- [ ] `al-cis` Albania CIS
- [ ] `lv-vid` Latvia VID
- [ ] `sk-financnasprava` Slovakia Finančná správa
- [ ] `anaf` Romania ANAF (SPV / RO e-Factura)
- [ ] `rs-sef` Serbia SEF

## XI.3 Signing providers — electronic signatures
File: `providers/signing/providers.ts`. **Acceptance:** produces a verifiable signature over the
rendered artifact using an injected key/cert provider (no secrets in `compliance/**`).
- [ ] `signing/xades` — **XAdES** sign XML payloads (used by several clearance/archival regimes).
- [ ] `signing/pades` — **PAdES** sign PDF payloads.
- [ ] `signing/cades` — **CAdES** sign CMS payloads.

## XI.4 Archive providers — conservation (couples with II.4)
File: `providers/archive/providers.ts`. **Acceptance:** artifacts persisted with retention + integrity
per `ArchivalPolicy`; retrievable for audit; WORM bucket is immutable.
- [ ] `archive/local` — write artifacts to local storage, honour `retentionYears`.
- [ ] `archive/s3-worm` — PUT artifacts to a **WORM** bucket in `residency` region, retain
  `retentionYears`, enforce `integrity` (hash/chain).

## XI.5 Tax-system handlers
File: `taxsystems/handlers.ts`. **Acceptance:** correct computed tax for a fixture set of lines.
- [ ] `taxsystem/sales-tax` — county/city/special-district rate **stacking** on top of the state rate.
  *(US)*
- [ ] `taxsystem/consumption-tax` — consumption-tax **rounding** rules. *(JP and similar)*

## XI.6 Regime handlers — how a country transmits/reports
File: `regimes/handlers.ts`. **Acceptance:** the handler routes a document through the right channel(s)
and records the lifecycle, delegating actual I/O to XI.2.
- [ ] `regime/clearance` — submit for clearance and await authorisation (UUID/folio/protocol) **before**
  the invoice is valid. *(MX/IT-ish)*
- [ ] `regime/decentralized-ctc` — route via PDP/Peppol + extract e-reporting; track lifecycle statuses.
  *(FR 2026)*
- [ ] `regime/periodic-reporting` — enqueue the document into the periodic **SAF-T/ledger** batch.
- [ ] `regime/real-time-reporting` — push transaction data to the authority within the mandated window.
  *(HU/ES-SII-ish)*
- [ ] `reporting/${scope}` — the reporting-kind dispatcher in `reporting/handlers.ts` (one `.todo()`
  fired per `scope`): produce the actual periodic/real-time report payload for each reporting scope and
  enqueue/submit it. Enumerate the scopes from the call sites and tick one per scope.

## XI.7 Reception (couples with PART VII)
File: `reception/reception-service.ts`. **Acceptance:** an inbound document is parsed, validated, stored
as `ReceivedDocument`, and the mandated buyer status is emitted.
- [ ] `reception` — parse + validate an inbound document from `inbound.channel`.
- [ ] `reception` — emit the buyer **status** (e.g. FR accepted/refused/pending).

## XI.8 Operations (facade — `operations/compliance-service.ts`)
**Acceptance:** each lifecycle operation performs its real side-effect (most couple with II.4 / X.1).
- [ ] `operations/issue` — compute a **real content hash** (+ hash-chain link for FR/PT) at issue (II.4).
- [ ] `operations/validate` — aggregate per-artifact `ValidationReport`s into one result.
- [ ] `operations/markPaid` — emit the **"encaissée"** status + payment e-reporting (FR payment CTC).
- [ ] `operations/clearance` — enqueue the document to the **clearance outbox** (PART IX).
- [ ] `operations/clearance` — poll the authority for the clearance result.
- [ ] `operations/cancel` — request the authority's **cancellation acknowledgement**.
- [ ] `operations/contingency` — issue offline (e.g. BR EPEC) and queue late submission.
- [ ] `operations/contingency` — submit the contingency document once the authority is back.

## XI.9 Numbering depth (the II.3 residue + folio pools)
File: `lifecycle/numbering.ts`. **Acceptance:** matches II.3's gapless/atomic guarantees.
- [ ] `numbering/gapless` — **hash-chain link** to the previous document in the series (FR/PT ISCA;
  couples with II.4 hash-chaining).
- [ ] `numbering/folio-pool` — request a new **folio range** from the authority for a series
  (`AUTHORITY_RANGE` — the path II.3 currently throws on). *(MX)*
- [ ] `numbering/folio-pool` — handle **range exhaustion** (request a new range before issuing).

## XI.10 Lifecycle internals
Files: `lifecycle/corrections.ts`, `lifecycle/runtime.ts`, `lifecycle/response.ts`,
`lifecycle/drivers/poll-scheduler.ts`. **Acceptance:** the runtime drives correct events end-to-end
(couples with PART IV + PART IX).
- [ ] `lifecycle/corrections/credit-note` — create a `CREDIT_NOTE` referencing the original.
- [ ] `lifecycle/corrections/corrective-invoice` — create a `CORRECTIVE_INVOICE` for the original.
- [ ] `lifecycle/corrections/cancel-replace` — cancel the original with the authority + issue a
  replacement.
- [ ] `lifecycle/runtime` — map an inbound status to an event in the state machine.
- [ ] `lifecycle/response` — persist an inbound status as a `ComplianceEvent`.
- [ ] `lifecycle/poll-scheduler` — on poll timeout, enter contingency / alert.

> **Coverage check (keep honest):** the inventory above is generated from the actual `.todo()` calls
> (`grep -rn "\.todo(" backend/src/compliance/`). Before declaring PART XI complete, re-run that grep
> — **zero** results means every stub is filled. If new stubs appear, add a box here.

---

# Suggested execution order (dependency-first)
> **Overriding rule (I.6): breadth before depth.** Get the live flow wired to the facade *and* the
> frontend wired to the backend across the whole subsystem **first**; the per-country execution stubs
> (~62 `.todo()`, graduating profiles to `OFFICIAL`, real clearance transmission) are the **last**
> phase, after everything is connected end-to-end.

1. **PART II** foundations: II.1 (done) → **II.3 numbering** (done) + **II.4 inalterability** (the two
   legal keystones) → II.5 fields → II.2 money cutover (independent).
2. **III.1 invoices** (issue step, edit-only-draft) → **PART IV** corrections/cancel.
3. **III.2 quotes**, **III.4 deposit/proforma** (parallelisable).
4. **III.3 recurring** (needs III.1 + benefits from PART IX).
5. **III.5 payments** legal numbering/refund.
6. **PART V** mentions/dunning/FX (V.1 mentions can start early — engine already computes tax
   mentions); **PART VI** frontend (VI.1 infra first).
7. **PART IX** outbox/BullMQ; then **PART VII** reception (legal deadline 2026-09), **PART VIII**
   multi-entity (anticipate schema early even if shipped late).
8. **LAST — per-country depth (PART X + PART XI):** only once everything above is wired end-to-end,
   ship real clearance transmission (X.1), then work **PART XI box-by-box** to fill every `.todo()`
   execution stub, and graduate archetype profiles `FALLBACK`/`BEST_EFFORT` → `OFFICIAL`. Connect
   everything first; perfect each country second. Done when `grep -rn "\.todo(" backend/src/compliance/`
   returns nothing.

> Each completed section: tick its boxes + one line in `documentation/compliance/COMPLIANCE_STATUS.md`.
> Keep this roadmap the live index until the subsystem is complete.

---

## Sources (feature/legal audit)
- EN 16931 core invoice / mandatory business terms — theinvoicinghub.com/en-16931, e-invoice.be/en16931-mapper
- FR mandatory mentions 2026, payment terms, €40 indemnity, 2026 new mentions, reception obligation —
  economie.gouv.fr (mentions obligatoires), legalplace.fr, service-public (F31808)
- FR anti-fraud VAT / ISCA / NF525 certification (inalterability, 2026-09 certification, 7 500 € fine)
  — infocert.org/nf525, impots/economie.gouv.fr anti-fraude
- Invoicing-software feature set (dunning, proforma, deposits, credit notes, AR) — netsuite, bill.com,
  salesforce billing, paystand dunning
- Multi-entity billing, tax-inclusive vs exclusive pricing, UoM/PO references — rillion, zenskar,
  sparkreceipt
