# Brief for opencode — make the entire frontend country-aware

> This is the single source of truth for the **frontend** transformation to be per-country dynamic.
> It builds on the analysis in `TODO_FRONTEND_PER_COUNTRY_ANALYSIS.md` (read that first for the *why*
> and the full inventory) and turns it into executable work.
>
> **Hard dependencies — do not start before these have landed** (they're separate briefs, some
> in-flight):
> 1. `TODO_COUNTRY_AND_MONEY_MIGRATION.md` **Part A** — `Company.countryCode`/`Client.countryCode`
>    reliably populated from the picker (everything below keys off a trustworthy ISO code).
> 2. `TODO_PER_COUNTRY_REQUIRED_FIELDS.md` — the per-country **identifiers** axis on the compliance
>    profile, the generic `PartyIdentifier` table, and the first `GET /api/compliance/required-fields`
>    endpoint. This brief **generalizes** that endpoint and **refactors** its one-off dynamic form
>    into the shared component built in Phase 1. If the identifiers brief hasn't landed yet, do it
>    first or fold it into Phase 1/2 here — don't build a parallel second mechanism.
>
> Money migration (`TODO_COUNTRY_AND_MONEY_MIGRATION.md` Part B) is **independent** of this brief and
> requires no frontend change by design — ignore it here.

## Principle (don't violate it)

Static fields that exist for every country stay hardcoded in JSX (company name, contact email, line
items…). Only **country-varying** inputs are rendered from a server-provided descriptor. There is
**one** descriptor endpoint and **one** dynamic-field renderer component — never a second of either,
never a per-country `if` in a React component. The compliance engine (`backend/src/compliance/`)
remains the only place country knowledge lives; the frontend just renders what it's told.

Keep the established house rules: additive Prisma migrations only; any migrate/reset against a
**disposable** Postgres, never the shared dev DB; `backend/src/compliance/**` stays pure (consume it,
or add a declarative axis to the profile schema — never put I/O in it); reuse `decimalsFor`/`money`,
`toMinor`/`fromMinor`, the `PartyIdentifier`-style table, the single descriptor endpoint.

---

## Phase 1 — shared frontend infrastructure (build once)

### 1a. `useFormSchema` hook
`frontend/src/hooks/use-form-schema.ts` (new): a react-query hook keyed on `(countryCode, partyType)`
that fetches the descriptor (Phase 2 endpoint) and returns `{ schema, isLoading }`. Mirror the
existing data-fetching conventions (`@/hooks/use-fetch` `useGet`, `queryKeys` in
`@/lib/query-keys`). Refetch when `countryCode`/`partyType` changes; cache so re-opening a form is
instant.

### 1b. `<DynamicFields>` renderer component
`frontend/src/components/dynamic-fields.tsx` (new): given a descriptor section + a react-hook-form
`control`, renders the country-varying fields. It must handle the field kinds the descriptor can
contain (see Phase 2 shape): plain text input, text input with a `pattern` hint + `helpText`,
required/optional state, and the "reserved field" case where a descriptor entry maps onto an
**existing** hardcoded input (e.g. `LEGAL_ID`→the `legalId` field) by overriding that field's
label/required/help rather than rendering a new one.

- For the array-typed sections (identifiers, bank details), use the **same field-array pattern the
  codebase already uses for invoice/quote line items** — read
  `frontend/src/pages/(app)/invoices/_components/invoice-line-items-editor.tsx` and mirror its
  `useFieldArray` usage; do not invent a new dynamic-array pattern.
- This component is what the identifiers brief's inline form becomes — **refactor that brief's one-off
  into this component as the first step of Phase 1**, then reuse it for everything below.

### 1c. Acceptance for Phase 1
A unit/component test that, given a mock descriptor, renders the right inputs, applies required/pattern
validation, and round-trips values through react-hook-form. No form wired yet — just the primitives.

---

## Phase 2 — widen the descriptor endpoint (backend, in service of the frontend)

Generalize `GET /api/compliance/required-fields` (from the identifiers brief) into
`GET /api/compliance/form-schema?countryCode=FR&partyType=COMPANY` returning **all** country-varying
sections, not just identifiers:

```ts
interface CountryFormSchema {
  identifiers: IdentifierRequirement[];   // already specced in the identifiers brief
  address: AddressDescriptor;             // Phase 3
  bankDetails: BankDetailRequirement[];   // Phase 4
  defaults: { dateFormat?: string; currency?: string; taxCurrency?: string }; // Phase 6
}
```

Each section is read straight off `defaultRegistry.resolve(countryCode).profile` (new declarative
axes added per phase below — all additive to `CountryComplianceProfile` in
`backend/src/compliance/profiles/schema.ts`, all populated for the 5 bespoke profiles + a conservative
generic default in `archetypes.ts`, exactly the pattern the identifiers brief established). Keep the
old `required-fields` route as a thin alias returning `schema.identifiers` if anything already calls
it, or migrate its caller — your choice, but don't leave two divergent endpoints.

Filter by `partyType` server-side (an `appliesTo: 'INDIVIDUAL'` entry must not appear for
`partyType=COMPANY`). Unknown country → all sections empty/default (FALLBACK), never an error.

---

## Phase 3 — address: descriptor-driven subfields + country-correct PDF

### Engine axis
Add `AddressDescriptor` to the profile schema:
```ts
interface AddressDescriptor {
  regionField: { shown: boolean; required: boolean; label: string } | null; // "State"/"Province"/"Prefecture"/"Region"; null = no region concept (most of EU)
  postalCode: { shown: boolean; required: boolean; pattern?: string; label: string };
  renderOrder: 'WESTERN' | 'EAST_ASIAN';  // WESTERN: street → city, region postal → country; EAST_ASIAN: postal → region → city → street (JP/CN/KR)
}
```
Populate for the bespoke 5 (FR: no region, postalCode required 5-digit; US: region required "State",
ZIP required; etc.) and a `WESTERN`, region-optional, lax-postal generic default in `archetypes.ts`.

### Frontend
In `company.settings.tsx` (`:385-457`), `client-upsert.tsx`, `onboarding.tsx` address blocks: drive
the **state/region** field's visibility/required/label and the **postal code**'s required/pattern from
`schema.address` via `<DynamicFields>`. Today `state` is hardcoded optional
(`company.settings.tsx:444`) and postal code uses one global regex (`company.settings.tsx:86`) — both
become descriptor-driven. Keep `address`/`addressLine2`/`city` as static fields (universal).

### PDF / e-invoice render (backend)
`backend/src/modules/invoices/templates/base.template.ts:46-49, 65-68` prints a fixed
`{city}, {state} {postalCode}` / `{country}` order. Make the rendered address block respect
`renderOrder` (East-Asian = postal-first, largest-to-smallest, no "city, state" comma form). Pass the
resolved `renderOrder` into the PDF context in `invoices.service.ts getInvoicePdf`. Also audit
`backend/src/utils/adress.ts` `parseAddress()` — it **throws** on unrecognized formats; make it
degrade to `{ streetName: <raw>, houseNumber: '' }` instead of throwing (a malformed address must
never block invoice generation).

---

## Phase 4 — bank / payment details: structured, per-country

This is the biggest unstructured surface. Today `PaymentMethod.details` is one free-text string
(`payment-method-upsert.tsx:116-128`; `PaymentMethod` model).

### Storage (additive)
New generic table mirroring `PartyIdentifier`:
```prisma
model PaymentMethodField {
  id              String        @id @default(cuid())
  scheme          String        // 'IBAN' | 'BIC' | 'US_ROUTING' | 'US_ACCOUNT' | 'UK_SORT_CODE' | 'CLABE' | 'BSB' | 'IFSC' | ...
  value           String
  paymentMethodId String
  paymentMethod   PaymentMethod @relation(fields: [paymentMethodId], references: [id], onDelete: Cascade)
  @@unique([paymentMethodId, scheme])
}
```
**Keep** the existing free-text `details` column (back-compat + the `OTHER`/`CASH`/`PAYPAL` types that
don't have structured schemes). Structured schemes are additive on top, only for `BANK_TRANSFER`.

### Engine axis
`BankDetailRequirement[]` on the profile (`{ scheme, label, required, pattern?, helpText? }`),
populated per country (FR/EU SEPA: IBAN required + BIC optional; US: routing+account; UK: sort code +
account; MX: CLABE; …) + a generic "IBAN or free-text" default. Same data-only pattern as identifiers.

### Frontend
`payment-method-upsert.tsx`: when `type === 'BANK_TRANSFER'`, render the structured fields from
`schema.bankDetails` via `<DynamicFields>` (the payment-method form isn't country-scoped today —
resolve the descriptor from the **company's** `countryCode`, since these are the issuer's bank
details). Keep the free-text `details` for non-bank types.

### PDF
Render the structured bank details in the payment block of the invoice PDF
(`base.template.ts`) when present, falling back to `details` otherwise.

---

## Phase 5 — legal mentions on the invoice (engine already computes them)

Today the PDF shows exactly one hardcoded France-293B line, gated on `country === 'FRANCE'`
(`invoices.service.ts getInvoicePdf` ~`:449`; `base.template.ts:115-118`). The tax engine **already**
produces the correct mentions per transaction as `plan.tax.mentions` (reverse charge, export,
intra-community, out-of-scope, 293B — `backend/src/compliance/engine/tax-engine.ts` `MENTION.*`,
machine-tag + text). Since cross-border 0%-rating is now live, an export/reverse-charge invoice
currently has correct numbers but **no legal sentence** — a real legal defect.

- Backend: in `invoices.service.ts getInvoicePdf` (and the quote equivalent in `quotes.service.ts`),
  call the engine (or reuse the `resolveInvoiceTax` path — extend `InvoiceTaxResult` with
  `mentions: { code: string; text: string }[]` from `plan.tax.mentions`, additive) and pass the array
  into the PDF context. Replace the single `vatExemptText` string with a rendered list of all
  mentions in `base.template.ts`.
- Frontend: surface the same mentions in the invoice **view** (`invoice-view.tsx`) so the user sees
  why a line is 0%-rated before they even render the PDF — read the mentions from the invoice GET
  response (add them to it).

This is the highest-value smallest phase and has no dependency on Phases 3/4 — **it can be done first
if you want an early win** (only depends on the tax-engine wiring already merged).

---

## Phase 6 — date format & currency defaults from country

- `company.settings.tsx` date format is a manual dropdown (`:27, :657-681`); default it from
  `schema.defaults.dateFormat` when the country is chosen (user can still override).
- Currency already auto-defaults via the `useCountryToCurrency` hook (dev) — leave it, but when the
  engine reports `schema.defaults.taxCurrency` (e.g. MX must invoice in MXN —
  `requiresTaxCurrency` in `backend/src/compliance/profiles/schema.ts`), show a non-blocking warning
  on the invoice form if the chosen invoice currency differs.
- Small; bundle with Phase 3 if touching the same company form.

---

## Phase 7 — show the new fields in the read-only views

`client-view.tsx`, `invoice-view.tsx`, quote/payment views, and the PDF: display the per-country
identifiers, structured bank details, and legal mentions that now exist. Pre-fill them when editing
(the GET responses must include the new relations — `partyIdentifiers`, `paymentMethodFields` — add
them in the respective services and to the frontend `types/*.ts`).

---

## Explicitly deferred (frontend items NOT in this brief, with their blockers)

State these in the PR description so it's clear they're knowingly excluded, not missed:

- **Multi-tax / withholding line items** (line editor shows one `vatRate`) — needs the engine's
  multi-`TaxComponent` output wired through the canonical→storage path first; not just a UI change.
- **QR code on the PDF** — needs the real signing providers (currently stubs); comes with that work.
- **Document taxonomy / B2G path** (Chorus Pro service code, boleta/guía/complemento) — needs the
  lifecycle to be driven in the live create path (COMPLIANCE_STATUS "Suggested order" item 2).
- **Invoice rendered in the buyer's mandated language** — lower priority; after the above.
- **Numbering for `AUTHORITY_RANGE` countries** — structurally needs clearance to exist; backend, not
  frontend.

## Global acceptance

- `npx tsc --noEmit` (frontend + backend), `npx jest` (backend), frontend build all clean.
- Additive migrations apply on a disposable Postgres; new tables empty (genuinely new data).
- One reusable `<DynamicFields>` + one `useFormSchema` + one `form-schema` endpoint — grep to confirm
  no second mechanism crept in.
- e2e: extend `02-company.cy.ts` and `05-clients.cy.ts` — pick France and a non-EU country (US or MX),
  confirm the dynamic identifier/address/bank fields change accordingly, fill them, submit, reopen the
  edit form, confirm round-trip. Extend `07-invoices.cy.ts` to assert a reverse-charge/export invoice
  shows its legal mention in the view and the rendered PDF total stays 0%-VAT.
- Each phase updates `documentation/compliance/COMPLIANCE_STATUS.md` to move its item off the gap list
  — in the review pass, not inside the brief.

## Suggested execution order

Phase 1 (infra) → Phase 5 (legal mentions — early win, independent) → Phase 2 (widen endpoint) →
Phase 3 (address) → Phase 4 (bank details) → Phase 6 (defaults) → Phase 7 (views). Each phase is a
separate commit; the brief is large on purpose — do not bundle phases.
