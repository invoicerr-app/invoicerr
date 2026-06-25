# Brief for opencode — per-country required identifiers (data model + dynamic forms)

> Context: every country requires different identification numbers from a company/client
> established there (France: SIREN/SIRET + N° TVA intracommunautaire; Mexico: RFC; the US: EIN;
> India: GSTIN + PAN; etc — see any `documentation/compliance/*.md` file, §"Key Identifiers" or
> similar). **Nothing in this codebase models that today.** `Company`/`Client` only have two fixed,
> generic columns (`legalId`, `VAT`); the compliance engine's `CountryComplianceProfile` has no axis
> declaring what a country expects; the frontend shows the same two fields regardless of country.
> This brief adds that axis, end to end: engine → storage → API → dynamic form.

This is new architecture, not a bug fix — read all of it before writing code, the design choices
matter and are explained, not just stated.

## Design

### Why not just add more fixed columns?

There's no fixed number of identifiers that covers every country (some need one, some need three),
and the canonical compliance model already solved this generically:
`backend/src/compliance/canonical/canonical-document.ts`'s `PartyIdentifier { scheme: string; value:
string; validated?: boolean }` is exactly "an arbitrary, typed identifier" — `scheme` is already a
free string with examples in its own comment (`'VAT' | 'SIREN' | 'SIRET' | 'EIN' | 'RFC' | 'PEPPOL'
...`). The gap isn't the canonical model, it's that (a) nothing tells you *which* schemes a given
country expects, and (b) the live Prisma schema never adopted the same generic shape.

### Two reserved schemes keep this additive and low-risk

`Company.legalId`/`Company.VAT` (and the same two on `Client`) already exist, are already wired into
PDF rendering and e-invoice export, and already hold real data for every existing user. Don't migrate
them. Instead, two scheme names are **reserved** and map onto those exact columns:

- `scheme: 'LEGAL_ID'` → reads/writes `legalId`.
- `scheme: 'VAT'` → reads/writes `VAT`.

Any other scheme value (`'RFC'`, `'GSTIN'`, `'EIN'`, `'PAN'`, whatever a country needs beyond those
two slots) is new data, stored in a new generic table (below). This means the majors that only ever
needed "a legal ID and a VAT number" (which is most of them) need **zero new storage** — only the
long tail that needs a third/fourth number touches the new table at all.

### New axis on the compliance profile

`backend/src/compliance/profiles/schema.ts` — add next to the other axes on `CountryComplianceProfile`:

```ts
export interface IdentifierRequirement {
  scheme: string;        // 'LEGAL_ID' | 'VAT' | 'RFC' | 'GSTIN' | ... — 'LEGAL_ID'/'VAT' are reserved, see above
  label: string;         // shown as the field label, e.g. "SIREN / SIRET", "RFC"
  appliesTo: 'COMPANY' | 'INDIVIDUAL' | 'BOTH';
  required: boolean;
  pattern?: string;      // optional regex (as a string) for client-side format hint, e.g. '^\\d{9}(\\d{5})?$'
  helpText?: string;     // optional one-line explanation rendered under the field
}
```

Add `requiredIdentifiers: IdentifierRequirement[]` to `CountryComplianceProfile`
(`backend/src/compliance/profiles/schema.ts`). **Not temporal** — unlike tax rates, which scheme of
identifier a country expects essentially never changes; don't add `Temporal<...>` wrapping for this
one, it would be ceremony with no real use.

### Populate it for the bespoke profiles only (v1)

Only the 5 hand-written, `OFFICIAL`-confidence profiles get real data in this pass — the same
boundary the rest of this codebase already draws between "verified" and "archetype-built, best
effort" (see `documentation/compliance/COMPLIANCE_STATUS.md`):

- `backend/src/compliance/profiles/data/fr.ts` — `[{ scheme: 'LEGAL_ID', label: 'SIREN / SIRET',
  appliesTo: 'BOTH', required: true, pattern: '^\\d{9}(\\d{5})?$', helpText: '9 digits (SIREN) or 14
  digits (SIRET)' }, { scheme: 'VAT', label: 'N° TVA intracommunautaire', appliesTo: 'COMPANY',
  required: false }]` (verify the exact pattern/requiredness against
  `documentation/compliance/FR-France.md` §"Key Identifiers" — don't invent details that file already
  states precisely).
- `backend/src/compliance/profiles/data/mx.ts` — RFC (`scheme: 'RFC'`, new, not one of the two
  reserved ones — Mexico doesn't really use the generic "legalId" concept the same way) — check
  `documentation/compliance/MX-Mexico.md` §"Key Identifiers" for the exact format
  (4 letters + 6 digits + 3 alphanumerics per that doc) and whether individuals need a different
  identifier (CURP) than companies (RFC alone) — model that via two entries with different
  `appliesTo`.
- `backend/src/compliance/profiles/data/us.ts` — EIN (likely maps to `LEGAL_ID`, `required: false`
  since plenty of US sole proprietors invoice without one — check the doc).
- The IT and PL bespoke profiles (`it.ts`/`pl.ts` — confirm exact filenames under
  `profiles/data/`) — Codice Fiscale/Partita IVA for Italy, NIP for Poland, same treatment.
- Every other country (archetype-built, `BEST_EFFORT`) gets a generic, conservative default:
  `[{ scheme: 'VAT', label: 'Tax / VAT number', appliesTo: 'BOTH', required: false }]` — wire this as
  the default inside `backend/src/compliance/profiles/archetypes.ts`'s builder function, not repeated
  106 times.
- `FALLBACK` profile: empty array — asking for nothing is the safe default when we don't know the
  country at all.

### Live storage — one new table

```prisma
model PartyIdentifier {
  id        String   @id @default(cuid())
  scheme    String
  value     String
  companyId String?
  company   Company? @relation(fields: [companyId], references: [id], onDelete: Cascade)
  clientId  String?
  client    Client?  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([companyId, scheme])
  @@unique([clientId, scheme])
}
```

Add the inverse relations (`partyIdentifiers PartyIdentifier[]`) on `Company` and `Client`. Purely
additive migration — no existing column touched.

A row should never exist for `scheme IN ('LEGAL_ID', 'VAT')` — those always go to the existing
columns. Enforce this in the service layer (reject/ignore those two scheme values when writing to
`PartyIdentifier`), don't rely on documentation alone.

### Backend: expose "what does this country need"

New endpoint, e.g. `GET /api/compliance/required-fields?countryCode=FR&partyType=COMPANY` →
`IdentifierRequirement[]`, filtered server-side so `appliesTo: 'INDIVIDUAL'` entries don't show up for
a `partyType=COMPANY` query and vice versa, `'BOTH'` always included. Pure read:
`defaultRegistry.resolve(countryCode).profile.requiredIdentifiers`, filtered. Put it on a small new
controller next to `backend/src/compliance/nest/compliance.controller.ts` (or add a route to that
same controller if it fits — your call, but keep it `@Public()` like the existing inbound webhook
route if no auth is needed for a read-only lookup, otherwise behind the normal auth guard like every
other app route — check what the rest of `/api/company`, `/api/clients` routes use and match that).

Write path: extend `EditCompanyDto`/`EditClientsDto` with `identifiers?: { scheme: string; value:
string }[]` (entries for `LEGAL_ID`/`VAT` in this array should be rejected with a 400 — those are not
this array's job, they're the existing top-level `legalId`/`VAT` fields). In
`company.service.ts`/`clients.service.ts`, after the existing create/update, upsert each entry into
`PartyIdentifier` keyed by `(companyId, scheme)`/`(clientId, scheme)` — delete rows whose scheme is no
longer present in the submitted array (full replace semantics, not append-only — simplest to reason
about, matches how a form re-submits its whole current state).

## Frontend: dynamic fields driven by the selected country

In `client-upsert.tsx`, `company.settings.tsx`, `onboarding.tsx` (the same three files touched by the
country-picker work) — once a country is selected (you have `countryCode` from
`TODO_COUNTRY_AND_MONEY_MIGRATION.md` Part A; if that hasn't landed yet, do this brief after it, it
depends on having a reliable `countryCode` to query with):

1. Fetch `GET /api/compliance/required-fields?countryCode=<code>&partyType=<COMPANY|INDIVIDUAL>`
   (react-query, keyed on `countryCode`+`partyType`, refetch on change).
2. For each returned requirement:
   - `scheme === 'LEGAL_ID'` → don't add a new field; instead update the **existing** `legalId`
     input's label to `requirement.label`, its `required` state to `requirement.required`, and add
     `requirement.helpText` as a hint under it if present.
   - `scheme === 'VAT'` → same, but for the existing `VAT` input.
   - anything else → render a new text input, one per requirement, in a small dynamically-generated
     block (e.g. below the legalId/VAT fields), bound to a new `identifiers` array field in the form
     state (`{ scheme, value }`), required/pattern-validated per the requirement. Use whatever this
     codebase's existing dynamic-field-array pattern is (check how invoice/quote line items — already
     a field array — are done in `invoice-upsert.tsx`/`quote-upsert.tsx` and mirror that, don't invent
     a new pattern).
3. Submit `identifiers` alongside the rest of the payload.
4. When editing an existing record, pre-fill `identifiers` from
   `client.partyIdentifiers`/`company.partyIdentifiers` (need to add that relation to the
   `GET /clients`, `GET /company/info` response — check `clients.service.ts`/`company.service.ts` and
   include it, plus add `partyIdentifiers?: { scheme: string; value: string }[]` to
   `frontend/src/types/client.ts`/`company.ts`).

## What this brief does **not** cover

- Numbering (`Company.invoiceNumberFormat` vs the engine's `NumberingRule` —
  `GAPLESS_SELF`/`AUTHORITY_RANGE`). Investigated separately: today's numbering is 100% disconnected
  from the engine (it's a pure user-configured template, see `backend/src/utils/pdf.ts`'s
  `formatPattern` + the Prisma extension in `backend/src/prisma/prisma.service.ts` that auto-fills
  `rawNumber` from it). For `GAPLESS_SELF` countries this happens to be roughly compliant already
  (Postgres `autoincrement()` + soft-delete via `isActive` never actually creates a gap). For
  `AUTHORITY_RANGE` countries (e.g. Mexico's SAT-assigned CFDI folio) it's actively wrong once
  clearance exists, because the legally authoritative number doesn't exist until the authority
  responds — a local template can never produce it. This is already tracked as the
  `numbering/folio-pool`/`gapless` stub in `documentation/compliance/COMPLIANCE_STATUS.md`'s to-do
  table, and can't really be fixed before the lifecycle is actually being driven (item 2 in
  "Suggested order" in that doc) — don't attempt it here, it needs clearance to exist first.
- Validating identifiers against an external registry (VIES-equivalent per scheme) — `pattern` here
  is a client-side format hint only, not a registry check. Same spirit as the existing VAT-validator
  gap already tracked.
- Populating `requiredIdentifiers` for the other ~100 archetype-built countries beyond the generic
  default — incremental work, same as graduating any archetype profile to `OFFICIAL`.

## Tests / acceptance

- `backend/src/compliance/profiles/data-integrity.spec.ts` (or a new spec next to it) — every
  documented country profile has a `requiredIdentifiers` array (possibly empty for FALLBACK, never
  `undefined`); no entry uses `scheme: 'LEGAL_ID'`/`'VAT'` with a `pattern` that contradicts what
  `legalId`/`VAT` already validate elsewhere (there currently is no format validation on those two
  fields — check before assuming there is).
- New unit test for the `GET /compliance/required-fields` endpoint: FR/COMPANY returns SIREN/SIRET +
  optional VAT; FR/INDIVIDUAL returns whatever `appliesTo` filtering produces; an unknown country
  code returns `[]` (FALLBACK), not an error.
- `npx tsc --noEmit`, `npx jest` (backend) clean.
- `prisma migrate dev` (disposable DB only, same rule as every other migration in this codebase)
  applies cleanly; the new table has no data yet (nothing to backfill — this is genuinely new
  information nobody has entered before).
- e2e: extend `02-company.cy.ts`/`05-clients.cy.ts` with at least one case that picks a country with
  a non-trivial `requiredIdentifiers` (France or Mexico), fills in the dynamically-rendered field(s),
  submits, and re-opens the edit form to confirm the value round-trips.

Once this lands, update `documentation/compliance/COMPLIANCE_STATUS.md` to record the new axis and
move "per-country required fields" off the gap list — leave that doc edit for the review pass, not
part of this brief.
