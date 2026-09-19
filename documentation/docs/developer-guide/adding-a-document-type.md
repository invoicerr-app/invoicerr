---
sidebar_position: 6.5
---

# Adding a document type

A **document type** is the other half of this codebase's "no business code names a thing" thesis
— see [Extending Invoicerr](./extending-invoicerr.md) if you haven't read it yet. Where a
**country** is a folder of JSON files (see [Adding a country](./adding-a-country.md)), a
**document type** is a single TypeScript file — a *descriptor* — that describes one kind of paper
a business creates: a quote, an invoice, a credit note, an expense, a received invoice. This page
has the same two-part shape as every other guide here: Part 1 for a first-time reader, Part 2 for
the person about to actually write one.

## Part 1 — In plain words

**A document type is a description, not a program.** Open
`backend/src/modules/documents/descriptors/expense.descriptor.ts` and you'll find a single object:
"an expense has these fields (a description, an amount, a currency, a date, some notes), these
buttons ('save', 'delete'), and it only ever has one status ('draft')." Nothing in that file draws
a form, builds a list screen, or talks to a database — the rest of the app (the edit form, the list
of expenses, the dashboard widget) is *generic* code that reads this description and builds itself
from it. Adding a sixth document type — say, a "purchase order" — means writing one more file like
this one, not designing a new screen from scratch.

**Every document, whatever its type, lives in the exact same place.** There is no separate
database table for quotes, another for invoices, another for expenses. There is one single table
("DocumentInstance"), and every row in it just carries a small tag saying which type it is (an
invoice's row says `typeId: "invoice"`, an expense's says `typeId: "expense"`) plus a bag of its
own field values. Adding a new document type never means "build a new filing cabinet" — it's one
more label in the cabinet that's already there, and — critically — it never needs a database
migration.

**Buttons ("actions") on a document can be in one of four honest states**, exactly the same four
the [country guide](./adding-a-country.md#the-four-gates--what-happens-when-you-actually-try-to-run-an-action)
describes for a country's own rules — because they are, in fact, the exact same mechanism: a
country can forbid an action outright, the document's own current state can make an action
unavailable right now, the action can be declared but not actually built yet (an honest "not
implemented", never a fake success), or what you typed can simply not fit what's expected. A new
document type gets all four of these checks *for free*, automatically, the moment it's registered
— nobody writing a new type has to reimplement any of that.

## Part 2 — The details

### The descriptor — the whole contract, as data

`descriptors/types.ts`'s `DocumentTypeDescriptor` interface is the complete shape (read the file
itself — every field carries a paragraph explaining exactly why it exists; what follows is the
summary):

```ts
interface DocumentTypeDescriptor {
  id: string;                          // e.g. "expense" — the registry key and the API/URL segment
  label: string;                       // plain text, not an i18n key (see below)
  fields: DocumentFieldDescriptor[];    // the document's own data
  actions: DocumentActionDescriptor[];  // the buttons this type offers
  statuses?: DocumentStatusDescriptor[];// the whole lifecycle — omit to opt out entirely
  initialStatus?: string;               // which status a brand-new record starts at
  numbering?: { onEnterStatus: string };// which status hands out a sequential display number
  email?: { subject: string; body: string }; // this type's default email template
  contributions?: WidgetLocation[];     // 'dashboard' | 'statistics' — opts into aggregation screens
  listItem?: { titleFields?: string[]; secondaryFields?: string[] }; // how a generic list card reads it
  usesLegalMentions?: boolean;          // opts into the country-mandated-mentions block on the PDF
}
```

A **field** (`DocumentFieldDescriptor`) is `{ key, kind, label, required?, ... }`, where `kind` is
one of the ten `CORE_FIELD_KINDS` (`text`, `longText`, `number`, `money`, `date`, `boolean`,
`select`, `reference`, `array`, `rowSelection`) or a plugin-registered one (always prefixed, e.g.
`"plugin:acme.rating"`, so a future core kind can never collide with a third party's). The same
`kind` selects both how the backend validates the value (`FieldKindRegistry`) and how the frontend
renders it — a document type never hand-rolls either. Everything past `key`/`kind`/`label` is an
*optional, kind-specific hint*: `currency`/`currencyField` for `money`, `options`/`allowCustomValue`
for `select`, `entity`/`entities` for `reference`, `fields`/`min`/`max` for `array`, and so on —
see `types.ts` itself for the full, richly-commented list; a type only sets the hints its own
fields' kinds actually use.

An **action** (`DocumentActionDescriptor`) is `{ id, label, availableWhen, params?, transitions? }`.
`availableWhen` is either `'always'` or an array of statuses the action is offered from.
`transitions` — when the action actually changes the acted-upon record's own status — is the
*single source of truth* for that effect: `availableWhen` is then *derived* from it
(`transitionsAvailableWhen(transitions)`, `lifecycle.ts`) rather than hand-typed a second time, and
`validateLifecycle` (run the moment a descriptor is registered, see below) re-derives it
independently to catch a drift. An action that changes a **different** record entirely (e.g.
"convert-to-invoice" writes a fresh invoice; "duplicate" writes a fresh copy) or has no
implementation yet to observe declares no `transitions` at all — `availableWhen` then stays the
sole, hand-declared fact about when it may run, exactly as it always did before `transitions`
existed.

Labels (`label`, action `label`, status `label`) are **plain text, not i18n keys** — a descriptor
is data a third-party plugin can ship in any language it likes, so it is rendered verbatim by the
frontend rather than looked up through `t()`, the one deliberate exception to this codebase's
usual `t()`-everywhere rule for user-facing strings.

### One table for every type — `DocumentInstance`

```prisma
model DocumentInstance {
  id            String   @id @default(cuid())
  companyId     String
  typeId        String   // "invoice", "expense", a plugin's own id — never a Prisma enum
  status        String   @default("draft")
  data          Json     // every field value, keyed by DocumentFieldDescriptor.key
  number        Int?
  displayNumber String?
  lastActionError String?
  transportRef    String?
  // ...
}
```

Every document type — core or third-party — is a row in this ONE table, distinguished only by
`typeId`. This is *why* adding a type needs no Prisma migration: there is no per-type schema to
extend, only a new descriptor and, usually, a new set of `data` keys nobody else uses. `number`/
`displayNumber` are set exactly once, the first time a record's status matches the type's own
declared `numbering.onEnterStatus` — a type that never declares `numbering` (e.g. "expense") never
sets them at all, on any record.

### Registering the type — one line

```ts
// documents-core.module.ts
function buildDocumentTypeRegistry(): DocumentTypeRegistry {
  const registry = new DocumentTypeRegistry();
  registry.register(buildQuoteDescriptor());
  registry.register(buildInvoiceDescriptor());
  registry.register(buildCreditNoteDescriptor());
  registry.register(buildExpenseDescriptor());
  registry.register(buildReceivedInvoiceDescriptor()); // ← adding a type is exactly this one line
  return registry;
}
```

`DocumentTypeRegistry.register()` (`descriptors/type-registry.ts`) does two things, synchronously,
the instant it runs — at real app boot, or the moment a jest spec calls it directly:

1. Refuses a duplicate `id` (`Error`, not an HTTP exception — this registry has to stay usable
   outside an HTTP request).
2. Calls `validateLifecycle(descriptor)` (`lifecycle.ts`) — a broken `statuses`/`initialStatus`/
   `transitions` declaration fails registration immediately, which for the real app means the
   backend never finishes booting, and for a test means the `.register()` call itself throws. There
   is no "the type loaded, but its lifecycle is silently broken" state to reach production.

### Wiring the buttons — the `ActionRegistry`

A descriptor only *declares* an action exists; something still has to say what running it actually
does. That's a second, independent registry (`actions/action-registry.ts`), wired in the same
module:

```ts
function buildActionRegistry(/* deps */): ActionRegistry {
  const registry = new ActionRegistry();
  registerExpenseActions(registry, webhookDispatcher); // registerSaveDraftAction + registerDeleteAction
  // ...
  return registry;
}
```

For the common cases (`save-draft`, `delete`), `actions/generic-actions.ts` already has a
type-agnostic implementation — `registerSaveDraftAction(registry, typeId, webhooks?)` and
`registerDeleteAction(registry, typeId, webhooks?)` cover any type whose handler doesn't need to
read a single field of `data`. A type whose behavior genuinely depends on country/channel/settlement
logic (the invoice's own "send") needs its own `<type>-actions.ts` with a bespoke `ActionHandler` —
`invoice-actions.ts` is the template to read for that shape. An action declared on the descriptor
with **no** handler registered here is not a bug: `DocumentsService.runAction` turns that into the
501 gate below, on purpose — the deliberate, honest state for e.g. "convert-to-invoice" until an
invoicing pipeline exists to back it.

### The four gates — inherited automatically

Every action of every document type — core or third-party — runs through the exact same
`DocumentsService.runAction` (`documents.service.ts`), in the exact same order, described in full
in [Adding a country](./adding-a-country.md#the-four-gates--what-happens-when-you-actually-try-to-run-an-action):
country policy (403) → status (409) → implementation (501) → validation (400). A document type
author never reimplements any of this — it is generic over `typeId`. The only thing a new type's
own `country-policy/data/*.json` files need to add is a `documentTypes` entry naming the new type
and `rules` for each of its actions (see that guide); until a country's file says so, EVERY action
of a brand-new type is refused for it, loudly, by the same "no permissive fallback" rule that
already governs every existing type.

### Composing with countries, without naming one

A document type descriptor never mentions a country. Three separate, optional mechanisms let a
country still shape a type without either one naming the other:

- **`country-fields/data/<cc>.json`** can `add`/`modify`/`remove` a FIELD on an existing type's
  shape for one country (`country-fields/data/fr.json`'s `invoice.lines[].supplyType` is the
  worked example) — the type's own descriptor stays the trunk shape every country starts from.
- **`usesLegalMentions: true`** opts a type into the country-mandated-mentions block on its
  rendered PDF (`mentions/`) — only `invoice.descriptor.ts` sets it today, since "expense" has no
  `issueDate` field for a mention to hang off and a third-party type may have no reason to.
- **`country-policy/data/<cc>.json`** decides, per country, which of the type's own declared
  actions are even offered — the type itself has no opinion on this; see
  [Adding a country](./adding-a-country.md).

### A worked example — reading `expense.descriptor.ts` end to end

`descriptors/expense.descriptor.ts` is the shortest real type in this codebase and a good template
for a type with no transmission and no per-country nuance:

- **One status** (`"draft"`) — `initialStatus: "draft"`, and `"save-draft"`'s own `transitions`
  are `[{ from: 'always', to: 'draft' }]` (an expense never leaves "draft").
- **Two actions**: `"save-draft"` (via `registerSaveDraftAction`, generic) and `"delete"` (via
  `registerDeleteAction`, generic) — restricted to `availableWhen: ['draft']` since a never-saved
  record has nothing to delete yet.
- **No `numbering`** — nothing about an internal bookkeeping entry needs a sequential display
  number the way an issued invoice does.
- **`contributions: ['dashboard', 'statistics']`** — see `contributions/expense-contributions.ts`
  for the actual widget code (registered separately, exactly like an action's handler).
- **`listItem: { titleFields: ['description'], secondaryFields: ['amount', 'date'] }`** — an
  expense has no client or source document to lead a card with, so its own required, human-written
  `description` is the title instead.

### Testing

- **Registering a broken lifecycle already fails loudly** — `type-registry.spec.ts`/
  `lifecycle.spec.ts` cover the mechanism itself; your own new type doesn't need a separate "does it
  load" test, since `DocumentTypeRegistry.register()` already proves it the moment any spec (or the
  real app) registers it.
- **Give the type its own `<type>.descriptor.spec.ts`** pinning the exact fields/actions/statuses
  it declares — a future edit that silently drops a field or changes an `availableWhen` should fail
  a named test, the same discipline `adding-a-country.md`'s own "pin the content" advice holds for
  a country's JSON.
- **If the type has bespoke action handlers**, test them the way `invoice-actions.spec.ts` tests
  `invoice-actions.ts` — including, if any handler is country/channel-aware, a case per relevant
  country.
- **If the type is user-facing**, extend the relevant Cypress spec so the whole path (form → save →
  action) is proven through the actual UI, not just the descriptor in isolation.
