# Analysis — per-country data & presentation across the whole app (frontend + storage + render)

> This is the umbrella analysis the user asked for: "anticipate the per-country fields for *all* data
> types." It is NOT a single executable brief — it inventories every place the app silently assumes
> one country's shape, says whether the compliance engine already models it, and proposes one
> unifying architecture so each gap becomes a small brief cut from the same pattern. Two sub-briefs
> already exist and are the first two instances of this pattern:
> `TODO_PER_COUNTRY_REQUIRED_FIELDS.md` (identifiers) and `TODO_COUNTRY_AND_MONEY_MIGRATION.md`
> Part A (reliable `countryCode`). Do not re-spec those here; the rest below builds on them.
>
> Grounded in the real code as of this branch — every "today" claim has a file reference.

## The one root cause

Every form, every stored row, and the PDF renderer hardcode a single (EU/France-ish) shape. Meanwhile
`backend/src/compliance/` already models almost all the per-country variation as data
(`CountryComplianceProfile`, the canonical document in
`backend/src/compliance/canonical/canonical-document.ts`, and the axes catalogued in
`documentation/compliance/COMPLIANCE_ARCHITECTURE.md` §5/§6). **The engine knows; the app doesn't
ask, doesn't store the answer in the right shape, and doesn't render it.** So this whole effort is
mostly *connecting* an existing engine to the UI/storage/PDF — not inventing new compliance logic.

## The unifying architecture (decide once, reuse for every field type)

Generalize exactly what `TODO_PER_COUNTRY_REQUIRED_FIELDS.md` does for identifiers, to **all**
country-varying inputs:

1. **The profile declares requirements as data.** Each `CountryComplianceProfile` carries declarative
   descriptors (which identifiers, which address shape, which bank-detail scheme, whether a state/
   region is required, default date format, mandated invoice currency/language, …). Most are a small
   enum or a short list, not free logic.
2. **One backend read endpoint** turns "(countryCode, partyType, docType)" into a descriptor the
   frontend can render: `GET /api/compliance/form-schema?countryCode=..&partyType=..` returning the
   union of field requirements. The identifiers endpoint in
   `TODO_PER_COUNTRY_REQUIRED_FIELDS.md` is the first slice of this; widen it rather than adding a
   second parallel endpoint.
3. **Frontend forms render from the descriptor**, not from a fixed JSX field list. Static fields that
   always exist (name, email) stay hardcoded; country-varying fields (identifiers, address subfields,
   bank details, region/state requiredness, postal-code rule) come from the descriptor.
4. **Storage uses generic, additive shapes** for the open-ended parts (the `PartyIdentifier` table
   from the identifiers brief is the template; bank details want the same treatment), and keeps the
   existing flat columns for the universal fields.
5. **The PDF/e-invoice renderer reads the engine's already-computed outputs** (legal mentions, tax
   treatment, QR) instead of re-deriving a France-only string.

This keeps the "profile-as-data, no per-country `if` in the engine" principle the whole subsystem was
built on (`documentation/compliance/COMPLIANCE_ARCHITECTURE.md` §3) and extends it to the UI.

---

## The inventory — every per-country surface, today vs needed

### 1. Identifiers (SIREN/RFC/EIN/GSTIN/…) — **briefed**
Today: `Company`/`Client` have only flat `legalId` + `VAT`
(`backend/prisma/schema.prisma` Company/Client). Forms show exactly those two regardless of country
(`company.settings.tsx:331-374`, `client-upsert.tsx`). → `TODO_PER_COUNTRY_REQUIRED_FIELDS.md`.

### 2. Reliable country code — **briefed**
Today: the picker stores a localized display label, not the ISO code
(`frontend/src/components/country-select.tsx` builds `{ label, value: label }`); the engine then
reverse-guesses via EN/FR-only `guessCountryCode`. → `TODO_COUNTRY_AND_MONEY_MIGRATION.md` Part A.

### 3. Money storage — **briefed**
Today: every total/price is `Float`. → `TODO_COUNTRY_AND_MONEY_MIGRATION.md` Part B.

### 4. Address shape & rendering — **gap, not briefed**
Today:
- Fixed fields `address`, `addressLine2`, `postalCode`, `city`, `state`, `country`
  (`company.settings.tsx:385-457`, same on client).
- `state` is always "optional" in the form (`company.settings.tsx:444`) — but it's **mandatory** for
  US/CA/IN/AU/BR/… and meaningless for most of the EU. No country drives this.
- Postal code validated by one regex for the whole world: `/^[0-9A-Z\s-]{3,10}$/`
  (`company.settings.tsx:86`) — wrong for UK/NL/etc., and some countries have no postal code at all.
- The PDF prints a single fixed order: `{city}, {state} {postalCode}` then `{country}`
  (`backend/src/modules/invoices/templates/base.template.ts:46-49, 65-68`). Japan/China/Korea (postal
  code first, largest-to-smallest, no "city, state" comma form) come out malformed.
- `backend/src/utils/adress.ts` `parseAddress()` splits house-number from street with a stack of
  locale-ish regexes and **throws** on anything it can't match — a per-country fragility.
Needed: the profile declares an address descriptor (which subfields exist, which are required, render
order, postal-code rule, whether a region/state is required and what it's called — "State"/"Province"/
"Prefecture"/"Region"). The canonical model already has `StructuredAddress`
(`canonical-document.ts:29`) and the architecture doc anticipated this (§6); the live `Company`/
`Client` storage and the PDF template are what's flat.

### 5. Bank / payment details — **gap, not briefed (largest one)**
Today: `PaymentMethod.details` is **one free-text string** (`schema.prisma` PaymentMethod;
`payment-method-upsert.tsx:116-128` — a single `details` Input). There is no structure for IBAN+BIC
(EU/SEPA), routing+account (US ACH), Sort Code+account (UK), CLABE (MX), BSB (AU), IFSC (IN), etc.
Several countries legally require specific structured bank details on the invoice. This is the single
biggest unstructured per-country surface.
Needed: same generic-typed-entries pattern as identifiers — a bank-detail scheme per country
(`scheme: 'IBAN'|'BIC'|'US_ACH'|'CLABE'|...`), descriptor-driven form, structured storage, rendered
into the PDF in the country-appropriate block. Reuse the `PartyIdentifier`-style table shape.

### 6. Legal mentions on the invoice — **gap; engine already computes them**
Today: the PDF shows exactly one hardcoded, France-only line —
`vatExemptText = ... 'TVA non applicable, art. 293 B du CGI'` gated on
`country === 'FRANCE'` (`backend/src/modules/invoices/invoices.service.ts` getInvoicePdf, ~line 449;
template `base.template.ts:115-118`). A 0%-rated export or reverse-charge invoice (which the tax
engine now produces correctly, see `documentation/compliance/COMPLIANCE_STATUS.md`) has the right
numbers but **no legal sentence explaining why** — which is itself a legal defect in most
jurisdictions.
Needed: the engine *already* emits these per line as `TaxTreatment.mentions`
(machine-tagged + text, e.g. reverse charge VATEX-EU-AE, export VATEX-EU-G, intra-community,
out-of-scope — see `backend/src/compliance/engine/tax-engine.ts` `MENTION.*`). Surface
`plan.tax.mentions` into the PDF context and template, replacing the France-only string. This one is
small and high-value and is a natural follow-on to the tax-engine wiring already merged.

### 7. Numbering — **gap; partially incompatible by design**
Today: a pure user-configured template (`Company.invoiceNumberFormat` e.g. `"INV-{year}-{number:4}"`),
materialized into `rawNumber` by a Prisma client extension
(`backend/src/utils/pdf.ts` `formatPattern` + `backend/src/prisma/prisma.service.ts`). Completely
disconnected from the engine's `NumberingRule` (`GAPLESS_SELF` vs `AUTHORITY_RANGE` —
`backend/src/compliance/profiles/schema.ts:97`).
Needed (later): for `GAPLESS_SELF` the current template is roughly fine. For `AUTHORITY_RANGE`
(e.g. Mexico CFDI folios assigned by the SAT) the legal number does not exist until the authority
responds, so a local template is structurally wrong — this cannot be fixed before the lifecycle is
actually driven (clearance). Tracked as the `numbering/folio-pool` stub already; **explicitly defer**
until lifecycle-driving lands (see COMPLIANCE_STATUS "Suggested order").

### 8. Date format & currency defaults — **minor gap; infra now exists**
Today: date format is a manual 7-option dropdown (`company.settings.tsx:27, 657-681`); currency now
auto-defaults from country via the `useCountryToCurrency` hook added by dev. Date format could
likewise default from the selected country. Also: the engine models `requiresTaxCurrency` (e.g. MX
must invoice in MXN — `backend/src/compliance/profiles/schema.ts:108`) which nothing enforces in the
invoice form. Low urgency; bundle with whatever touches the company form next.

### 9. Multi-tax / withholding line items — **gap on both sides of the seam**
Today: a line item has one `vatRate` number (`invoice-line-items-editor.tsx`; `InvoiceItem.vatRate`).
The engine and canonical model already support several `TaxComponent`s per line plus `Withholding`
(`canonical-document.ts:61` `TaxComponent`; architecture §6 axis N — BR ICMS+IPI+PIS+COFINS, IN
CGST+SGST+IGST, US state+county+city, IT/PE ritenuta/percepción). The frontend's single-rate field
and the single `vatRate` column can't express these. Larger; needs both a storage shape and a
descriptor-driven line editor. Defer until a country that needs it is actually targeted.

### 10. Invoice language & PDF labels — **gap**
Today: `pdfConfig` carries labels, configured manually, in one language. Some countries require the
invoice rendered in the local (or buyer's) language. No per-country/per-buyer language selection.
Needed (later): default label set per country/locale, and optionally render in the buyer's mandated
language. Lower priority than 4/5/6.

### 11. QR & signing presentation — **gap; engine anticipates it**
Today: nothing. Engine/architecture already foresee a `QrRule` and per-country signing/cert types
(`COMPLIANCE_ARCHITECTURE.md` §5 axis E, §7 `qr`). SA/IT-B2C/PT/LATAM mandate a QR on the PDF.
Needed (later, after signing providers are real): render the engine-produced QR payload into the PDF.
Bound to the signing stubs, so it comes with that work, not before.

### 12. Document-type taxonomy / B2G — **gap**
Today: client is `INDIVIDUAL`|`COMPANY` only; no B2G path (e.g. France Chorus Pro B2G needs a service
code + buyer SIRET; many LATAM countries have boleta vs factura, guía, complemento — architecture §5
axis M). The engine models the taxonomy; the UI offers two client types and one document shape.
Needed (later): part of driving the lifecycle + per-country document kinds; depends on the engine
being in the live create path.

---

## Suggested order for the cut-from-this briefs

Dependencies first. Items already briefed in **bold-italic**.

1. ***Reliable `countryCode`*** (`TODO_COUNTRY_AND_MONEY_MIGRATION.md` Part A) — everything below keys
   off a trustworthy ISO code.
2. ***Per-country identifiers*** (`TODO_PER_COUNTRY_REQUIRED_FIELDS.md`) — also lays down the
   descriptor-endpoint + dynamic-form + generic-table **pattern** the rest reuse.
3. **Legal mentions into the PDF** (#6) — tiny, high-value, no new pattern needed (engine already
   computes them); fixes a real legal defect introduced the moment cross-border 0% rating went live.
   Good first standalone brief to cut.
4. **Bank / payment details** (#5) — biggest unstructured surface; reuses the identifiers pattern
   wholesale (generic typed entries + descriptor + dynamic form + PDF render).
5. **Address shape & rendering** (#4) — region/state requiredness + postal rule from the descriptor;
   country-aware PDF address block.
6. **Date/currency defaults + tax-currency enforcement** (#8) — small, bundle with #5 if touching the
   same company form.
7. ***Money migration*** (`TODO_COUNTRY_AND_MONEY_MIGRATION.md` Part B) — independent of the above,
   schedule whenever.
8. Later, gated on lifecycle-driving (COMPLIANCE_STATUS "Suggested order" item 2): numbering for
   `AUTHORITY_RANGE` (#7), multi-tax/withholding (#9), QR/signing (#11), document taxonomy/B2G (#12),
   invoice language (#10).

## When cutting each brief, follow the house rules already established

- Additive Prisma migrations only; disposable DB for any migrate/reset (never the shared dev DB) —
  same discipline as every migration in this repo.
- Keep `backend/src/compliance/**` pure (no NestJS/Prisma imports) — consume it, don't edit it, unless
  the brief is explicitly adding a declarative axis to the profile schema.
- Reuse, don't duplicate: `decimalsFor`/`money`, the `PartyIdentifier`-style generic table, the single
  `form-schema` endpoint. No second currency table, no second descriptor endpoint.
- Each brief ends by updating `documentation/compliance/COMPLIANCE_STATUS.md` to move its item off the
  gap list — in the review pass, not inside the brief.

*Analysis only — no code changed. Cut individual executable briefs from §"Suggested order" as
capacity frees up; #3 (legal mentions) is the recommended next one to hand to opencode after the two
in-flight briefs land.*
