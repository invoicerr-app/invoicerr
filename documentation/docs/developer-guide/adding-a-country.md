---
sidebar_position: 6
---

# Adding a country

The `documents` module (`backend/src/modules/documents/`) never asks "what country is this?" in
business code — no `if (country === 'FR')` anywhere in a controller, a service, or an action
handler. Instead, about ten small, independent catalogs each answer one narrow question about a
country, as **data**: a JSON file per country, discovered and loaded automatically at boot. Adding
a country means adding a file, almost never a line of code.

This page has the same two-part shape as every [country's own page](./country-support/index.md):
**Part 1** is for anyone who has never opened this codebase before — read it if you just want to
understand what "a country is data" actually means. **Part 2** is the step-by-step reference for
actually writing the file — read it when you're the one adding France's neighbour. For the
generated *result* — what each of the five covered countries currently gets, read live from these
same files — see the [country compliance matrix](./country-support/index.md); that page is rebuilt
from the files this guide tells you how to write, every time the docs are built, so it can never
say something these files don't.

For adding a new *kind of document* (an invoice, a quote, something else entirely) rather than a
new country, see [Adding a document type](./adding-a-document-type.md) instead — the two are
deliberately independent axes; see the [overview](./extending-invoicerr.md) for how they fit
together.

## Part 1 — In plain words

**A country, in this app, is a folder of small text files — not a piece of code.** If you open
`backend/src/modules/documents/country-policy/data/`, you'll find files named `fr.json`,
`de.json`, `it.json`, and so on. Each one is a plain list of facts about one country: "can a French
company send an invoice by email? yes." "Does Poland require a specific numbered format? yes, and
here's the rule." Nobody writes a special case in the actual program for France or Poland — the
program is *identical* for every country; only these fact-files differ. Adding a new country to
one of these lists means writing one more file like the others, in the same folder, and — for
almost all of them — nothing else at all: no line of code, no table to edit, no button to press.
The app itself notices the new file the next time it starts (an "auto-discovery" list, not a
maintained one).

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

There is no third option, and no silent default. Every schema in this module enforces this at
**load time** (`assertValidProvenance` and its per-module siblings, called from that mechanism's
own `data/all.ts`): a JSON file with no `provenance`, or a `legal` claim with no `sourceText`,
fails to load — which for `country-policy`/`b2g-routing`/etc. means **the whole backend fails to
boot**, and for tests it means every jest run fails immediately. This is deliberate: a rule
without a citation must never be one accidental commit away from looking exactly like a rule
that has one.

`unverified` is an honest, first-class state — not a lesser one. A country file made entirely of
well-written `unverified` entries, each naming exactly what research would settle it, is a *good*
file: it tells the next person precisely where to start. Compare `country-policy/data/pt.json`
(3 of its 23 rules sourced to a real legal citation today, the rest honestly `unverified`, each
with a specific resolution note) to `correction-routes/data/fr.json`'s `CREDIT_NOTE` route (a
`legal` entry quoting BOFiP directly). Both are equally valid shapes for this format; they just
represent different amounts of finished research.

Absence is a *refusal*, never a default. A country with no `country-policy/data/xx.json` file
doesn't get "reasonable defaults" — every document action is blocked for it, loudly, naming the
missing file (`country-policy.ts`'s own "no permissive fallback, no silent gap" rule). A country
with no `b2g-routing/data/xx.json` gets an honest "no B2G rule declared for XX", never a silent
fallback to a generic B2B channel. If you ship a file that is *sparse* rather than *absent* (e.g.
`correction-routes/`, whose schema requires all eleven routes to be present, most of them
`unverified`), that sparseness must be spelled out fact-by-fact, never implied by a missing key.

### The mechanisms — a map

Each is independent: none of them read each other's files, and a country can have some without
having others. Of the five countries this product covers today (FR, DE, IT, PL, PT — see
`TODO_ISSUES.md` for the history of the prune down to these five), none has a file in every single
mechanism — see the [country compliance matrix](./country-support/index.md) for exactly which ones
are still open per country, and each country's own "Not yet configured" callouts for why that's an
honest gap rather than a guess.

| Mechanism | Directory | Answers | Mirrored to a DB table? |
| --- | --- | --- | --- |
| Document-action policy | `country-policy/data/` | Which document **actions** (send, save-draft, …) a company of this country may run, and under what status restriction. | Yes — auto-corrected on **every boot**, in every environment (see "Boot-time self-correction" below), plus `prisma/seed.ts` on an explicit migrate/seed. |
| B2G routing | `b2g-routing/data/` | When this country is the **government client's** country: which transport + format, which client identifiers/document fields it needs. | Yes — `boot-upsert.ts`, unconditionally re-upserted on **every** backend boot (`OnModuleInit`). |
| Correction routes | `correction-routes/data/` | For each of the 11 canonical correction routes (credit note, corrective invoice, cancel-and-replace, …), is it `required`/`allowed`/`forbidden`/`unverified` for this country. | No — read live from the file. |
| Local cancel (derived) | `correction-routes/cancel-policy.ts` | Whether *this app* can actually realize `CANCEL_AND_REPLACE` locally for this country (a whitelist cross-checked against the correction-routes data above). | No — pure function over the file above. |
| Channel policy | `transports/channel-policy/data/` | For a company **established** in this country: is a given transmission channel merely usual (`suggested`) or legally required from a date (`mandated`)? | No — read live from the file. |
| Tax system | `tax/tax-systems/data/` | What the cross-border tax engine assumes about this country's rate structure (VAT/GST/SALES_TAX/NONE, standard rate). | No — read live from the file. |
| Country identifiers | `country-identifiers/data/` | Which national identifier schemes (SIRET, EIN, VAT number, …) a party of this country must supply. | Yes — auto-corrected on **every boot**, same mechanism as document-action policy (see below), plus `prisma/seed.ts`. |
| Country field overlay | `country-fields/data/` | Adds/modifies/removes a **field** on an existing document type's shape for this country. | No — read live from the file. **The one exception to auto-discovery** — see "Register the file" below. |
| Mandatory mentions | `mentions/data/` | Free-text legal mentions (BG-1) this country requires on every invoice, temporal. | No — read live from the file. |
| Content requirements | `content-requirements/data/` | Whether a specific EN 16931 field (e.g. BT-23) must carry a country-derived value from a date. | No — read live from the file. |
| VAT rate catalog | `vat-rates/data/` | The rate **ladder** a user picks from on one invoice line (presentation data, not a tax computation). | No — read live from the file. |

You will rarely need all of these for a new country. A country whose only need is "let the OSS tax
engine compute a destination rate for it" needs *only* `tax/tax-systems/data/xx.json` — see
`tax/tax-systems/data/all.ts`'s own header for the EU member states added purely for that reason.

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

`correction-routes/data/*.json` additionally transcribes from `documentation/internal/CORRECTION-ROUTES.yaml`
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
  `documentation/internal/CORRECTION-ROUTES.yaml` first, not a new value in this schema.
- `transports/channel-policy/data/<cc>.json`'s `requirement: "mandated"` **requires** `legal`
  provenance and a `mandatedFrom` date — the schema throws at load if you mark something mandated
  on an `unverified` claim. If you're not yet confident the channel is genuinely *required* rather
  than merely usual, stay `suggested` — see `it.json`/`pl.json`'s own `suggested` entries, both
  still `unverified` today but honestly so; the mandate mechanism is binary (mandated or
  suggested) and has no way to encode a conditional or partial exception.
- `content-requirements/data/<cc>.json` facts are **always** `legal` — there is no `unverified`
  escape hatch for a content requirement; if you can't source it yet, don't ship it.
- `tax/tax-systems/data/<cc>.json` may omit `standardRate` for a VAT/GST country **if**
  `vat-rates/data/<cc>.json` already has a `STANDARD`-category entry — it's derived from there
  rather than duplicated (see `tax/tax-systems/schema.ts`'s own "DELIBERATE NON-DUPLICATION").

### 4. Register the file — almost always a no-op

For **every mechanism above except `country-fields`**, this step doesn't exist: each `data/all.ts`
loader calls its own `discoverCountryCodes()`, which does an `fs.readdirSync` on that mechanism's
own `data/` directory, keeps whatever matches `/^[a-z]{2}\.json$/` (a lowercase two-letter code
plus `.json` — nothing else in that folder matches, including this `all.ts` file itself and any
`xx.spec.ts` sitting next to it), sorts the result for a deterministic load order, and loads every
one of them. Drop `data/hu.json` into `country-policy/`, restart the backend (or run the test
suite), and it is loaded — there is no array to add a line to, and no second file anywhere in the
codebase that also needs to know Hungary now exists. Removing a country is the same, in reverse:
delete the file and it stops loading, no dangling entry to clean up.

**The one exception: `country-fields/data/all.ts`.** It still reads a small, hand-maintained
`COUNTRY_FILES: readonly string[]` array (`['fr', 'de']` today) rather than discovering its
directory — this mechanism has shipped so few real overlays so far (two fields, both on the
`invoice` type — France's line-level `supplyType`, Germany's document-level `buyerReference` — for
two countries total) that nobody has yet ported it to the same discovery pattern every sibling
mechanism uses. If you add a `country-fields/data/xx.json`, you must also add `'xx'` to that array
— check the file's own header before assuming otherwise, since this is the one place in this whole
module where "drop a file and it just works" does not (yet) hold.

### Boot-time self-correction — you don't reseed by hand

Two of the eleven mechanisms above also mirror their data into a Postgres table (read at request
time from the DB, not from the JSON files directly) — `DocumentCountryActionRule`
(`country-policy`) and `CountryIdentifierRequirement` (`country-identifiers`). Historically, that
mirror was only refreshed by `prisma/seed.ts`, which runs on `migrate dev`/`migrate reset`/an
explicit `db seed` — **not** on an ordinary restart of an already-migrated database, which is
exactly the gap that let a JSON-only edit silently 403 every document action until someone
remembered to reseed by hand (`TODO_ISSUES.md`'s own "`resetAndSeed` ne re-sème pas la politique
pays" note).

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

Practically: edit any `country-policy/data/*.json` or `country-identifiers/data/*.json` file,
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
   this action's `country-policy/data/<cc>.json` rule. No file for this country at all, or a rule
   that exists but says `allowed: false`, throws `ForbiddenException`, naming the country and
   exactly what would unblock it.
2. **409 — status.** Two independent checks land on this same code, never a second 403: the
   descriptor's own `availableWhen` (is this action even offered for a document in its current
   state?), and the country policy's own PER-STATUS narrowing (`DocumentActionRuleFact.statuses`
   — e.g. Poland's `invoice.save-draft`, restricted to `draft`, reflecting KSeF's real immutability
   once an invoice has been cleared).
3. **501 — implementation.** The action is declared on the descriptor and allowed by every check
   above, but nobody has registered an `ActionHandler` for it in the `ActionRegistry` yet (e.g.
   "convert-to-invoice" until an invoicing pipeline existed to back it, or a channel a B2G rule
   names — `chorus-pro`, `zre-ozgre` — before this repo's own transport for it is built).
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
  `b2g-routing/data/pl.json` chose KSeF over the Peppol-based PEF platform whose Polish-specific
  extension this repo does not vendor; see that file's own header for why.
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
- **`b2g-routing/data/de.json`** — the opposite journey on the SAME axis: reading the actual German
  federal text (§ 4 ERechV) turned up a channel this repo did not implement at all
  (`zre-ozgre`), so sending was correctly BLOCKED, by name, rather than silently routed to email —
  until a later, dated addendum in the same file's `notes` documents a second, independent reading
  (the ZRE/OZG-RE platforms' own FAQ) that found Peppol had since become an accepted channel, and a
  real live send proved it end to end. The file's own history is the proof that "blocked, honestly"
  is a legitimate, temporary state — not a bug to paper over with a guess.
- **`country-policy/data/pt.json`** — 20 of its 23 rules are `unverified`, each with a specific,
  useful resolution note. This is not an unfinished file to be ashamed of; it is exactly what
  honest, partial research looks like in this format, and it is just as loadable and just as
  enforced as a fully-`legal` file.

## Seeing the result

Once your file is in place, rebuild the docs (`npm run build` or `npm run start` in
`documentation/` — the [country matrix](./country-support/index.md) regenerates automatically as
a `prebuild`/`prestart` step, straight from the files you just wrote) to see exactly what the
matrix, your country's own page, and its "Not yet configured" callouts now say. If it doesn't say
what you expect, the data — not the generator — is almost certainly the thing to fix.
