---
sidebar_position: 6
---

# Adding a country

The `documents` module (`backend/src/modules/documents/`) never asks "what country is this?" in
business code — no `if (country === 'FR')` anywhere in a controller, a service, or an action
handler. Instead, about ten small, independent mechanisms each answer one narrow question about a
country, as **data**: ONE JSON file per country (`countries/data/<cc>.json`), one optional section
per mechanism, discovered and loaded automatically at boot. Adding a country means adding a file,
almost never a line of code.

This page has the same two-part shape as every [country's own page](./country-support/index.md):
**Part 1** is for anyone who has never opened this codebase before — read it if you just want to
understand what "a country is data" actually means. **Part 2** is the step-by-step reference for
actually writing the file — read it when you're the one adding France's neighbour. For the
generated *result* — what each of the five covered countries currently gets, read live from these
same files — see the [country compliance matrix](./country-support/index.md); that page is rebuilt
from the files this guide tells you how to write, every time the docs are built, so it can never
say something these files don't.

If you already know which country you want and would rather start from it than from the mechanism,
the [country directory](./countries/index.md) has a page per country — what its e-invoicing system
is called, who runs it, which format family it uses, and which of the files below that country
would need. Around a hundred of those countries have no file here at all; their page says so on
the first line.

For adding a new *kind of document* (an invoice, a quote, something else entirely) rather than a
new country, see [Adding a document type](./adding-a-document-type.md) instead — the two are
deliberately independent axes; see the [overview](./extending-invoicerr.md) for how they fit
together.

## Part 1 — In plain words

**A country, in this app, is one text file - not a piece of code.** If you open
`backend/src/modules/documents/countries/data/`, you'll find files named `fr.json`, `de.json`,
`it.json`, and so on - one per country, nothing more. Each one is a plain list of facts about that
one country, grouped into named sections: "can a French company send an invoice by email? yes."
"Does Poland require a specific numbered format? yes, and here's the rule." Nobody writes a
special case in the actual program for France or Poland - the program is *identical* for every
country; only these fact-files differ. Adding a new country means writing one more file like the
others, in the same folder, and - for almost all of what it needs - nothing else at all: no line
of code, no table to edit, no button to press. The app itself notices the new file the next time
it starts (an "auto-discovery" list, not a maintained one).

**Every fact carries proof, or admits it has none.** Next to almost every fact in these files there
is a little note saying where it comes from: either an exact quote from an actual law, with the
date someone checked it — or, just as honestly, a note that says "nobody has checked this against
the real law yet, and here is exactly what would need to be checked." The app is built so that a
fact can *never* silently be neither — you cannot write a rule that just says "yes" with no
explanation of where "yes" comes from. A country whose file is almost entirely "not yet checked" is
not a bad or embarrassing file; it is an honest one, and it is exactly as valid and exactly as
usable as a fully-researched one.

**When you try to do something the app doesn't allow, it always tells you exactly why — one of
four different reasons, never a vague "no".** Depending on what's wrong, you'll be told: "your
country's law doesn't allow this at all" (a genuine legal block), "not right now — this document
isn't in the right state for that action yet" (e.g. you can't re-edit an invoice as a draft once
it's been sent), "this app hasn't actually built that feature yet for your case" (an honest gap,
not a bug), or "something you typed doesn't fit what's expected" (a plain data-entry problem).
These four reasons are checked in a fixed order, every single time, whether you clicked a button
on the screen or a robot sent the same request directly — so the screen never promises something
the server actually refuses.

**You never have to remember to "update the database" by hand.** For most of these fact-files, the
database is just a live mirror of them — every time the app (or its background worker) starts up,
it quietly checks whether its own database still matches what the files say, and corrects it if it
doesn't. You edit a file, you restart the app, and it's in sync. There is no separate manual step to
forget.

## Part 2 — The details

### Provenance is mandatory, not decoration

Every fact — a rule, a route, a rate, a mention — carries a `provenance` field that is either:

- `{ "kind": "legal", "sourceText": "...", "sourceCheckedAt": "yyyy-mm-dd" }` — an exact quote
  from a primary (or clearly official) source, and the date it was checked against that source;
  or
- `{ "kind": "unverified", "resolutionNote": "..." }` — a plain statement of what would have to
  be checked, and against which text/authority, to turn this into a `legal` entry.

There is no third option, and no silent default. Every section's own schema enforces this at
**load time** (`assertValidProvenance` and its per-section siblings, all called from ONE place -
`countries/data/all.ts`, the single composed loader every country's merged file goes through): a
JSON file with no `provenance`, or a `legal` claim with no `sourceText`, fails to load - which for
the `policy`/`b2gRouting`/etc. sections means **the whole backend fails to boot**, and for tests
it means every vitest run fails immediately. This is deliberate: a rule without a citation must
never be one accidental commit away from looking exactly like a rule that has one.

`unverified` is an honest, first-class state — not a lesser one. A country file made entirely of
well-written `unverified` entries, each naming exactly what research would settle it, is a *good*
file: it tells the next person precisely where to start. Compare Portugal's own `policy` section
in `countries/data/pt.json` (3 of its 23 rules sourced to a real legal citation today, the rest
honestly `unverified`, each with a specific resolution note) to France's `correctionRoutes`
section's `CREDIT_NOTE` route (a `legal` entry quoting BOFiP directly). Both are equally valid
shapes for this format; they just represent different amounts of finished research.

Absence is a *refusal*, never a default. A country with no `policy` section in its
`countries/data/xx.json` file doesn't get "reasonable defaults" - every document action is
blocked for it, loudly, naming the missing section (`country-policy.ts`'s own "no permissive
fallback, no silent gap" rule). A country with no `b2gRouting` section gets an honest "no B2G rule
declared for XX", never a silent fallback to a generic B2B channel. If you ship a `correctionRoutes`
section (whose schema requires all eleven routes to be present, most of them `unverified`) that is
*sparse* rather than *absent*, that sparseness must be spelled out fact-by-fact, never implied by a
missing key.

### The mechanisms — a map

Each is independent: none of them read each other's files, and a country can have some without
having others. Of the five countries this product covers today (FR, DE, IT, PL, PT), none has a
file in every single mechanism — see the [country compliance matrix](./country-support/index.md) for exactly which ones
are still open per country, and each country's own "Not yet configured" callouts for why that's an
honest gap rather than a guess.

Every mechanism below is one optional top-level key in `countries/data/<cc>.json` - there is no
separate directory or file to open any more; the "Section" column names the exact key.

| Mechanism | Section | Answers | Mirrored to a DB table? |
| --- | --- | --- | --- |
| Document-action policy | `policy` | Which document **actions** (send, save-draft, …) a company of this country may run, and under what status restriction. | Yes - auto-corrected on **every boot**, in every environment (see "Boot-time self-correction" below), plus `prisma/seed.ts` on an explicit migrate/seed. |
| B2G routing | `b2gRouting` | When this country is the **government client's** country: which transport + format, which client identifiers/document fields it needs. | Yes - `boot-upsert.ts`, unconditionally re-upserted on **every** backend boot (`OnModuleInit`). |
| Correction routes | `correctionRoutes` | For each of the 11 canonical correction routes (credit note, corrective invoice, cancel-and-replace, …), is it `required`/`allowed`/`forbidden`/`unverified` for this country. | No - read live from the file. |
| Local cancel (derived) | `correction-routes/cancel-policy.ts` (code, not a section) | Whether *this app* can actually realize `CANCEL_AND_REPLACE` locally for this country (a whitelist cross-checked against the `correctionRoutes` section above). | No - pure function over the section above. |
| Channel policy | `channelPolicy` | For a company **established** in this country: is a given transmission channel merely usual (`suggested`) or legally required from a date (`mandated`)? A `mandated` fact may narrow itself with `scope: { "parties": "domestic" }`, meaning it binds only an invoice whose buyer is established in the same country - which is what both national mandates shipped today actually say. | No - read live from the file. |
| Tax system | `taxSystem` | What the cross-border tax engine assumes about this country's rate structure (VAT/GST/SALES_TAX/NONE, standard rate). Does **not** cover EU/GCC union membership or a Peppol EAS code - see the maintainer note below, "EU/GCC membership and Peppol EAS live in a reference table, not a country file". | No - read live from the file. |
| Country identifiers | `identifiers` | Which national identifier schemes (SIRET, EIN, VAT number, …) a party of this country must supply. | Yes - auto-corrected on **every boot**, same mechanism as document-action policy (see below), plus `prisma/seed.ts`. |
| Country field overlay | `countryFields` | Adds/modifies/removes a **field** on an existing document type's shape for this country. | No - read live from the file. |
| Localized tax mentions | `localizedMentions` | The exact wording this country's statute prescribes for the invoice mention of a tax situation (`franchise`, `reverseCharge`, `exportGoods`, `intraComm`), each with its `code`, `text` and the quoted `source`. A situation with no entry prints the generic Directive-citing mention. | No - read live from the file by `tax/tax-engine.ts`. |
| Mandatory mentions | `mentions` | Free-text legal mentions (BG-1) this country requires on every invoice, temporal. | No - read live from the file. |
| Content requirements | `contentRequirements` | Whether a specific EN 16931 field (e.g. BT-23) must carry a country-derived value from a date. | No - read live from the file. |
| VAT rate catalog | `vatRates` | The rate **ladder** a user picks from on one invoice line (presentation data, not a tax computation). | No - read live from the file. |
| Archive retention | `retention` | How long a document archived for this country must be kept, and - just as important - **what that duration is counted from** (`origin`: the archiving instant, the issue date, the end of its calendar year, or a safe reading of a financial-year close). A country may declare SEVERAL rules: they are simultaneous obligations, and the effective floor is their maximum, never a choice between them. | No - read live from the file; written onto `DocumentArchive.retentionUntil`/`retentionBasis` when an archive is created. |
| Reporting obligation | `reporting` | Whether this country requires an invoice's data to reach its tax authority after issuance, independently of how the invoice was delivered - distinct from channel policy, which is about delivery. Each fact says WHO discharges it (`dischargedBy: "provider"`, the seller itself; or `"transport"`, when the delivery channel already carries the data as a legal side effect - France's PDP for a B2B-domestic invoice) and, optionally, WHICH transactions it covers (`scope`, e.g. `"b2c"`/`"international"`/`"payments"` - absent means "every transaction", the shape Portugal's own file still uses). Only an unscoped `"provider"` fact is auto-triggered at send time; a `"transport"` fact or a scoped one is catalog data only - see `reporting/schema.ts`'s own header. | No - read live from the file. |
| VAT national currency | `vatCurrency` | Whether this country's VAT must additionally appear converted into its own national currency when the invoice is issued in another one, and whether the taxable amount must too. | No - read live from the file. |
| Domestic reverse charge | `domesticReverseCharge` | The statutory categories in which the buyer, not the seller, owes the VAT on a purely domestic supply. | No - read live from the file; not wired into the tax engine yet. |

You will rarely need all of these for a new country. A country whose only need is "let the OSS tax
engine compute a destination rate for it" needs *only* the `taxSystem` section - see
`tax/tax-systems/data/all.ts`'s own header for the EU member states added purely for that reason.

### The composed per-country view: how the single file actually works

Issue #603 (owner decision, 2026-10-01) was a six-step migration from one JSON file PER MECHANISM
to **one JSON file per country**: France's own facts used to be spread across all fourteen
catalogs' own `data/fr.json`. They now live in one place, `countries/data/fr.json`, one top-level
key per mechanism (the "Section" column in the table above). The six steps below are kept as the
historical record of how that migration stayed safe at every point - each one shipped with its own
proof that behaviour did not change - not a set of future steps still to do.

**Step 1** added `backend/src/modules/documents/countries/compose.ts` and
`registry.ts`, a read-only view that groups every one of the 14 existing catalogs' already-loaded,
already-validated files by country code into one `ComposedCountryView` object per country, with one
optional field per mechanism: `policy`, `identifiers`, `correctionRoutes`, `vatRates`, `taxSystem`,
`vatCurrency`, `channelPolicy`, `retention`, `mentions`, `localizedMentions`, `reporting`, `domesticReverseCharge`,
`countryFields`, `contentRequirements`, `b2gRouting`.

:::info[Nothing moved yet]
Step 1 reads the existing files through the existing loaders and validators. It does not move a
single `data/<cc>.json`. A section is present on the composed object if and only if that mechanism
already has a file for that country; `compose.spec.ts` proves this with a deep-equality test against
every existing loader, country by country and section by section, plus a pinned coverage matrix so a
mechanism silently gaining or losing a country is a visible, named test failure rather than a silent
diff.
:::

**Step 2** moves `vat-rates/registry.ts`'s default catalog content onto the composed view:
`VatRateCatalog`'s no-argument constructor now reads every country's `vatRates` section from
`defaultComposedCountryCatalog` instead of its own `data/all.ts` directly. The constructor still takes
a plain `CountryVatRatesFile[]` (unchanged signature, so every existing caller and test that passes an
explicit array keeps working exactly as before); only what the DEFAULT argument reads changed. No
import cycle results: `compose.ts` reads the RAW `vat-rates/data/all.ts` loader, never
`vat-rates/registry.ts`, so the dependency stays one-way (`vat-rates/registry.ts` reads
`countries/registry.ts`, which reads `countries/compose.ts`, which reads `vat-rates/data/all.ts`).
`vat-rates/data/all.ts` and its own `data/<cc>.json` files are untouched; this step changes only where
the registry reads from, never the files themselves or any observable behaviour.

**Step 3** repeats the exact same move for `country-fields/registry.ts`: `CountryFieldOverlayCatalog`'s
no-argument constructor now reads every country's `countryFields` section from
`defaultComposedCountryCatalog` instead of its own `data/all.ts` directly. Same unchanged constructor
signature (`CountryFieldOverlayFile[]`), same one-way dependency chain
(`country-fields/registry.ts` reads `countries/registry.ts`, which reads `countries/compose.ts`, which
reads `country-fields/data/all.ts`, never the other way), same "nothing moved, only where the default
reads from changed" scope.

**Step 4** repeats the exact same move for every remaining mechanism WITHOUT a DB mirror, batched
into one pull request (the owner's own call, so the identical change lands in one review instead of
nine): `correction-routes`, `transports/channel-policy`, `tax/tax-systems`, `vat-currency`,
`content-requirements`, `mentions`, `archive/retention`, `reporting`, `domestic-reverse-charge`. Each
catalog's own `registry.ts` gets the same three-line change step 2 and step 3 already proved: a
`<section>FromComposedCatalog()` helper reads `defaultComposedCountryCatalog.get(cc)?.<section>` for
every country the composed view knows, and only the no-argument constructor default is repointed at
it. Same unchanged constructor signature for all nine catalogs (each still takes its own plain
`CountryXFile[]`), same one-way dependency chain (`<catalog>/registry.ts` reads
`countries/registry.ts`, which reads `countries/compose.ts`, which reads `<catalog>/data/all.ts`,
never the other way), same "nothing moved, only where the default reads from changed" scope.
`tax/tax-systems/registry.ts` is the one catalog here with a second constructor parameter
(`vatRateCatalog`, already defaulting to `defaultVatRateCatalog` since step 2); that parameter is
untouched, only the `files` parameter's own default changed. `correction-routes` has no dedicated
`registry.spec.ts`; its no-argument constructor is exercised instead by `correction-routes.spec.ts`
(`resolveCorrectionRoutesForCountry`, which reads `defaultCorrectionRoutesCatalog` directly) and by
`countries/compose.spec.ts`.

**Step 5** repeats the exact same move for the three remaining mechanisms, the ones WITH a DB
mirror: `country-policy`, `country-identifiers`, `b2g-routing`. Every catalog in this module now
reads through the composed view. Each one gets a `<section>FromComposedCatalog()` helper identical
in shape to steps 2-4's, and only the no-argument constructor default is repointed at it, same
unchanged constructor signature, same one-way dependency chain, same "nothing moved, only where the
default reads from changed" scope. The reseed/seed services were deliberately left untouched:
`country-policy/seed.ts`, `country-policy/boot-reseed.ts`, `country-identifiers/boot-reseed.ts`,
`b2g-routing/boot-upsert.ts` and `backend/scripts/release-catalogs.ts` all already read each
catalog's own `defaultXxxCatalog` export (never `data/all.ts` directly), so none of them needed a
change for this step to take effect. A dry run of `catalogs:release` against a fresh local database,
before and after this step, upserts the exact same row counts (204 document-action rules, 16
identifier requirements, 5 B2G routing rules) and an excluded-id, excluded-timestamp dump of all
three mirrored tables diffs empty.

**Step 6** physically relocated the per-country JSON files themselves: the 14 old
`<catalog>/data/<cc>.json` files are gone, replaced by one `countries/data/<cc>.json` per country
(one key per mechanism, exactly the "Section" column in the table above). `countries/data/all.ts`
is now the single loader - one `readdirSync` over `countries/data/`, one call per section to that
section's own, UNCHANGED validator (`assertValidProvenance`, `assertValidVatRateProvenance`, …) -
replacing the 14 independent per-mechanism loaders this page used to describe. Every one of the 14
mechanisms' own `registry.ts` is untouched (steps 2-5 already pointed every one of them at
`defaultComposedCountryCatalog`); each mechanism's own `data/all.ts` is also still there, still
exporting its own `ALL_XXX_FILES` array for the handful of callers that import it directly, but it
now DERIVES that array from `defaultComposedCountryCatalog` instead of reading any file itself -
the validation already happened once, centrally, in `countries/data/all.ts`. Proof this step moved
data and nothing else: the composed view dumped to JSON, before the move (reconstructed from the 14
old files) and after (read from the single new ones), diffs empty; the same `catalogs:release` dry
run step 5 ran, repeated against the post-move code, upserts the identical 204/16/5 row counts, and
the three mirrored tables diff empty again.

Writing a new country's file today means writing exactly ONE file,
`countries/data/<cc>.json`, with one key per mechanism it needs - see "Step by step" below.

### Maintainer note: `domesticInvoiceCurrency`, a currency-of-account rule, not a new mechanism

Issue #558 (Algeria) added one more OPTIONAL fact to `country-policy/schema.ts`'s
`CountryDocumentPolicyFile`, alongside `numberFormats`: `domesticInvoiceCurrency`, for a country whose
law requires an invoice to be issued in its OWN official currency whenever BOTH the seller and the
buyer are established there (a purely domestic operation). Algeria's own Banque d'Algérie règlement
n° 07-01, art. 5, *"Toute facturation ou vente de biens et services sur le territoire douanier
national s'effectue en dinars algériens sauf cas prévus par la réglementation en vigueur,"* is the
first sourced example (the `policy` section of `countries/data/dz.json`).

It is deliberately NOT its own catalog directory: it is one more field on the SAME file every other
document-action rule already lives in, file-only like `numberFormats` (no DB mirror, read at request
time from `registry.ts#domesticInvoiceCurrencyFor`), with the same mandatory provenance every other
fact here carries (`assertValidDomesticInvoiceCurrencyFact`, called at load time, `countries/data/all.ts`).
Absence means "no domestic-currency rule found for this country", never "foreign currency forbidden
by omission", the same "no permissive fallback, no invented block" discipline every fact in this file
already holds; DE/FR/IT/PL/PT simply omit it.

Two consumers read it, both under `country-policy/domestic-currency-issuance.ts`:

- The invoice create form (frontend) calls `GET /api/documents/domestic-invoice-currency?countryCode=`
  to PRESELECT the required currency once the company's own country and the chosen client's country
  turn out to match, a convenience only, never itself a block.
- The "send" preflight (`actions/invoice-actions.ts`) calls `runDomesticInvoiceCurrencyPreflight`,
  which BLOCKS the send outright when the operation is domestic and the invoice's own currency does
  not match. "Domestic" is decided the same way `transports/channel-policy/mandate.ts`'s own
  `isDomestic` already decides it for a channel mandate (an unresolved buyer country is treated as
  domestic, fail-closed), not a second, independently-drifting definition.

The thrown `BadRequestException` carries a stable `code`
(`DOMESTIC_INVOICE_CURRENCY_MISMATCH_CODE`) plus structured `params` (`countryCode`,
`requiredCurrency`, `invoiceCurrency`), never the raw catalog quote: two already-decided product
rules (issues #554, #563) say user-facing text lives in `frontend/src/locales/en/translation.json`,
translated, never a developer-facing message pasted straight into a toast. The frontend
(`use-document-action-runner.ts`) branches on that code and renders its own short, translated message,
resolving the country's DISPLAY name from `countryCode` via `Intl.DisplayNames` (the same convention
`channel-banner.tsx`'s own `countryName` already uses), never the bare ISO code. The exception's own
`message` field stays as a plain, quote-free, date-free English fallback for a non-UI API consumer
only (a script reading the JSON body directly) - it is never shown to a user. A new country adding
this fact needs no frontend change at all: the message is generic over `countryCode`/
`requiredCurrency`.

### Maintainer note: `invoiceValidation`, whether Validate also transmits

Issue #581's owner decision (2026-10-01, revised after the pull request's own review) added another
OPTIONAL fact to `country-policy/schema.ts`'s `CountryDocumentPolicyFile`: `invoiceValidation`, for a
country whose law treats an invoice as not genuinely issued until it has gone through a mandated
channel - so Invoicerr's **Validate** action (which otherwise only assigns the legal number and
locks the record, no transmission) must perform the real send as part of validating, rather than
leaving the invoice numbered-and-locked but not yet lawfully issued.

```json
"invoiceValidation": {
  "transmitsThroughMandatedChannel": true,
  "channelLabel": "the accredited platform (PDP)",
  "provenance": { "kind": "legal", "sourceText": "...", "sourceCheckedAt": "2026-09-24" },
  "notes": "optional free text"
}
```

`transmitsThroughMandatedChannel` is always the literal `true` when present - there is no `false`
shape, the same "presence is the fact, absence is a refusal" discipline `domesticInvoiceCurrency`
above already follows. `channelLabel` is the plain-English name shown verbatim in the Validate
confirmation dialog's alert ("the accredited platform (PDP)", "SdI") - never the bare internal
channel id. `provenance` is mandatory like every other fact here, validated BOTH at load time
(`countries/data/all.ts`) and at seed time (`seed.ts`) even though this fact is file-only and never
mirrored to a DB row - the same belt-and-braces validation `numbering`/`numberFormats` already
have, deliberately stricter than `domesticInvoiceCurrency`'s own load-time-only check above.
Declared today for France (CGI art. 289 bis I) and Italy (D.Lgs. 127/2015 art. 1 comma 6, SdI);
DE/PL/PT/DZ omit it, so Validate stays a plain number-and-lock there.

**This fact alone is not enough to transmit.** `country-policy/invoice-validation-transmission.ts#resolveInvoiceValidationTransmission`
is the single resolver every caller goes through, and it requires BOTH conditions: this fact present
for the invoice's own seller country, AND the operation currently bound by an active channel mandate
(`transports/channel-policy/mandate.ts#activeChannelMandateForOperation` - today's issue date, this
seller, this buyer). A country can plausibly declare one without the other eventually; today's two
declarations happen to also carry an active mandate, which is what makes them transmit in practice.

Two callers share that one resolver, deliberately never a second copy of the decision:

- `actions/invoice-actions.ts`'s own `"validate"` handler - when it resolves `transmits: true`, it
  calls the exact same `performInvoiceSend` function `"send"` itself uses, never a parallel
  implementation that could silently drift from it.
- The same handler's `registerTransmissionPreview('invoice', 'validate', ...)` registration
  (`actions/action-registry.ts`'s own `registerTransmissionPreview`/`resolveTransmissionPreview`,
  mirroring `registerParamsDefaults` exactly) - read by `GET
  /api/documents/:id/actions/:actionId/transmission-preview` (`documents.controller.ts`,
  `documents.service.ts#getActionTransmissionPreview`), which the frontend's lock-confirmation dialog
  (`document-form.tsx`'s `DocumentActionLockConfirmHost`, via
  `use-document-types.ts#useActionTransmissionPreview`) fetches the moment it opens, BEFORE the user
  confirms. When it resolves `transmits: true`, the dialog renders a dedicated alert
  (`frontend/src/locales/en/translation.json`'s `documents.form.lockConfirmation.transmits`) naming
  the channel and stating the action cannot be undone - a separate block from the generic "numbering
  and locking are final" warning every locking action already shows. A country or operation that does
  not transmit shows only that generic warning, never the extra alert.

A new document type wanting the same "does my own locking action transmit, and should the dialog say
so" behavior registers its own transmission-preview resolver the same way - the mechanism is generic
over any action an `ActionRegistry` declares `actionLocksDocument` for, not invoice- or
validate-specific; only the registration body choosing WHEN to answer `transmits: true` differs per
type.

### Maintainer note: `documentValidationCode`, a company-level validation-code scheme

Issue #603 (audit section 1, row 3 / section 5, row B) replaced four independent `=== 'PT'` /
`!== 'PT'` literals - two in the backend (`actions/atcud-issuance.ts`, `company/company.service.ts`),
two in the frontend (the settings tab, the ATCUD settings screen) - with one more OPTIONAL fact on
`country-policy/schema.ts`'s `CountryDocumentPolicyFile`: `documentValidationCode`.

```json
"documentValidationCode": {
  "scheme": "ATCUD",
  "provenance": { "kind": "legal", "sourceText": "...", "sourceCheckedAt": "2026-09-28" },
  "notes": "optional free text"
}
```

`scheme` is a plain, generic name, never a boolean "requiresAtcud": Portugal's own scheme is the
ATCUD (Decreto-Lei n.º 28/2019, art. 7.º n.º 3; Portaria n.º 195/2020), but the fact names the scheme
rather than assuming it is the only one that will ever exist - another country may one day require
its own code under its own name, and would declare it here with a different `scheme` string, never
by adding a second boolean flag. `provenance` is mandatory like every other fact in this file,
validated both at load time (`countries/data/all.ts`) and at seed time (`seed.ts`) even though this
fact is file-only and never mirrored to a DB row - the same belt-and-braces validation
`invoiceValidation` above already has. Absence means "no validation-code scheme for this country",
the same "no permissive fallback" discipline every fact here holds; every shipped country but
Portugal omits it.

This is deliberately separate from the PER-DOCUMENT-TYPE `numbering` facts the same file already
declares (`requirement: 'atcud-required'`, on "invoice" and "credit-note" for Portugal): those say
WHICH document types carry the code once numbered; `documentValidationCode` only answers whether the
company's country has such a scheme AT ALL - the single, company-level question the four replaced
literals actually asked, read once from `registry.ts#documentValidationCodeFor` instead of four
independent copies of the same country-code comparison:

- `actions/atcud-issuance.ts`'s `ensureAtcudIssuable` (preflight) and `attachAtcudToNumberedDocument`
  (post-numbering) both no-op unless the company's resolved country's fact has `scheme === 'ATCUD'`.
- `company/company.service.ts#declareLastNumberIssued` routes to the Portugal-specific
  `declarePortugalNewSeries` under the same condition, instead of the generic pattern-declaration
  path every other country uses.
- `GET /api/company/info` (`CompanyService#getCompanyInfo`) now returns a computed
  `documentValidationCode` field (`{ scheme: string } | null`) alongside the raw company row, so the
  frontend never re-derives the fact from `country`/`countryCode` itself. Both frontend readers
  (`settings/-[tab].tsx`'s tab visibility, `settings/_components/atcud.settings.tsx`'s own screen
  gate) check `company.documentValidationCode?.scheme === "ATCUD"` against that same field.

A country adding its own validation-code scheme one day needs no frontend change for the PRESENCE
check above (it is generic over the field), but the ATCUD computation itself
(`numbering/atcud.ts`, `actions/atcud-issuance.ts`) stays Portugal-specific code: a second scheme
would still need its own implementation, this fact only lets the gate find it without a new literal.

### Maintainer note: `revenueBasisDefault`, the default revenue basis

A company that has not chosen a revenue basis (Settings > Company > Revenue basis) starts from its
country's `policy.revenueBasisDefault`:

```json
"revenueBasisDefault": {
  "basis": "cashed",
  "reason": "Shown verbatim on the settings screen next to the default.",
  "provenance": { "kind": "legal", "sourceText": "...", "sourceCheckedAt": "YYYY-MM-DD" },
  "notes": "optional free text"
}
```

`basis` is `invoiced` or `cashed`; `reason` must be non-blank; `provenance` goes through the same gate
as every other fact in this file, at load time (`countries/data/all.ts`). A country without the fact
defaults to `invoiced`, the product's behaviour everywhere else, so declare it only where one regime
is both clearly cash-based in law and the most common among the country's freelancers (France's
micro-entrepreneur, Italy's regime forfettario). The company has no regime field, so a default for a
less common regime would be wrong more often than right. Read by
`company/revenue-basis/resolve-revenue-basis.ts` through `registry.ts#revenueBasisDefaultFor`.

### Maintainer note: EU/GCC membership and Peppol EAS live in a reference table, not a country file

Issue #603 (audit section 1, row 1 / section 5, row A) replaced FOUR independent copies of the EU
member state list (`tax/classification.ts`'s `EU_MEMBERS`/`GCC_VAT`, `formats/semantic/build-
semantic-invoice.ts`'s `VAT_PREFIX_TO_PEPPOL_EAS`, `formats/national/fatturapa-provider.ts`'s
`EU_CC`, `ocr-service/local-client.ts`'s `EU_VAT_PREFIXES`) with ONE shared reference table,
`backend/src/modules/documents/tax/tax-unions/data/tax-unions.json`.

:::info[Why this is not a 15th section on the country file]
Every other mechanism in this guide answers a question about one of the countries this product
ships a seller file for (FR/DE/IT/PL/PT/DZ today). EU and GCC membership is different: a French
seller's invoice can name a BUYER established in any of the 27 EU member states, and this product
does not ship a `countries/data/<cc>.json` for the other 26. A per-seller-country section could
never cover that - the fact has to exist for every possible buyer country, independently of which
countries this product ships a seller file for, so it lives in its own standalone, country-blind
table instead.
:::

`tax/tax-unions/schema.ts` and `registry.ts` follow the same discipline as every section above:
load-time validation (`assertValidTaxUnionsFile`), mandatory `provenance` on each of the table's
four aspects (EU membership, GCC membership, Peppol EAS, the OCR upload-screen's own recognition
heuristic), and "no permissive fallback" (a country absent from the table is simply not a union
member and has no Peppol EAS code, never a guessed one). Unlike the per-country mechanisms, there
is one row per country in a SINGLE file, not one file per country - the table is read-only
reference data, not something a country PR adds to.

Three consumers now read `defaultTaxUnionRegistry` instead of keeping their own copy:

- `tax/classification.ts#taxUnionOf` - the cross-border tax engine's own EU/GCC classification.
- `formats/semantic/build-semantic-invoice.ts#peppolEasForVat` - the EN 16931 bridge's Peppol EAS
  lookup for a party's `cbc:EndpointID@schemeID`, keyed by VAT PREFIX (Greece resolves under `EL`,
  never the ISO code `GR` - see the table's own `vatPrefix` field).
- `formats/national/fatturapa-provider.ts#mapNatura` - whether a non-Italian EU buyer gets the
  reverse-charge `Natura` code N6.

`ocr-service/local-client.ts` (outside the `documents/` module entirely) reads
`defaultTaxUnionRegistry.ocrRecognizedPrefixes()` directly for its own VAT-id-shape heuristic - a
product decision, not a legal fact, which is why the table also carries three non-EU/GCC
neighbours (`CH`/`NO`/`GB`) and one non-ISO entry (`XI`, Northern Ireland's own post-Brexit VAT
prefix) purely for that one consumer; each carries a `notes` field explaining why it is there.

A new country being added to the SIX shipped sellers never needs to touch this table: its own
membership and VAT-prefix facts are either already present (every EU/GCC state is) or genuinely
absent (no union membership at all), exactly like every other reference-data fact in this product.
This table only changes when the EU or the GCC itself gains or loses a member, or Peppol publishes
a new EAS code - a rare, well-sourced event, never a per-country-PR concern.

### Maintainer note: a mention whose value changes on a schedule

A mention's `noteValues` table is not always a one-time fact. France's late-payment penalty rate
(the `mentions` section of `countries/data/fr.json`, placeholder `{lateFeeRate}`) is set by the
ECB's Governing Council twice a
year (the rate in force from 1 January is decided mid-December, the one from 1 July mid-June, per
C. com. art. L441-10 II) and this app's table necessarily lags the real calendar by however long it
takes someone to add the new window after each decision.

Two things keep a send working while that catches up:

- `InvoiceNoteRule.fallbackText` (`mentions/schema.ts`): printed, quoted from the statute itself,
  whenever `at` has reached or passed the table's own last `validTo`. A send is never refused just
  because the table has not been updated yet; see `resolveNoteText` in `mentions/invoice-notes.ts`.
- `mentions/data/all.spec.ts`'s own canary: fails once more than 21 days have passed since
  `lateFeeRate`'s last window ended, via `isPastMaintenanceGracePeriod`. Not sooner: the real figure
  genuinely does not exist before the ECB meets, so a canary that fired the day the window closes
  would just teach everyone to ignore a red build. When it fires, add the new `noteValues` entry to
  the `mentions` section of `countries/data/fr.json` with the ECB's published rate and its own
  `sourceCheckedAt`.

## Step by step

### 1. Decide what this country actually needs

Read the request. "Can a French company send an invoice to a Belgian government client?" needs
the `b2gRouting` section of `countries/data/be.json`. "Can we let a Hungarian company use this app
at all?" needs the `policy` section of `countries/data/hu.json`. Don't ship every section because
the format allows every section - an absent section is an honest "not yet", a sparse or padded one
is not.

### 2. Research honestly, one mechanism at a time

For each fact, try to find the actual legal (or clearly official — an EU Commission factsheet,
a national tax authority's own portal) text. When you find it:

```json
{
  "kind": "legal",
  "sourceText": "the exact text, quoted — never paraphrased, never translated into a summary",
  "sourceCheckedAt": "2026-09-03"
}
```

When you don't (a paywalled register, a portal that blocks automated requests, a text you
genuinely couldn't reach in the time you had):

```json
{
  "kind": "unverified",
  "resolutionNote": "What, specifically, would settle this — which text, which authority, which register. Not 'needs research' — say what the research IS."
}
```

The `correctionRoutes` section's existing countries were originally transcribed from a dedicated
correction-routes legal research pass (2026-08-29, covering FR/IT/PL/DE/ES/MX/US) — each route's own
`provenance` already carries the primary citation that pass found, verbatim, so nothing further needs
citing from it today. A country added since has no such shared research to draw from: source it
directly from primary text instead, the way Portugal's own section does (see
`correction-routes/data/pt.spec.ts`'s own header).

### 3. Write `countries/data/<cc>.json`, one section at a time, each shaped exactly like `schema.ts` says

The file itself is trivial: `{ "countryCode": "HU", "policy": { ... }, "b2gRouting": { ... } }` -
a top-level `countryCode` matching the filename, and one key per mechanism you need, named exactly
as the "Section" column in the table above spells it. Each SECTION's own shape is still owned by
that mechanism's own `schema.ts` - read it before writing the section; it is usually a page of
comments explaining exactly why each field exists. A few shapes worth knowing up front:

- `policy` needs a non-empty `documentTypes` array (which document types show at all for this
  country) **and** a `rules` array. A rule can narrow to specific statuses (`"statuses": ["draft"]`)
 - see Poland's own `invoice.save-draft` rule, which uses this to reflect KSeF's real-world
  immutability (once a Polish invoice reaches KSeF, re-saving it as a draft is refused; only a
  corrective invoice can fix it).
- `b2gRouting` is the one section with NO top-level envelope of its own any more: it used to wrap
  its rule in `{ "countryCode": "...", "rule": { ... } }` back when it was its own file; as a
  section it IS the rule directly (`{ "countryCode": "...", "transportId": "...", ... }`), the same
  flat shape every sibling section already has.
- `correctionRoutes` must cover **all eleven** canonical route IDs (`CORRECTION_ROUTE_IDS` in
 `correction-routes/schema.ts`) - sparse is not allowed; an unresearched route gets an honest
  `"status": "unverified"` entry, never an omitted key. The vocabulary is closed: you may not
  invent a twelfth route. If your research genuinely surfaces a correction mechanism that doesn't
 fit any of the eleven, that is a change to the closed vocabulary - `CORRECTION_ROUTE_IDS` in
 `correction-routes/schema.ts` - first, never a silent extra value dropped into a country's
  section.
- `channelPolicy`'s `requirement: "mandated"` **requires** `legal` provenance and a `mandatedFrom`
 date - the schema throws at load if you mark something mandated on an `unverified` claim. If
  you're not yet confident the channel is genuinely *required* rather than merely usual, stay
 `suggested` - see Italy's and Poland's own `suggested` entries, both still `unverified` today but
  honestly so.
  The mandate mechanism understands exactly ONE narrowing, and no other: `scope: { "parties":
  "domestic" }`, which makes the fact bind only when the buyer is established in the same country.
  Declare it whenever the statute you quote restricts itself to operations between parties
  established there, as France's CGI art. 289 bis and Italy's D.Lgs. 127/2015 art. 1 comma 3 both do
  - without it the mandate would refuse a lawful cross-border invoice. `scope` is a **closed** shape:
  any other key, or any other value, throws at load rather than being ignored, because a silently
  ignored narrowing is a legal block left armed (or disarmed) by accident. Every other kind of
  conditional or partial exception - a turnover threshold, a taxpayer status, a transaction type -
  still has no way to be encoded, and a fact that would need one stays `suggested`: see Poland's
  own notes for a worked example of that choice.
  Narrowing the invoicing mandate does not discharge whatever DECLARATION the same law may still
  require for the cross-border operation (France's e-reporting, Italy's art. 1 comma 3-bis). That
  belongs to the `reporting` section, and neither is implemented today.
- `contentRequirements` facts are **always** `legal` - there is no `unverified` escape hatch for a
  content requirement; if you can't source it yet, don't ship it.
- `taxSystem` may omit `standardRate` for a VAT/GST country **if** the same file's own `vatRates`
 section already has a `STANDARD`-category entry - it's derived from there rather than duplicated
  (see `tax/tax-systems/schema.ts`'s own "DELIBERATE NON-DUPLICATION").
- `reporting` every fact needs `dischargedBy`. Pick `"transport"` only when a DELIVERY channel
  already carries the data to the authority as a legal side effect of sending the invoice (its
 `providerId` then names a `transports/transport-registry.ts` id, e.g. `"pdp"` - never validated
  against that registry here, the same "two independently maintained sources" risk every sibling
  `providerId` field already accepts); otherwise `"provider"`, and `providerId` names a
 `reporting/declaration-provider.ts` `DeclarationProviderRegistry` id - it may legitimately name
  one nothing implements yet (an honest placeholder, same convention as Portugal's own `"fe-ap"`).
  Add `scope` only when the LAW ITSELF carves out specific transaction categories
  (`"b2b-domestic"`/`"b2c"`/`"international"`/`"payments"`) — omit it when the law draws no such
  distinction, never to "narrow" a fact for convenience. A scoped fact, or one with
  `dischargedBy: "transport"`, is deliberately never auto-triggered at send time (this codebase has
  no per-invoice B2B/B2C classifier yet) — it stays catalog data, read by the settings screen, until
  that wiring exists.

### 4. Register the file — almost always a no-op

This step doesn't exist: `countries/data/all.ts` calls its own `discoverCountryCodes()`, which does
an `fs.readdirSync` on `countries/data/`, keeps whatever matches `/^[a-z]{2}\.json$/` (a lowercase
two-letter code plus `.json` - nothing else in that folder matches, including this `all.ts` file
itself and `all.spec.ts`), sorts the result for a deterministic load order, and loads every one of
them, section by section. Drop `countries/data/hu.json` in, restart the backend (or run the test
suite), and it is loaded — there is no array to add a line to, and no second file anywhere in the
codebase that also needs to know Hungary now exists. Removing a country is the same, in reverse:
delete the file and it stops loading, no dangling entry to clean up. Adding a SECOND section to an
already-shipped country's file needs no registration either - it is just one more key in a file
`countries/data/all.ts` already discovers.

### Boot-time self-correction — you don't reseed by hand

Two of the eleven mechanisms above also mirror their data into a Postgres table (read at request
time from the DB, not from the JSON files directly) — `DocumentCountryActionRule`
(`country-policy`) and `CountryIdentifierRequirement` (`country-identifiers`). Historically, that
mirror was only refreshed by `prisma/seed.ts`, which runs on `migrate dev`/`migrate reset`/an
explicit `db seed` — **not** on an ordinary restart of an already-migrated database, which is
exactly the gap that let a JSON-only edit silently 403 every document action until someone
remembered to reseed by hand — `resetAndSeed` does not reseed the country policy.

Both tables now also self-correct on **every single backend boot**, in every environment including
production (`country-policy/boot-reseed.service.ts` and `country-identifiers/boot-reseed.service.ts`,
both a plain `OnModuleInit`): a pure, DB-free comparison (`drift.ts` in each mechanism's own
directory) first checks whether the table already matches what the JSON files say; only if it
doesn't does the existing seed function actually run, so an already-in-sync boot costs one read
query, never a wasted write. This never throws — a transient DB hiccup at boot degrades to the
existing, already-loud 403 at request time, never a crashed boot. `B2gRoutingRule` has held the
equivalent guarantee for longer, in an even simpler shape (`b2g-routing/boot-upsert.service.ts`
always re-upserts unconditionally, with no separate drift-detection step — that table is small
enough that "upserted: 15" on every boot is cheap and not worth optimizing away).

Practically: edit any country's `policy` or `identifiers` section in `countries/data/<cc>.json`,
restart the backend (or a worker, which imports the same module and runs the same check), and the
database is already correct — you do not need to remember `prisma db seed`, though running it
still works too. Every OTHER mechanism in the table above has no DB mirror to go stale in the
first place; it is read straight from the file on every request.

### The four gates — what happens when you actually try to run an action

Once a country's files are in place, `DocumentsService.runAction` (`documents.service.ts`) is the
**only** place an action ever actually runs — the same four checks, in the same order, whether a
click on the screen or a script hits the API directly, so "what the screen refuses, the API
refuses" is true by construction:

1. **403 — country policy.** `evaluateCountryPolicy` reads this company's resolved country and
   this action's own rule in that country's `policy` section (`countries/data/<cc>.json`). No
   `policy` section for this country at all, or a rule that exists but says `allowed: false`,
   throws `ForbiddenException`, naming the country and exactly what would unblock it.
2. **409 — status.** Two independent checks land on this same code, never a second 403: the
   descriptor's own `availableWhen` (is this action even offered for a document in its current
   state?), and the country policy's own PER-STATUS narrowing (`DocumentActionRuleFact.statuses`
   — e.g. Poland's `invoice.save-draft`, restricted to `draft`, reflecting KSeF's real immutability
   once an invoice has been cleared).
3. **501 — implementation.** The action is declared on the descriptor and allowed by every check
   above, but nobody has registered an `ActionHandler` for it in the `ActionRegistry` yet (e.g.
   "convert-to-invoice" until an invoicing pipeline existed to back it, or a channel a B2G rule
   names — e.g. `zre-ozgre` — before this repo's own transport for it is built; `chorus-pro` used to
   be this example too, until `transports/chorus-pro-transport.ts` registered it, proven live in
   qualification 2026-09-14, see `credentials-guide.md` §3).
   `NotImplementedException`, never a silent no-op: a declared-but-unimplemented action is a real,
   visible gap, not an oversight to hide.
4. **400 — validation.** The document's own field values (against the country-and-plugin-merged
   descriptor `applyCompanyFieldView` produces — never the bare trunk descriptor, so a scripted
   client can't bypass what a country overlay added or required) and the action's own `params`
   fail `validateAgainstDescriptor`. `BadRequestException`, per-field.

A single scripted export endpoint (`downloadDocumentFormat`, same file) runs the exact same four gates
by hand, in the exact same order, for exactly this reason — there is no second, looser code path
into an action's effect.

## What NOT to do

- **Do not guess a status to fill a gap.** `"status": "required"` with no real citation is worse
  than `"status": "unverified"` with an honest note — the schema gate technically allows neither
  (a non-`unverified` status *requires* `legal` provenance), but human review should catch a
  citation stretched to sound more confident than the source actually is.
- **Do not stretch a citation to cover more than it says.** If a source establishes a channel
  exists but not that it's mandatory, that's `suggested`, not `mandated`.
- **Do not promote an `unverified` entry to `legal` without actually re-reading the primary
  source.** Reusing another file's *already-verified* citation for the same fact (e.g. an EU
  regulation that applies identically to every member state — see `it.json`/`pl.json`'s own
  `quote.send`, both reusing the same eIDAS (EU 910/2014, art. 25 §1) citation `de.json` already
  read, since it is a REGULATION and needs no national transposition) is fine and should say so
  plainly; inventing a `sourceCheckedAt` for a text you didn't re-open is not.
- **Do not invent a new correction-route ID**, a new tax `kind`, or a new provenance `kind` — all
  three vocabularies are closed by their own schema, deliberately, so no business code ever has to
  special-case a spelling only one country's file uses.
- **Do not merge two different concerns into one file** because they happen to be about the same
  country — `country-policy` (which actions run) and `channel-policy` (which channel a seller's
  country requires) are read by different code for different questions and must stay that way,
  even for a country that has both.

## When a country needs more than a file

Some countries genuinely need code, not just data:

- **A national transmission channel this repo doesn't talk to yet** (a new `transportId`) needs a
  new transport under `transports/` implementing the actual protocol — the data files only ever
  *reference* a `transportId`/`formatSyntax`; they never validate that it resolves to something
  real (`b2g-routing/schema.ts`'s own comment on why `transportId` is deliberately not checked
  against the live registry at load time — sending refuses, loudly, naming exactly the missing
  channel, rather than the file failing to load).
- **A required national CIUS/format variant this repo doesn't vendor** needs that schema vendored
  under `formats/vendored/` and a real format provider built against it — never a generic Peppol
  BIS payload asserted to satisfy a CIUS it was never validated against. This is exactly why
  Poland's own `b2gRouting` section chose KSeF over the Peppol-based PEF platform whose
  Polish-specific extension this repo does not vendor; see that section's own `notes` for why.
- **A new document field only one country's law gives meaning to** needs a `countryFields`
  overlay (`add`/`modify`/`remove` on the trunk shape), not a change to the trunk descriptor
 itself - see France's own `countryFields` section's `supplyType` addition, which exists only to
  let France's own BT-23 content requirement derive a value.

## Two real files worth reading end to end

Every example below is now a SECTION inside one country's own `countries/data/<cc>.json`, not a
separate file - read the whole file, not just the section named, to see it alongside that
country's other mechanisms.

- **Poland's own `b2gRouting` section (`countries/data/pl.json`)** - a decision made by actually
  reading two official sources (the EU Commission's own Poland factsheet *and* the Polish Ministry
  of Finance's KSeF portal), which turned up **two** viable B2G channels (KSeF and PEF) and chose
 the one this repo can actually deliver - not the one that looked more "European". Read its
  `notes` field for the full reasoning: this is what "settled by reading the source, not by
  picking the obvious one" looks like in a real file.
- **Germany's own `b2gRouting` section (`countries/data/de.json`)** - the opposite journey on the
  SAME axis, and it went there and back: reading the actual German federal text (§ 4 ERechV)
  turned up a channel this repo did not implement at all (`zre-ozgre`), so sending was correctly
  BLOCKED, by name, rather than silently routed to email; a later, dated addendum then documented a
  second, independent reading (the ZRE/OZG-RE platforms' own FAQ) that found Peppol had become an
  accepted channel, wired it, and proved a real live send end to end; a further addendum, dated
  2026-09-15, records that the Peppol transport was removed from the product (no real Access Point
  account ever backed it) and the rule reverted to naming `zre-ozgre` again. The section's own
 history is the proof that "blocked, honestly" is a legitimate state at either end of that arc -
  resolving a gap, and un-resolving one when the thing that closed it turns out not to hold up, are
  both better than a guess.
- **Portugal's own `policy` section (`countries/data/pt.json`)** - 20 of its 23 rules are
  `unverified`, each with a specific, useful resolution note. This is not an unfinished section to
  be ashamed of; it is exactly what honest, partial research looks like in this format, and it is
  just as loadable and just as enforced as a fully-`legal` one.
- **France's own `reporting` section (`countries/data/fr.json`)** - the section that grew
  `reporting/schema.ts`'s `dischargedBy`/`scope` fields in the first place. Reading CGI art. 289 E
  in brut text showed that a B2B-domestic French
  invoice's data-transmission duty falls on the PDP platform, never the company — a fact this
  catalog's original one-`providerId`-fires-unconditionally shape could not say at all — while
  art. 290/290 A impose a SEPARATE, periodic obligation on the seller, but only for B2C, export/
  intra-EU, and payment data. Three facts, three different `scope`s, one `dischargedBy: "transport"`
  and two `dischargedBy: "provider"` (naming a provider nothing implements yet — see this page's own
  bullet above on that being a legitimate, named placeholder) — and two of the three stay
  `unverified` on purpose: the OBLIGATION itself was read in brut, but the calendar that says WHEN it
  starts (a décret, size-tiered) was not, after several distinct attempts against Légifrance/JORF/
  BOFiP all documented, dated, in the file's own `notes`.

## Seeing the result

Once your file is in place, rebuild the docs (`npm run build` or `npm run start` in
`documentation/` — the [country matrix](./country-support/index.md) regenerates automatically as
a `prebuild`/`prestart` step, straight from the files you just wrote) to see exactly what the
matrix, your country's own page, and its "Not yet configured" callouts now say. If it doesn't say
what you expect, the data — not the generator — is almost certainly the thing to fix.
