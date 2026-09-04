---
sidebar_position: 6
---

# Adding a country

The `documents` module (`backend/src/modules/documents/`) never asks "what country is this?" in
business code — no `if (country === 'FR')` anywhere in a controller, a service, or an action
handler. Instead, nine small, independent catalogs each answer one narrow question about a
country, as **data**: a JSON file per country, loaded and validated at boot. Adding a country
means adding data, never a branch.

This page is the practical, step-by-step half of that idea. For the generated result — what each
covered country currently gets, read live from these same files — see the
[country compliance matrix](./country-support/index.md). That page is rebuilt from the files this
guide tells you how to write, every time the docs are built — it can never say something these
files don't.

## The philosophy, stated plainly

- **A country is data.** The engine (`country-policy.ts`, `b2g-routing.ts`, `tax-engine.ts`, …)
  is the same code for every country; only the JSON differs. If you find yourself wanting to add a
  country-specific `if`, the fix is almost always a new fact in a data file, not a new branch.
- **Provenance is mandatory, not decoration.** Every fact — a rule, a route, a rate, a mention —
  carries a `provenance` field that is either:
  - `{ "kind": "legal", "sourceText": "...", "sourceCheckedAt": "yyyy-mm-dd" }` — an exact quote
    from a primary (or clearly official) source, and the date it was checked against that source;
    or
  - `{ "kind": "unverified", "resolutionNote": "..." }` — a plain statement of what would have to
    be checked, and against which text/authority, to turn this into a `legal` entry.

  There is no third option, and no silent default. Every schema in this module enforces this at
  **load time** (`assertValidProvenance` and its per-module siblings, called from that mechanism's
  own `data/all.ts`): a JSON file with no `provenance`, or a `legal` claim with no `sourceText`,
  fails to load — which for `country-policy`/`b2g-routing`/etc. means **the whole backend fails to
  boot**, and for tests it means every jest run fails immediately. This is deliberate: a rule
  without a citation must never be one accidental commit away from looking exactly like a rule
  that has one.
- **`unverified` is an honest, first-class state — not a lesser one.** A country file made
  entirely of well-written `unverified` entries, each naming exactly what research would settle
  it, is a *good* file: it tells the next person precisely where to start. Compare
  `country-policy/data/mx.json` (20 `unverified` entries out of 22, each with a specific
  resolution note — e.g. "product convenience, no Mexican text identified for the act itself") to
  `country-policy/data/pl.json`'s `invoice.send` rule (a `legal` entry quoting the Polish VAT act
  directly). Both are equally valid shapes for this format; they just represent different amounts
  of finished research.
- **Absence is a *refusal*, never a default.** A country with no `country-policy/data/xx.json`
  file doesn't get "reasonable defaults" — every document action is blocked for it, loudly, naming
  the missing file (`country-policy.ts`'s own "no permissive fallback, no silent gap" rule). A
  country with no `b2g-routing/data/xx.json` gets an honest "no B2G rule declared for XX", never a
  silent fallback to a generic B2B channel. If you ship a file that is *sparse* rather than
  *absent* (e.g. `correction-routes/`, whose schema requires all eleven routes to be present, most
  of them `unverified`), that sparseness must be spelled out fact-by-fact, never implied by a
  missing key.

## The nine mechanisms — a map

Each is independent: none of them read each other's files, and a country can have some without
having others (Romania has a `channel-policy` fact and nothing else; the United Kingdom has only
`country-identifiers`).

| Mechanism | Directory | Answers | Mirrored to DB? |
| --- | --- | --- | --- |
| Document-action policy | `country-policy/data/` | Which document **actions** (send, save-draft, …) a company of this country may run, and under what status restriction. | Yes — `seed.ts`, run explicitly (`prisma/seed.ts` / a reseed step; **not** automatic on every boot — see the gotcha below). |
| B2G routing | `b2g-routing/data/` | When this country is the **government client's** country: which transport + format, which client identifiers/document fields it needs. | Yes — `boot-upsert.ts`, run automatically on **every** backend boot (`OnModuleInit`). |
| Correction routes | `correction-routes/data/` | For each of the 11 canonical correction routes (credit note, corrective invoice, cancel-and-replace, …), is it `required`/`allowed`/`forbidden`/`unverified` for this country. | No — read live from the file. |
| Local cancel (derived) | `correction-routes/cancel-policy.ts` | Whether *this app* can actually realize `CANCEL_AND_REPLACE` locally for this country (a whitelist cross-checked against the correction-routes data above). | No — pure function over the file above. |
| Channel policy | `transports/channel-policy/data/` | For a company **established** in this country: is a given transmission channel merely usual (`suggested`) or legally required from a date (`mandated`)? | No — read live from the file. |
| Tax system | `tax/tax-systems/data/` | What the cross-border tax engine assumes about this country's rate structure (VAT/GST/SALES_TAX/NONE, standard rate). | No — read live from the file. |
| Country identifiers | `country-identifiers/data/` | Which national identifier schemes (SIRET, EIN, VAT number, …) a party of this country must supply. | No — read live from the file. |
| Country field overlay | `country-fields/data/` | Adds/modifies/removes a **field** on an existing document type's shape for this country. | No — read live from the file. |
| Mandatory mentions | `mentions/data/` | Free-text legal mentions (BG-1) this country requires on every invoice, temporal. | No — read live from the file. |
| Content requirements | `content-requirements/data/` | Whether a specific EN 16931 field (e.g. BT-23) must carry a country-derived value from a date. | No — read live from the file. |
| VAT rate catalog | `vat-rates/data/` | The rate **ladder** a user picks from on one invoice line (presentation data, not a tax computation). | No — read live from the file. |

You will rarely need all nine for a new country. A country whose only need is "let the OSS tax
engine compute a destination rate for it" needs *only* `tax/tax-systems/data/xx.json` — see the 26
EU member states added purely for that reason (`tax/tax-systems/data/all.ts`'s own header).

## Step by step

### 1. Decide what this country actually needs

Read the request. "Can a French company send an invoice to a Belgian government client?" needs
`b2g-routing/data/be.json`. "Can we let a Hungarian company use this app at all?" needs
`country-policy/data/hu.json`. Don't ship five files because the format allows five files — an
absent file is an honest "not yet", a sparse or padded one is not.

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

`correction-routes/data/*.json` additionally transcribes from `docs/compliance/CORRECTION-ROUTES.yaml`
(a research document, not code) — a route's `notes` there should say which YAML row it came from
and that document's own `meta.updated` date, so a stale transcription is easy to spot later.

### 3. Write `data/<cc>.json`, shaped exactly like `schema.ts` says

Every mechanism's `schema.ts` is the actual contract — read it before writing the file; it is
usually a page of comments explaining exactly why each field exists. A few shapes worth knowing
up front:

- `country-policy/data/<cc>.json` needs a non-empty `documentTypes` array (which document types
  show at all for this country) **and** a `rules` array. A rule can narrow to specific statuses
  (`"statuses": ["draft"]`) — see `pl.json`'s `invoice.save-draft`, which uses this to reflect
  KSeF's real-world immutability (once a Polish invoice reaches KSeF, re-saving it as a draft is
  refused; only a corrective invoice can fix it).
- `b2g-routing/data/<cc>.json` wraps its one rule in `{ "countryCode": "...", "rule": { ... } }`
  (the only mechanism in this family with that envelope — every sibling file is flat).
- `correction-routes/data/<cc>.json` must cover **all eleven** canonical route IDs
  (`CORRECTION_ROUTE_IDS` in `correction-routes/schema.ts`) — sparse is not allowed; an
  unresearched route gets an honest `"status": "unverified"` entry, never an omitted key. The
  vocabulary is closed: you may not invent a twelfth route. If your research genuinely surfaces a
  correction mechanism that doesn't fit any of the eleven, that is a change to
  `docs/compliance/CORRECTION-ROUTES.yaml` first, not a new value in this schema.
- `transports/channel-policy/data/<cc>.json`'s `requirement: "mandated"` **requires** `legal`
  provenance and a `mandatedFrom` date — the schema throws at load if you mark something mandated
  on an `unverified` claim. If the law says "in principle" with a real exception (Belgium's own
  `be.json` is the shipped example — see its `notes`), stay `suggested`: the mandate mechanism is
  binary today and has no way to encode a conditional exception.
- `content-requirements/data/<cc>.json` facts are **always** `legal` — there is no `unverified`
  escape hatch for a content requirement; if you can't source it yet, don't ship it.
- `tax/tax-systems/data/<cc>.json` may omit `standardRate` for a VAT/GST country **if**
  `vat-rates/data/<cc>.json` already has a `STANDARD`-category entry — it's derived from there
  rather than duplicated (see `tax/tax-systems/schema.ts`'s own "DELIBERATE NON-DUPLICATION").

### 4. Register the file

Add the lowercase country code to that mechanism's `COUNTRY_FILES` array in its `data/all.ts` —
literally one line, alphabetised with its neighbours. This is the only code change adding a
country ever requires; the loader (`fs.readFileSync` + `JSON.parse`, deliberately not a TS
`import`) picks the new file up on its own. If you skip this step the file simply never loads —
there is no directory-scan fallback, on purpose (see each `all.ts`'s own header for why: an
explicit list is what makes "add fr, es, mx" a one-line, reviewable diff instead of a silent
side effect of dropping a file in a folder).

**Gotcha — `country-policy` needs a reseed, not just a reboot.** Unlike every other mechanism,
`country-policy`'s table is populated by `prisma/seed.ts`, which runs on `migrate dev`/`migrate
reset`/an explicit `db seed` — **not** automatically on every boot. `b2g-routing`'s own table, by
contrast, upserts on *every* boot (`boot-upsert.service.ts`, an `OnModuleInit` provider) — so a new
`b2g-routing` country reaches a running instance on its next restart, while a new `country-policy`
country needs an explicit reseed. (`TODO_ISSUES.md` already tracks the sharper edge of this: a
test helper that resets a database without reseeding will not pick up a new country-policy file.)

### 5. Write the tests

- **Loading is already tested for you** — a malformed or unsourced fact fails at import time, so
  any jest run touching that module already proves your file loads. There is no separate "does it
  parse" test to write.
- **Pin the content.** Add (or extend) that mechanism's `data/all.spec.ts` with an assertion on
  the *exact* values your file declares — not "a rule exists" but "this rule says `allowed: true`,
  `statuses: ['draft']`". The point is that a future edit to your JSON that silently changes
  behavior fails a named test, not that the test proves the legal claim is correct (only your own
  research does that).
- **If you touched a channel** (a new transport, a new `transportId` in `b2g-routing`/
  `channel-policy`), add or extend the transport's own `*.spec.ts`, and if credentials exist,
  a `*.live.spec.ts` gated by `liveDescribe` (see `providers/transmission/live-gate.ts` and
  `LIVE_TESTING.md`) — a green mocked suite proves nothing about whether the real endpoint accepts
  what you send.
- **If the country is user-facing** (a company can actually pick it), extend the relevant Cypress
  business scenario (`e2e/cypress/e2e/scenarios/full-lifecycle.cy.ts`, driven per-country via
  `CYPRESS_scenario=`) so the UI path is proven end-to-end, not just the data file in isolation.

## What NOT to do

- **Do not guess a status to fill a gap.** `"status": "required"` with no real citation is worse
  than `"status": "unverified"` with an honest note — the schema gate technically allows neither
  (a non-`unverified` status *requires* `legal` provenance), but human review should catch a
  citation stretched to sound more confident than the source actually is.
- **Do not stretch a citation to cover more than it says.** If a source establishes a channel
  exists but not that it's mandatory, that's `suggested`, not `mandated` — see `be.json`'s own
  channel-policy note for exactly this judgment call, made explicitly rather than rounded up.
- **Do not promote an `unverified` entry to `legal` without actually re-reading the primary
  source.** Reusing another file's *already-verified* citation for the same fact (e.g. an EU
  regulation that applies identically to every member state) is fine and should say so plainly;
  inventing a `sourceCheckedAt` for a text you didn't re-open is not.
- **Do not invent a new correction-route ID**, a new tax `kind`, or a new provenance `kind` — all
  three vocabularies are closed by their own schema, deliberately, so no business code ever has to
  special-case a spelling only one country's file uses.
- **Do not merge two different concerns into one file** because they happen to be about the same
  country — `country-policy` (which actions run) and `channel-policy` (which channel a seller's
  country requires) are read by different code for different questions and must stay that way,
  even for a country that has both.

## When a country needs more than a file

Some countries genuinely need code, not just data:

- **A national transmission channel this repo doesn't talk to yet** (a new `transportId` like
  `ksef` or `pdp`) needs a new transport under `transports/` implementing the actual protocol —
  the data files only ever *reference* a `transportId`/`formatSyntax`; they never validate that it
  resolves to something real (`b2g-routing/schema.ts`'s own comment on why `transportId` is
  deliberately not checked against the live registry at load time — sending refuses, loudly,
  naming exactly the missing channel, rather than the file failing to load).
- **A required national CIUS/format variant this repo doesn't vendor** (e.g. Peppol's own
  country-specific extensions for Poland's PEF, or most of the 13 EU countries `B2G_COVERAGE.md`
  documents as "read but not shipped") needs that schema vendored under `formats/vendored/` and a
  real format provider built against it — never a generic Peppol BIS payload asserted to satisfy a
  CIUS it was never validated against. This is exactly why `b2g-routing/data/pl.json` chose KSeF
  over PEF: PEF's Polish extension isn't vendored here, so routing to it would claim a format this
  repo cannot actually build.
- **A new document field only one country's law gives meaning to** needs a `country-fields`
  overlay (`add`/`modify`/`remove` on the trunk shape), not a change to the trunk descriptor
  itself — see `country-fields/data/fr.json`'s `supplyType` addition, which exists only to let
  France's own BT-23 content requirement derive a value.

## Two real files worth reading end to end

- **`b2g-routing/data/pl.json`** — a decision made by actually reading two official sources
  (the EU Commission's own Poland factsheet *and* the Polish Ministry of Finance's KSeF portal),
  which turned up **two** viable B2G channels (KSeF and PEF) and chose the one this repo can
  actually deliver — not the one that looked more "European". Read its `notes` field for the full
  reasoning: this is what "tranchée par la lecture, pas la plus évidente" looks like in a real
  file.
- **`country-policy/data/mx.json`** — 20 of its 22 rules are `unverified`, each with a specific,
  useful resolution note. This is not an unfinished file to be ashamed of; it is exactly what
  honest, partial research looks like in this format, and it is just as loadable and just as
  enforced as a fully-`legal` file.

## Seeing the result

Once your file is registered, rebuild the docs (`npm run build` or `npm run start` in
`documentation/` — the [country matrix](./country-support/index.md) regenerates automatically as
a `prebuild`/`prestart` step, straight from the files you just wrote) to see exactly what the
matrix and your country's own page now say. If it doesn't say what you expect, the data — not the
generator — is almost certainly the thing to fix.
