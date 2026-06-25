# Brief for opencode — two structural debt items: country signal reliability, money storage

> Context: this branch (`feat/compliance-architecture`) wired a real multi-country tax engine into
> invoices/quotes/recurring-invoices (see `documentation/compliance/COMPLIANCE_STATUS.md`). Two
> pieces of debt from that work are tracked here, unrelated to each other — do them as two separate
> PRs/commits, in the order they appear below (Part A is small and safe, Part B is large — don't
> start Part B until Part A is merged and soaked).

---

# Part A — Make `Company.countryCode`/`Client.countryCode` the reliable signal

## Why

`Company.countryCode`/`Client.countryCode` (additive, nullable, added in a previous pass) is what the
compliance tax engine uses to determine jurisdiction. Today it's populated two ways:

1. An explicit override — not exposed in any form yet, only reachable by calling the API directly.
2. A best-effort guess (`backend/src/utils/country-name-to-iso.ts`'s `guessCountryCode()`) computed
   *every time* from the free-text `country` field, covering English + French country names only.

Separately, `dev` recently added a real country picker (`frontend/src/components/country-select.tsx`)
used in `client-upsert.tsx`, `company.settings.tsx`, and `onboarding.tsx`. It resolves a label via
`Intl.DisplayNames` **from an ISO code it already has** (`countryCodes` in
`frontend/src/lib/constants/countries.ts`), then throws the code away and stores only the localized
label as `country`. So:

- For a user on the `de`/`es`/`nl` locale (all supported — see `frontend/src/locales/`), the picker
  produces "Deutschland"/"Alemania"/"Duitsland" for Germany — none of which `guessCountryCode` knows
  about (EN/FR only) — so `countryCode` stays unresolved and the engine falls back to `FALLBACK`
  confidence for these users, silently, even though the exact ISO code was known at the moment of
  selection and simply never captured.
- Pre-existing `Company`/`Client` rows have no `countryCode` at all and rely on the live guess.

## Goal

Capture the ISO code at the moment of selection — it's already known client-side — instead of
reverse-guessing it later from a display string. Don't touch the `country` field's role (it stays the
free-text display name used on the PDF/address block); `countryCode` becomes the thing the engine
actually trusts, populated reliably going forward, with the guess staying only as a safety net for
old data and direct-API writes.

## Steps

### A1 — `CountrySelect` also exposes the ISO code

`frontend/src/components/country-select.tsx`: the `options` array is built as
`countryCodes.map((code) => ({ label, value: label }))` — value is the *label*, not the code. Add the
code alongside it (`{ label, value: label, code }`) and add a new optional prop:

```ts
interface CountrySelectProps {
  value: string | null | undefined
  onChange: (value: string | string[]) => void
  onCountryCodeChange?: (code: string) => void   // NEW — fired with the ISO code on selection
  'data-cy'?: string
}
```

Call `onCountryCodeChange?.(option.code)` wherever `onChange` is currently called with the matching
option (the component already does a lookup to resolve `value` → option for the preserved-legacy-value
case; reuse that).

### A2 — wire it through the three forms

In `client-upsert.tsx`, `company.settings.tsx`, `onboarding.tsx`: wherever `<CountrySelect value=...
onChange=... />` is rendered, add `onCountryCodeChange={(code) => field2.onChange(code)}` (or the
equivalent `form.setValue('countryCode', code)` for whichever form pattern that file already uses for
sibling fields). `countryCode` does **not** need to be a visible form field — no label, no input, just
a value carried alongside `country` in the same submit payload.

- Add `countryCode?: string` to the Zod schemas in those three files (optional, no validation beyond
  what the picker already guarantees — it only ever emits a real code from `countryCodes`).
- Add `countryCode?: string | null` to `frontend/src/types/company.ts` and
  `frontend/src/types/client.ts` (both currently have `country: string` with no `countryCode` sibling
  — confirmed by reading both files; add it next to `country` in each).
- The backend DTOs/services already accept and persist `countryCode` (done in a previous pass) — no
  backend change needed for this part beyond what's already there.

### A3 — backfill existing rows (one-off script, not a migration)

Add `backend/scripts/backfill-country-codes.ts` (or wherever this repo's existing one-off scripts
live — check for a `scripts/` convention first, otherwise put it next to
`backend/prisma/seed.ts`-equivalent if one exists, otherwise top-level `backend/scripts/`):

- Iterate every `Company`/`Client` row where `countryCode IS NULL`.
- Call the existing `guessCountryCode(row.country)`.
- If it resolves, `update` that row's `countryCode`. If not, leave it `null` (don't guess harder —
  same conservative rule as the runtime fallback).
- Log a summary: total rows scanned, resolved, left unresolved (so whoever runs this can see how many
  records still need a manual fix via Settings).
- This is a **script you run once**, not a Prisma migration — it doesn't change schema, just backfills
  data. Document the run command in the script's header comment (e.g.
  `npx ts-node backend/scripts/backfill-country-codes.ts`, gated by the same "never point this at
  production without checking" discipline as everything else in this codebase touching real data —
  ask before running it against anything but a disposable/dev database).

## Out of scope for Part A

- Removing or deprecating the free-text `country` field.
- Any change to `guessCountryCode` itself.
- Validating that a manually-typed `countryCode` (via direct API call, bypassing the picker) is a real
  ISO code — already out of scope per the original brief, still true.

## Tests / acceptance

- `frontend`: a picker selection sets both `country` (label) and `countryCode` (ISO) in the submitted
  payload — verify via an e2e assertion or a component test, whichever this repo's existing
  `CountrySelect`-adjacent tests use as precedent.
- Backfill script has a dry-run mode or at minimum is idempotent (running it twice does nothing on
  the second run) — add a small test or at least manual verification of idempotency.
- No backend test changes needed (nothing in `backend/src/compliance/**` or
  `backend/src/utils/country-name-to-iso.ts` changes).

---

# Part B — Money: `Float` → integer minor units (large, staged, backend-only)

## Why

Every money column in this schema is `Float`. The compliance tax engine
(`backend/src/compliance/integration/invoice-tax.ts`) already has to convert these to integer minor
units at its boundary specifically *because* float arithmetic on money accumulates rounding error —
the engine's own canonical `Money` type (`backend/src/compliance/canonical/canonical-document.ts`)
is integer-minor-units-only by design, for exactly this reason. The rest of the app still stores and
computes money as `Float`, which is the thing the engine had to work around.

## Design principle — read this before writing any code

**The API request/response contract for money fields does not change.** Create/edit endpoints still
accept and return plain decimal numbers (e.g. `unitPrice: 49.99`). Only the **Prisma column type and
the arithmetic between the DB and the API boundary** changes, from `Float` to integer minor units
(cents, or the currency-appropriate unit via `decimalsFor()`). This means:

- **Zero frontend changes are required.** Every form, every display, every client-side total preview
  keeps working exactly as today, because what crosses the HTTP boundary doesn't change shape.
- The conversion happens in exactly two places per field: right before a Prisma `create`/`update`
  (float in → minor int), and right after a Prisma `find*` (minor int → float out), in each backend
  service.
- Reuse `decimalsFor(currency)` and `money(minor, currency)` from
  `backend/src/compliance/taxsystems/tax-system.ts` everywhere a decimals-per-currency lookup is
  needed — **do not** write a second currency-decimals table. Add two small, currency-agnostic
  converters next to them or in `backend/src/utils/financial.ts` (whichever fits the existing import
  graph better, your call): `toMinor(amount: number, currency: string): number` (
  `Math.round(amount * 10 ** decimalsFor(currency))`) and `fromMinor(minor: number, currency: string):
  number` (`minor / 10 ** decimalsFor(currency)`).

## Fields in scope (money only — not quantities, not percentages)

`quantity` (fractional hours/days are real, explicitly supported since migration
`20260203050340_support_fractional_quantities` — never touch) and `vatRate` (a percentage, e.g. `5.5`
for 5.5% — not a money amount) **stay `Float`**. Only these convert:

| Model | Fields |
| --- | --- |
| `Invoice` | `totalHT`, `totalVAT`, `totalTTC` |
| `InvoiceItem` | `unitPrice` |
| `Quote` | `totalHT`, `totalVAT`, `totalTTC` |
| `QuoteItem` | `unitPrice` |
| `RecurringInvoice` | `totalHT`, `totalVAT`, `totalTTC` |
| `RecurringInvoiceItem` | `unitPrice` |
| `Payment` | `totalPaid` |
| `PaymentItem` | `amountPaid` |
| `Article` | `unitPrice` |

`discountRate` (on `Invoice`/`Quote`) is a percentage, not money — stays `Float`.

## Staging — four phases, each a separate commit, do not skip ahead

### Phase 1 — additive minor-unit columns

For every field above, add a sibling `Int?` column named `<field>Minor` (e.g. `totalHTMinor`,
`unitPriceMinor`, `amountPaidMinor`). Nullable, additive, no default — a single Prisma migration.
Don't touch the existing `Float` columns yet.

### Phase 2 — backfill script

One script (mirrors Part A's backfill in spirit): for every row in every table above, compute
`<field>Minor = toMinor(<field>, currency)` using that row's own `currency` (join to the parent
`Invoice`/`Quote`/etc. where the money field lives on a child table, e.g. `InvoiceItem` doesn't have
its own `currency` — use its parent `Invoice.currency`). Make it idempotent and re-runnable (recompute
every time, cheap enough at this scale; don't skip already-populated rows — that would let drift
between the two columns go unnoticed if Phase 1's column was populated by a partially-broken earlier
run).

### Phase 3 — switch every read/write call site to the Minor columns, service by service

For each service below: stop writing the `Float` field, write the `Minor` field instead (convert at
the point you currently call `prisma.<model>.create/update`); stop reading the `Float` field for any
computation or output, read `Minor` and convert with `fromMinor()` right where you currently read it.
**Keep writing the old `Float` columns too, for now** (cheap insurance — drop them in Phase 4 once
everything downstream has been verified against the new columns for a while):

- `backend/src/modules/invoices/invoices.service.ts` — `createInvoice`, `editInvoice` (writes),
  `getInvoicePdf`, `getInvoiceXMLFormat`, `getInvoicePDFFormat` (reads/formatting). Note: this file's
  `resolveInvoiceTax()` call already computes everything in minor units internally
  (`accumulateTotals()`) before converting back to float for the `InvoiceTaxResult` — once this phase
  lands, add `totalsMinor: { netMinor, taxMinor, grossMinor }` to `InvoiceTaxResult` (additive, keep
  the existing float fields too) in `backend/src/compliance/integration/invoice-tax.ts`, so this
  call site can write the Minor columns directly from it instead of re-deriving via `toMinor()` a
  second time — same number, computed once, no double-rounding risk.
- `backend/src/modules/quotes/quotes.service.ts` — same pattern (`createQuote`, its edit counterpart,
  PDF generation).
- `backend/src/modules/recurring-invoices/recurring-invoices.service.ts` — same pattern.
- `backend/src/modules/payments/payments.service.ts` — `totalPaid`/`amountPaid` read/write sites
  (creation, edit, deletion-triggered PAID-status re-evaluation logic added by
  `feat/invoice-partial-payment-199` — read that logic carefully, it sums `amountPaid` across
  `PaymentItem`s to decide if an invoice is fully paid; that summation must happen in minor units
  internally to avoid the exact float-drift problem this migration exists to fix, even though the
  final comparison result is the same either way for most cases).
- `backend/src/modules/articles/articles.service.ts` — `unitPrice` read/write.
- `backend/src/modules/stats/stats.service.ts` — currently accumulates `totalPaid`/`totalTTC` via
  plain `+=` on floats across many rows (see `cumulative += r.totalPaid`, `m.invoiced +=
  inv.totalTTC`, etc.). Switch the accumulation itself to minor units (sum integers, convert once at
  the end before returning) — this is the textbook case where float accumulation drift actually shows
  up over many additions, so don't just convert-then-add-then-the-old-way; add-then-convert-once.

After each service is switched, run that service's existing tests (there are currently none at the
service level for these modules — see `documentation/compliance/COMPLIANCE_STATUS.md`'s note on this;
add a couple of focused unit tests for the conversion logic if you introduce any non-trivial helper,
otherwise rely on the e2e suite) and the relevant e2e specs (`07-invoices`, `06-quotes`,
`10-recurring-invoices`, `08-payments`, `14-articles`, `12-discount`, `11-dashboard-navigation`).

### Phase 4 — cutover (separate PR/commit, only after Phase 3 has soaked)

Once every read/write path is confirmed on the Minor columns and nothing in the codebase still
references the old `Float` field for these columns (`grep` for each old field name across
`backend/src/` to confirm zero remaining references before doing this):

- Migration: drop the old `Float` columns, rename `<field>Minor` → `<field>` (Prisma migration with
  explicit `ALTER TABLE ... RENAME COLUMN`).
- Update the Prisma schema field types/names to match.
- This phase is the only genuinely destructive step in the whole migration (drops columns). Do it in
  its own commit, run the full test suite + e2e suite again immediately after, and don't bundle it
  with anything else.

## Out of scope for Part B

- Any frontend change (by design — see "Design principle" above).
- Changing the public API request/response shape for any endpoint.
- `quantity` and `vatRate`/`discountRate` fields (not money).
- The compliance module's own canonical `Money`/`accumulateTotals` (`backend/src/compliance/**`) —
  already correct, not touched, just reused.

## Tests / acceptance (whole of Part B)

- `npx tsc --noEmit`, `npx jest` (backend), `npx prisma validate` clean after every phase.
- Migrations apply cleanly via `prisma migrate deploy` against a **disposable** Postgres (never a
  shared/dev database — same rule as every other migration in this codebase) before being considered
  done.
- Phase 2's backfill script run twice produces identical `*Minor` values both times (idempotency).
- Phase 3: for a sample of existing invoices/quotes created before this migration, the Minor-derived
  float (via `fromMinor`) matches the original Float value to the cent (no silent re-rounding
  surprises from the backfill).
- Full e2e suite green after Phase 3, again after Phase 4.

Once both parts land, update `documentation/compliance/COMPLIANCE_STATUS.md`'s "Money migration" and
the country-related bullets — leave that doc edit for the review pass, not part of this brief.
