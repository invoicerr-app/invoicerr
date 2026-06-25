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
   passed.
7. **On completion of a section**: tick its boxes here **and** add one line to
   `documentation/compliance/COMPLIANCE_STATUS.md`.
8. **When a legal specific is ambiguous**, flag it / leave the item `[~]` with a note — do **not**
   guess at a legal rule.

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

## II.3 Numbering overhaul ⚖️🔒🧨
Today `prisma.service.ts` (`$extends`) numbers **every** Quote/Invoice/Payment on create, update, **and
on every `findMany`** — so drafts get legal numbers merely by being listed; `number` is
`autoincrement()` consumed at creation with gaps on draft deletion; `formatPattern` uses `createdAt`.
- [ ] ⚖️ Remove the auto-numbering `$extends` entirely.
- [ ] ⚖️ Make `number` nullable (drop `autoincrement()`), add `issuedAt DateTime?`. Draft = all null.
  Backfill existing issued rows (`issuedAt = createdAt`, keep numbers).
- [ ] ⚖️ Gapless per-series counter assigned transactionally at issue (a `NumberSeries` table keyed by
  `(companyId, docType, scopeKey)` bumped in the issue transaction, or advisory-lock + max+1).
  Race-safe. Year token from `issuedAt`.
- [ ] ⚖️ Issued documents never hard-deleted (`deleteInvoice`/`deleteQuote` → DRAFT only).
- [ ] Drive off `plan.numbering`: `GAPLESS_SELF` → local counter; `AUTHORITY_RANGE` → provisional
  number flagged non-authoritative, real one set at clearance (PART X).
- [ ] Tests: issue assigns next gapless number; deleting a draft leaves no gap; concurrent issues
  don't collide; listing drafts assigns nothing.

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
- [ ] `kind` (INVOICE/CREDIT_NOTE/DEBIT_NOTE/CORRECTIVE_INVOICE/PROFORMA/DEPOSIT/FINAL) + `issuedAt`
  + `correctsInvoiceId` (self-relation) + `depositInvoiceIds` link (III.4).
- [ ] **Buyer reference / PO / contract ref** (EN 16931 BT-13; mandatory for B2G Chorus Pro: service
  code / engagement number). Free-text + optional structured.
- [ ] **Delivery info**: delivery date + delivery address (EN 16931 BG-13; FR 2026 new mandatory
  "adresse de livraison" when ≠ billing).
- [ ] **Payment terms**: explicit due-date rule, payment means code (EN 16931 BG-16), and the
  country-mandated penalty/indemnity mentions (PART V.1).
- [ ] **FX**: when invoice currency ≠ company base/tax currency, capture the exchange rate + tax
  amount in the tax currency at issue (engine `requiresTaxCurrency`). 🏛️ — retrofitting FX later is
  painful.
- [ ] **Tax-inclusive (TTC) pricing flag** 🏛️: B2C/retail enters prices VAT-inclusive. Store whether a
  line/document is entered inclusive or exclusive and round per the country's rule. Affects the money
  model — decide now (the minor-units work is the right time).
- [ ] **Line model**: line-level discounts/allowances + charges (shipping/handling) and a real
  **unit of measure** code (EN 16931) beyond the current `ItemType`. (Couples with multi-tax, PART X.)

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
- [ ] **Proforma**: a non-legal pre-invoice (no number, not in the gapless series); convertible to a
  real invoice. New `kind = PROFORMA`.
- [ ] **Deposit/advance invoice (facture d'acompte)** ⚖️: in FR a deposit payment **requires** a
  deposit invoice; the **final invoice deducts** the deposited amount and references the deposit
  invoice(s). Model the deposit→final link and the deduction line; both are numbered legal documents.
- [ ] Frontend: "Request deposit" / "Issue deposit invoice", and final-invoice UI that shows/deducts
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
  (calls `POST /invoices/:id/issue`), with a confirm dialog. A DRAFT shows a **"no number yet"** state
  (the draft watermark exists); the legal number appears only after issue.
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
- [ ] "Request deposit / Issue deposit invoice (acompte)" action; **proforma** create + "Convert to
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
- [ ] Decide + document the scope: minimal legal-reception capability (accept, store, acknowledge an
  inbound e-invoice via PDP/Peppol/SdI) vs a full AP module. At minimum the legal-reception path.
- [ ] Wire the inbound router/reception facade to a stored `ReceivedDocument`, with buyer-status
  emission where mandated (FR statuses), and a UI to view/acknowledge received invoices.
- [ ] This is a whole new document direction — anticipate the data model now (II.5 `direction`
  already exists on `ComplianceDocument`).

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
- [ ] Drive the lifecycle end-to-end for one clearance country (FR PDP **or** MX PAC) — real
  transmission; unblocks real `AUTHORITY_RANGE` numbering (II.3) + payment clearance (III.5).
- [ ] Multi-tax / withholding line items (engine models `TaxComponent[]`/`Withholding`; live line +
  column don't) — couples with the line model (II.5).
- [ ] QR & signing on the PDF (after signing providers are real).
- [ ] Document taxonomy / B2G specifics (Chorus Pro service code ↔ buyer reference V/II.5;
  boleta/guía/complemento).
- [ ] Invoice rendered in the buyer's mandated language.
- [ ] Graduate archetype profiles to verified `OFFICIAL`; fill the ~62 `.todo()` execution stubs.
- [ ] Online payment collection (pay-by-link) — optional product feature, not legal.

---

# Suggested execution order (dependency-first)
1. **PART II** foundations: II.1 (done) → **II.3 numbering** + **II.4 inalterability** (the two legal
   keystones) → II.5 fields → II.2 money cutover (independent).
2. **III.1 invoices** (issue step, edit-only-draft) → **PART IV** corrections/cancel.
3. **III.2 quotes**, **III.4 deposit/proforma** (parallelisable).
4. **III.3 recurring** (needs III.1 + benefits from PART IX).
5. **III.5 payments** legal numbering/refund.
6. **PART V** mentions/dunning/FX (V.1 mentions can start early — engine already computes tax
   mentions); **PART VI** frontend (VI.1 infra first).
7. **PART IX** outbox/BullMQ; then **PART VII** reception (legal deadline 2026-09), **PART VIII**
   multi-entity (anticipate schema early even if shipped late), **PART X** breadth.

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
