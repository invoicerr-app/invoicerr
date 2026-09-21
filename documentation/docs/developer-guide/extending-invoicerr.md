---
sidebar_position: 5.5
---

# Extending Invoicerr

Two, and only two, questions decide how something new gets added to this codebase — and they are
answered in two completely different ways, deliberately kept apart:

|  | "What can a **country**'s law say about a document?" | "What **kind** of document is this?" |
| --- | --- | --- |
| Answered by | **Data** — a JSON file per country, per mechanism | **A descriptor** — one TypeScript object per type |
| Lives in | `backend/src/modules/documents/*/data/<cc>.json` | `backend/src/modules/documents/descriptors/<type>.descriptor.ts` |
| Adding one needs | A new file (almost always nothing else — see below) | A new file plus one line of registration |
| Guide | [Adding a country](./adding-a-country.md) | [Adding a document type](./adding-a-document-type.md) |
| Generated reference | The [country compliance matrix](./country-support/index.md) | — (read the descriptor files themselves) |

## Part 1 — In plain words

Picture this app's core as a grid: one axis is **what you're creating** (a quote? an invoice? an
expense?), the other is **which country's rules apply to it** (France? Poland? Portugal?). Neither
axis knows the other exists. A document type never says "if this is a French invoice, do X" — it
just describes its own fields and buttons, the same way for every country. A country's rules never
say "for an invoice specifically" in code — they just say, as plain data, "this document type/
action combination is allowed here" or "here's what a French identifier must look like." The app
combines the two grids at the moment someone actually clicks a button, and only then.

This is why adding a country is *never* a code change (almost always just a new file — see
[Adding a country](./adding-a-country.md)), and adding a document type is a *small*, one-time code
change ([Adding a document type](./adding-a-document-type.md)) that, once done, immediately works
for every country that has ever been added and every one that ever will be. Neither axis has to be
touched to extend the other.

## Part 2 — The details

The governing rule, stated precisely: **no business code — no controller, no service, no action
handler — is ever allowed to write `if (country === 'FR')` or `if (typeId === 'invoice')` to decide
whether something is *permitted*.** A `typeId` switch is fine when it's genuinely about *shape*
(the frontend picking which field-renderer a `kind` needs); a country switch never belongs in code
at all. Two independent, composable layers make that possible:

- **The document-type layer** (`descriptors/`) describes the SHAPE of a document — its fields,
  its buttons ("actions"), its lifecycle (which statuses exist, which action moves it from one to
  another). Every document, whatever its type, is stored in the exact same `DocumentInstance`
  table, distinguished only by a `typeId` string column — never a per-type Prisma model, never a
  migration to add another type. See [Adding a document type](./adding-a-document-type.md).
- **The country layer** (ten-odd small mechanisms under `documents/*/data/`) describes FACTS about
  a jurisdiction: which actions its law allows, which correction routes exist, what identifiers a
  party needs, which channel it mandates, what its VAT rates are. None of these mechanisms knows
  what an "invoice" *is* structurally — they only ever reference a `typeId`/`actionId` as an
  opaque string key. See [Adding a country](./adding-a-country.md).

The two layers meet at exactly one place at request time: `DocumentsService.runAction`
(`documents.service.ts`), which resolves a document type's descriptor (layer one) and a country's
policy for that exact `(typeId, actionId)` pair (layer two), then runs the same four gates —
country policy (403), status (409), implementation (501), validation (400) — every single time,
for every type and every country, described in full in
[Adding a country](./adding-a-country.md#the-four-gates--what-happens-when-you-actually-try-to-run-an-action).
Neither layer's own code ever has to know the other exists for this to work.

A third, much smaller mechanism sits *between* the two layers without collapsing them:
`country-fields/` lets a country ADD, MODIFY, or REMOVE a field on an existing type's trunk shape
(e.g. France's own `invoice.lines[].supplyType`) — this is still data, still keyed by `(cc, typeId)`,
and it never changes what a document type IS, only what one country's version of it carries on top.

## Where to go next

- Adding a country's rules, or extending an existing country → [Adding a country](./adding-a-country.md).
- Adding a new kind of document (or an action on an existing one) → [Adding a document type](./adding-a-document-type.md).
- Seeing what the five covered countries currently get, generated straight from the data → the
  [country compliance matrix](./country-support/index.md).
- Adding a capability that isn't either of these two axes at all (a webhook event, a new field
  *kind*, an MCP tool) → [Extension Points](./plugin-system.md).
