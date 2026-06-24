# Brief for opencode — wire the real tax engine into invoices/quotes/recurring-invoices

> Context for whoever (human or opencode) picks this up: `backend/src/compliance/` is a fully built,
> fully tested, multi-country compliance engine (106 jurisdictions — see
> `documentation/compliance/COMPLIANCE_STATUS.md`). It is **not used anywhere in the live app**. The
> live invoice/quote/recurring-invoice flows still run a hardcoded, France-only VAT shortcut. This
> brief wires the *tax determination* half of the engine in — the lowest-risk, highest-value slice.
> It deliberately does **not** touch clearance/lifecycle/persistence — see "Out of scope" below.
>
> **Rewritten after `origin/dev` was merged in** (merge commit on `feat/compliance-architecture`,
> 2026-06-24): dev added a real `DRAFT`/`ARCHIVED` invoice status progression, an `archiveInvoice`
> flow, an Article catalog (picker for line items), and a Receipt→Payment rename. None of that changes
> the design below, but it does change the risk profile of Step 4 — see the new §"Cross-border
> behavior change & e2e reconciliation" before touching anything.

## The bug, concretely

Three files independently reimplement the same shortcut:

- `backend/src/modules/invoices/invoices.service.ts` (`createInvoice`, `editInvoice`)
- `backend/src/modules/quotes/quotes.service.ts` (`createQuote` and its edit equivalent)
- `backend/src/modules/recurring-invoices/recurring-invoices.service.ts` (`createRecurringInvoice`
  and its edit equivalent)

All three do, verbatim:

```ts
const isVatExemptFrance = !!(company.exemptVat && (company.country || '').toUpperCase() === 'FRANCE');
```

Two concrete bugs follow from this:

1. **Any non-French company with `exemptVat = true` is taxed at the full rate anyway** — the small
   business exemption silently only works if `Company.country` is the literal string `"FRANCE"`. A
   German, Spanish, Belgian, etc. freelancer using the same Invoicerr exemption toggle gets no
   exemption at all. The compliance engine already models this **generically** for any country
   (`backend/src/compliance/engine/tax-engine.ts:166-176`, gated on `supplier.taxScheme ===
   'FRANCHISE_BASE'`, not on a country string).
2. **No cross-border tax logic exists at all — the client's country is never read.** A French company
   invoicing a German B2B client with a valid VAT number should reverse-charge (0%, "autoliquidation"
   mention); a French company invoicing a US client should export at 0%; today both just charge
   whatever flat `vatRate` the user typed on the line, unconditionally. The engine already handles
   intra-EU/GCC reverse charge, OSS, export, and US sales-tax/nexus
   (`backend/src/compliance/engine/tax-engine.ts`) — it is just never called.

The engine is pure, framework-free, already unit-tested (`backend/src/compliance/engine/*.spec.ts`),
and respects a user-chosen reduced rate for *domestic* supplies via `DocumentLine.taxRateHint` — so
for the domestic case this is not a behavior change; the change is specifically that cross-border
invoices will, correctly, stop being taxed as if they were domestic. Read the next section before
estimating risk.

## Cross-border behavior change & e2e reconciliation (read this first)

Because today's code never reads `Client.country`, **every existing invoice/quote in the e2e suite
that pairs a French company with a foreign client and asserts a specific VAT total is currently
asserting a number that is legally wrong** (full French VAT charged on an export/reverse-charge
supply). Wiring the engine in will, correctly, change those totals — this is not a regression to
avoid, it's the bug being fixed, but it **will** make some currently-green e2e tests fail, and you
need to update their expectations rather than treat that as a blocker.

Concretely, found while auditing the e2e fixtures:

- `e2e/cypress/e2e/05-clients.cy.ts` creates clients with `country` set to `'USA'` (×3),
  `'Test Country'` (×7 — a placeholder, will correctly resolve to nothing / `FALLBACK`),
  `'Germany'` (×2, one of which is later deleted), `'United Kingdom'`, and `'France'`. Only the
  German one (`contact@german.de`) is deleted at the end of that spec — the rest **persist in the
  test DB** for every later spec.
- `e2e/cypress/e2e/07-invoices.cy.ts` and `e2e/cypress/e2e/12-discount.cy.ts` both pick the client via
  `cy.get('[data-cy="invoice-client-select-options"] button').first().click()` / the quote
  equivalent — i.e. *whichever client sorts first*, not a specific, named one.
- `12-discount.cy.ts` asserts **exact** VAT amounts (e.g. `'VAT Amount' ... '180.00EUR'` on a 900 EUR
  base at 20%, i.e. full domestic-rate VAT) for quotes/invoices created this way.
- The company onboarded in `02-company.cy.ts` has `country: 'France'` — so whether these assertions
  still hold after this change depends entirely on which client happens to be "first" at the moment
  the suite runs, which this brief cannot determine by reading the code.

**What to do, as part of this task (not optional):**

1. After wiring (Step 4 below), run the full e2e suite: `npm run e2e:run` from the repo root (check
   `package.json` at the root for whether it expects the stack already running, e.g. via
   `docker compose`, or starts it itself — follow whatever `E2E_TEST_PLAN.md` / the existing CI
   workflow does, don't invent a new way to boot the app).
2. For every newly-failing assertion around totals/VAT (`07-invoices.cy.ts`, `12-discount.cy.ts`, and
   grep the whole `e2e/` tree for `VAT Amount`/`Total (incl`/`Total (excl` to find any others), work
   out *why* it changed: identify the supplier/buyer country pair the test actually exercises (add a
   temporary `cy.log` or check the network response if the client picked by `.first()` isn't obvious
   from the spec alone), and confirm the **new** number matches what `backend/src/compliance/engine`
   would produce for that country pair (there's almost certainly already a `tax-engine.spec.ts` case
   covering the same pair you can cross-check against). Then update the assertion's expected value,
   with a one-line comment stating the legal reason (e.g. `// FR→DE B2B, both VAT-registered: reverse
   charge, 0% VAT`).
3. If a test fails for a buyer/seller pair that's both domestic (e.g. FR→FR) or both clearly use
   `'Test Country'`/unresolvable countries and the number is *not* explained by cross-border logic,
   that's a real regression — stop and fix the integration code (Step 3/4), not the test.
4. Don't blanket-change assertions to "make CI green" — each change needs the one-line legal
   justification from point 2, or it doesn't go in.

This is the single biggest source of risk in this brief. Budget time for it; it is part of "done", not
a follow-up.

## Out of scope (do not touch)

- `ComplianceDocument` creation, calling `ComplianceService`/the lifecycle runtime, clearance,
  transmission/sending via a channel provider. (All already built — see
  `documentation/compliance/COMPLIANCE_STATUS.md` — just not part of this slice.)
- Restricting `editInvoice`/the quote and recurring-invoice equivalents to `DRAFT`-only. `DRAFT` now
  exists as a real status (added by the `feat/invoice-status-progression` work already merged into
  `dev`: `createInvoice` sets it, `sendInvoiceByEmail` flips to `SENT`, there's a new
  `archiveInvoice` PAID→ARCHIVED flow) — but nothing gates *editing* on status yet, and this brief
  does not add that gate. Don't let the presence of `DRAFT` tempt you into adding it as a drive-by;
  it's a distinct, separately-tracked change.
- Migrating `totalHT`/`totalVAT`/`totalTTC`/`unitPrice` from `Float` to integer minor units in the
  Prisma schema. Conversion to/from minor units happens only **transiently in memory** at the call
  boundary described below.
- Any frontend change. `Company.country`/`Client.country` stay free-text inputs; this pass only adds
  an **optional** `countryCode` escape hatch on the backend (nobody is forced to fill it in yet). The
  new Article catalog (`backend/src/modules/articles/`) is a frontend-only convenience that
  pre-fills a line item's `description`/`unitPrice`/`vatRate`/`type` — it does not change the shape of
  `CreateInvoiceDto.items`/`InvoiceItem`, so nothing here needs to special-case it.
- Multi-tax-component lines (withholding etc.) — use only the first/primary `TaxComponent` per line,
  matching the current one-`vatRate`-per-item schema.
- Anything under `backend/src/compliance/{canonical,engine,profiles,providers,lifecycle,persistence,
  nest,operations}/**` — consume it as-is, don't modify it.

## Step 1 — additive Prisma migration

`backend/prisma/schema.prisma`: add a nullable `countryCode` next to the existing free-text `country`
on both models (do **not** remove/rename `country` — it stays the display field used by the PDF/address
block):

```prisma
model Company {
  ...
  country     String
  countryCode String?  // ISO 3166-1 alpha-2, explicit override; falls back to a best-effort guess from `country` when absent
  ...
}

model Client {
  ...
  country     String
  countryCode String?
  ...
}
```

Run `npx prisma migrate dev --name add_country_code` against a **disposable** Postgres (never the
shared dev DB — same precaution the existing `nest/apply-signal.live.spec.ts` already documents for
the compliance live-DB tests). Additive only, no backfill SQL.

## Step 2 — `backend/src/utils/country-name-to-iso.ts` (new file)

A pure, conservative normalizer:

```ts
export function guessCountryCode(freeText: string | null | undefined): string | undefined
```

- Trim + case-insensitive exact match only — **no fuzzy/Levenshtein matching**, no guessing. Return
  `undefined` when there's no confident match (the engine already degrades safely to its `FALLBACK`
  profile + a warning when given an unresolved code — see `backend/src/compliance/profiles/registry.ts:38-50`
  — so an `undefined` here is a safe, expected outcome, not an error). In particular `'Test Country'`
  (used throughout the e2e client fixtures as a deliberate placeholder) must resolve to `undefined`,
  not to a guessed code.
- If the input is already a 2-letter token, uppercase and return it as-is (covers users who already
  typed an ISO code).
- Cover English **and** French names/common abbreviations for the jurisdictions already documented
  under `documentation/compliance/*.md` (106 entries) — at minimum: FR/France, DE/Germany/Allemagne,
  US/USA/United States/États-Unis, GB/UK/United Kingdom/Royaume-Uni, ES/Spain/Espagne, IT/Italy/Italie,
  BE/Belgium/Belgique, CH/Switzerland/Suisse, CA/Canada, NL/Netherlands/Pays-Bas, LU/Luxembourg, plus
  the rest of the EU/major economies. Exhaustive coverage of all 106 is nice-to-have, not blocking —
  prioritize whichever countries are realistically used by Invoicerr's current user base (EU + US +
  CA + UK first), and make sure every country literal used in `e2e/cypress/e2e/*.cy.ts` is covered.
- Add `backend/src/utils/country-name-to-iso.spec.ts`: table-driven tests for a representative sample
  + the already-a-code passthrough + the no-match-returns-undefined case (explicitly assert
  `guessCountryCode('Test Country') === undefined`).

## Step 3 — `backend/src/compliance/integration/invoice-tax.ts` (new file)

New subdirectory `integration/` under the compliance module — pure, **zero NestJS/Prisma imports**
(same house rule as the rest of `backend/src/compliance/`). This is the only new file inside the
compliance module for this pass.

```ts
import { resolve } from '../engine/compliance-engine';
import { accumulateTotals, decimalsFor } from '../taxsystems/tax-system';
import type { PartyRole, SupplyType } from '../types';

export interface InvoiceTaxLineInput {
  quantity: number;
  unitPrice: number;          // float, PRE-discount
  vatRate?: number | null;    // user-chosen rate — used as a hint for domestic, non-exempt supplies
  supplyType?: SupplyType;    // see mapping below; default 'SERVICES'
}

export interface InvoiceTaxInput {
  supplierCountryCode?: string;  // Company.countryCode ?? guessCountryCode(Company.country)
  supplierExemptVat: boolean;    // Company.exemptVat
  buyerCountryCode?: string;     // Client.countryCode ?? guessCountryCode(Client.country)
  buyerRole?: PartyRole;         // 'B2C' when Client.type === 'INDIVIDUAL', else 'B2B'
  currency: string;
  issueDate: Date;
  discountRate: number;          // 0-100, already clamped by the caller (clampDiscountRate)
  items: InvoiceTaxLineInput[];
}

export interface InvoiceTaxResult {
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  itemVatRates: number[];   // same length/order as input.items
  warnings: string[];
}

export function resolveInvoiceTax(input: InvoiceTaxInput): InvoiceTaxResult {
  // ...
}
```

Implementation notes:

- `decimals = decimalsFor(input.currency)`; `discountFactor = 1 - input.discountRate / 100`.
- Build `ctx.lines[i].unitNetMinor = Math.round(item.unitPrice * discountFactor * 10 ** decimals)` —
  applying the discount to the *net* before tax exactly mirrors today's
  `calculateDiscountedTotals`/manual-loop behavior (tax computed on the discounted base). Expect
  sub-cent rounding differences vs the old float math — that's acceptable (integer math is strictly
  more correct), but call it out in the PR description.
- `ctx.lines[i].taxRateHint = item.vatRate ?? undefined`, `taxCategoryHint` left unset.
- `supplyType` mapping from `ItemType` (callers pass this through, this function only forwards it):
  `PRODUCT → 'GOODS'`, everything else (`HOUR`/`DAY`/`DEPOSIT`/`SERVICE`) `→ 'SERVICES'`. Default to
  `'SERVICES'` if the caller omits it.
- `ctx.supplier = { legalName: '-', countryCode: input.supplierCountryCode ?? '', role: 'B2B', identifiers: [], taxScheme: input.supplierExemptVat ? 'FRANCHISE_BASE' : undefined }`.
- `ctx.buyer = { legalName: '-', countryCode: input.buyerCountryCode ?? '', role: input.buyerRole ?? 'B2B', identifiers: [] }`.
- `const plan = resolve(ctx)` — never throws (confirmed: `ProfileRegistry.resolve` treats an empty/
  unresolved code as `FALLBACK`, not an error).
- `const totals = accumulateTotals(ctx, plan.tax)` — gives `{ net, tax, gross }` each as
  `{ minor, currency, decimals }`.
- `plan.tax.lines` is produced via `ctx.lines.map(...)` inside `determineTax`, so **it already
  preserves input order** — zip `plan.tax.lines[i].treatment.components[0]?.rate ?? 0` directly by
  index against `input.items`, no id-based lookup needed.
- Convert back: `totalHT = totals.net.minor / 10 ** decimals` (same for VAT/TTC).
- `warnings: plan.warnings`.

Add `backend/src/compliance/integration/invoice-tax.spec.ts` covering at least:

1. FR company, not exempt, FR client, flat 20% → same totals as today's `calculateDiscountedTotals`
   (sanity/no-regression check on the common, domestic case).
2. FR company, `exemptVat: true` → 0% VAT, `totalVAT === 0` (today's behavior, must not regress).
3. **DE company, `exemptVat: true`** → 0% VAT. This is the bug fix — today's code would charge full
   VAT here because of the `=== 'FRANCE'` gate; this test must fail against the old logic and pass
   against the new one.
4. FR company → DE B2B client, both with a VAT identifier → reverse charge: rate `0`, a
   reverse-charge mention present.
5. A domestic, non-exempt invoice with an explicit reduced line rate (e.g. `vatRate: 5.5`) keeps that
   exact rate — proves the hint is respected, not overridden.
6. FR company → US client (export case) and FR company → unresolvable/`undefined` buyer country
   (mirrors `'Test Country'`) → both resolve without throwing, `totalVAT` is a defined number (not
   `NaN`), and for the unresolved case `warnings` is non-empty. Don't assert a specific rate for the
   unresolved case beyond "it's a number" — that's intentionally `FALLBACK`-quality, not a precise
   legal answer.
7. Discount: a `discountRate: 10` case matches the discounted-base VAT math of the current
   `calculateDiscountedTotals` within 1 minor unit.

## Step 4 — wire the three call sites

In each of `invoices.service.ts` (`createInvoice`, `editInvoice`), `quotes.service.ts` (both
equivalent methods), `recurring-invoices.service.ts` (both equivalent methods):

- Delete the local `isVatExemptFrance` line and whatever totals computation currently follows it
  (`calculateDiscountedTotals(...)` call in invoices/quotes, the manual loop in
  recurring-invoices).
- Call `resolveInvoiceTax({ ... })` instead, passing:
  - `supplierCountryCode: company.countryCode ?? guessCountryCode(company.country)`
  - `supplierExemptVat: !!company.exemptVat`
  - `buyerCountryCode: client.countryCode ?? guessCountryCode(client.country)`
  - `buyerRole: client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B'`
  - `currency`, `issueDate: new Date()` (these flows don't track a separate issue date today —
    `new Date()` at creation time is fine), `discountRate: clampDiscountRate(...)` (keep using the
    existing `clampDiscountRate` from `@/utils/financial` — don't duplicate that logic).
  - `items` mapped from the DTO's items (`quantity`, `unitPrice`, `vatRate`, `supplyType` derived
    from each item's `type` per the mapping in Step 3).
- Write `totalHT`/`totalVAT`/`totalTTC` and each item's `vatRate` from the result into the exact same
  Prisma fields that are written today — no Prisma payload shape changes beyond the values' source.
  `createInvoice` keeps its existing explicit `status: 'DRAFT'` — unrelated to this change, leave it.
- `recurring-invoices.service.ts` currently does **not** fetch the `Client` row in
  `createRecurringInvoice`/its edit counterpart (it only has `data.clientId`) — add a
  `prisma.client.findUnique({ where: { id: data.clientId } })` call, mirroring the existing pattern in
  `invoices.service.ts`, and throw the same `BadRequestException('Client not found')` if missing.
- Log `result.warnings` (if non-empty) via each file's existing `logger.warn(...)`
  pattern with that file's existing `category` (`'invoice'` / `'quote'` / `'recurring-invoice'`) —
  non-blocking, never throw on a warning.

## Step 5 — optional explicit `countryCode` on Company/Client (escape hatch)

- `backend/src/modules/company/dto/company.dto.ts` and
  `backend/src/modules/clients/dto/clients.dto.ts`: add `countryCode?: string` next to the existing
  `country: string` field on both the create and update DTOs.
- `company.controller.ts`/`company.service.ts` and `clients.controller.ts`/`clients.service.ts`: pass
  `countryCode` through to the corresponding `prisma.company.create/update` /
  `prisma.client.create/update` calls when provided.
- Validate with `class-validator`: `@IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be a 2-letter ISO 3166-1 alpha-2 code' })`. Reject (400) on a non-conforming value; don't silently
  normalize/uppercase user input here — that's the normalizer's job, this field is the explicit
  override path.

## Verification

- `cd backend && npx jest src/compliance/integration src/utils/country-name-to-iso.spec.ts` — all
  green. (There are currently **no** existing jest unit tests for the invoices/quotes/
  recurring-invoices services themselves — this codebase relies on the Cypress e2e suite for that
  layer, so don't expect/add a `src/modules/invoices/*.spec.ts`; the new pure compliance/utils specs
  above are the unit-level safety net.)
- `npx tsc --noEmit` clean, `npx nest build` succeeds.
- `npx prisma validate`, then `npx prisma migrate dev` against a disposable Postgres applies cleanly
  (do not run against the shared dev database).
- Run the **full e2e suite** and reconcile per the dedicated section above — this is mandatory, not
  optional verification.

## Acceptance criteria

- The three duplicated `isVatExemptFrance` blocks are gone; there is exactly one shared
  `resolveInvoiceTax` consumed by all three services.
- No behavior change for the FR-domestic / non-exempt / user-picked-rate common case beyond
  integer-rounding noise (≤ 1 minor unit per line).
- Non-French small-business exemption schemes now work (the bug above is fixed).
- Cross-border EU/GCC reverse charge, OSS, export, and US sales-tax/nexus determination apply
  automatically instead of always charging the flat line rate the user typed.
- Every e2e assertion that changed as a result has a one-line legal justification in the test diff;
  no assertion was changed without one.
- The diff touches only: `backend/prisma/schema.prisma` (additive), the new
  `backend/src/utils/country-name-to-iso.ts(+.spec.ts)`, the new
  `backend/src/compliance/integration/invoice-tax.ts(+.spec.ts)`, the three services
  (`invoices`/`quotes`/`recurring-invoices`), their DTOs, the company/client DTOs+services+
  controllers for the optional `countryCode` field, and whichever `e2e/cypress/e2e/*.cy.ts`
  assertions needed updating per the reconciliation step. Nothing else under
  `backend/src/compliance/**` changes.

Once this lands and is reviewed, `documentation/compliance/COMPLIANCE_STATUS.md` §"Suggested order"
item 1 gets checked off — leave that doc edit for the review pass, not part of this brief.
