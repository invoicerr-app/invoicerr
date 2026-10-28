---
sidebar_position: 15
---

# UI Conventions

Conventions the frontend (`frontend/src`) follows, so every screen behaves the same way.

## Visual system

The interface combines two directions. The shell, the document detail, settings, statuses, toasts and
confirmations follow **Registre**: a quiet ledger, flat, separated by hairlines, colour only on data
and on the one primary action. The dashboard, lists, editor, forms, sign-in and empty states follow
**Atelier**: the same product with a warmer voice, soft panels, and the paper sheet as its recurring
object. The two share one palette (Lagune), one type system and one set of tokens in
`frontend/src/index.css`.

### Type

- **Figtree** is the interface face (400 to 700). **Newsreader** sets page and section titles (`h1`,
  `h2`) and every amount, through the `amount` utility (tabular, lining figures). Both are
  self-hosted through Fontsource, so the PWA works offline.
- Body text is 15 px; `text-sm` is 14 px and `text-xs` 13 px. Labels are sentence case and never
  tracked capitals.
- A monospace face is kept for codes a person copies (API keys, IBAN), never for amounts or document
  numbers.

### Tokens

Use the tokens, never a raw colour. Besides the Lagune pairs (`background`, `card`, `primary`,
`muted`, `success`, `warning`, `info`, `destructive-soft` and their `-foreground`), the redesign adds:

| Token | Use |
| --- | --- |
| `ink-2` | Secondary text that must stay very readable |
| `sunken`, `raised` | Wells and hovered rows; popovers one step above a card |
| `link` | Text links (6:1 on a card) |
| `focus` | The one colour a focus indicator is drawn with (3:1 or more on every ground) |
| `input` | Control edges, 3:1 against a card (hairlines use `border`) |
| `paper-*` | A printed sheet: white with its own ink in both themes (`paper-sheet` utility) |
| `shadow-sheet`, `shadow-pop` | The only two shadows: panels, and popovers and dialogs |

Radii go by role: 6 px for controls (`rounded-md`), 8 px for popovers and dialogs (`rounded-lg`),
10 px for panels (`rounded-xl`). Buttons are 38 px high (32 px small), text fields and selects 42 px.

### Focus

Every focusable control shows a 2 px outline in `--focus`, 2 px away from it (`focus-ring` utility),
or hugging the field with its edge in the same colour for text fields (`focus-field`). Never remove
an outline without drawing this one.

### Status

A status is always a shape and a word, never a filled pill and never colour alone:
`components/ui/status-mark.tsx` renders it, `components/documents/status-presentation.ts` maps any
status id to a tone and a glyph.

| Glyph | Tone | Meaning |
| --- | --- | --- |
| Open circle | neutral | Not sent yet (draft), unpaid, unknown |
| Half disc | info | On its way (sent, deposited, imported) |
| Half disc | warning | Waiting on someone (sending, pending) |
| Check | success | Done and fine (approved, accepted, signed) |
| Disc | success | Paid, settled |
| Half disc | success | Partly paid |
| Triangle | destructive | Late |
| Circled cross | destructive | Rejected by the platform, refused by the buyer, failed |
| Cross, struck through | neutral | Cancelled |

Statuses are open data: an id the table does not know reads as neutral, never hidden.

### Layouts

- **Lists**: the toolbar sits on the page ground; rows live in panels (`rounded-xl border bg-card
  shadow-sheet`). A row leads with tinted initials (`InitialsAvatar`) and the name, then a muted
  line, then status, amount and one quiet action. Filters are a segmented control. The documents
  list groups consecutive rows by month of the type's own date field and keeps the sort the reader
  chose; it never prints a page-local total. On a phone a document row shows only the client, the
  number, the amount and one state (the settlement mark once it says more than unpaid, the status
  otherwise); every other control stays in the DOM, hidden, so a `data-cy` never moves. Initials carry
  the `initials` utility, which trims the text box to the capitals so they sit on the disc's optical
  centre in either face. A titled group of rows (projects, time entries, bank
  statements) uses `PanelSection` (`pages/(app)/_shared/data-list.tsx`): the title and its one action
  on the ground, the rows in one panel, a row skeleton while loading.
- **Type faces**: Figtree for the interface, Newsreader for titles and every amount (the `amount`
  utility: tabular, lining figures). Dates, counts and rates keep `tabular-nums` in the interface face;
  monospace is kept for what is typed or copied as a code (API keys, secrets, hashes, paths, patterns,
  identifiers).
- **Forms**: a large form shows all its sections on one page with `FormPageDialog`
  (`components/ui/form-page-dialog.tsx`): saving validates the whole form, scrolls to the first
  invalid section and focuses the field; closing a dirty form asks first. `presentation="page"`
  renders the same form as the content of a route instead of a modal: the new-document page
  (`pages/(app)/documents/[typeId]/new.tsx`) uses it, with a `preview` (a live paper sheet beside the
  form, behind an Edit / Preview switch on a phone) and the action bar held at the bottom. A section
  may set `foldOnPhone`. On a phone a filled line of a line-items field folds into a one-line summary.
  Short controls sit two to a row.
- **Reading a document**: an issued document is shown as a flat sheet (`DocumentPaper`), generic
  from the descriptor, with the double rule under its total, every field still listed below it.
- **Empty states** draw a sheet and a pencil from tokens, with the place's own icon in a disc; a
  failed load shows a warning disc and a retry. A page that fails to render shows its title, an
  explanation and a reload button, with the technical message folded behind **Details**.
- **Phone**: a bottom tab bar holds the dashboard, documents and clients, "More" opens the full
  sidebar; there is no menu button in the header. The main "New" action becomes an extended floating
  button. The new-document page hides the tab bar: it has its own close button and action bar. Touch
  targets stay 44 px.
- **Offline**: `OfflineBanner` (`components/offline-banner.tsx`) shows a one-line strip above every
  signed-in page while the browser reports no network.

### Document type icons

Every document type has its own icon, drawn wherever the type is named: the sidebar, the page
header of its list and of a document, its empty list, the dashboard widgets it contributes and the
phone's tab bar. The descriptor carries a key (`icon: 'purchase-order'`), and
`components/documents/document-type-icon.tsx` maps keys to Lucide icons in one table, so no
component switches on a type id. A key that table does not know, or no key at all, draws the
generic document icon. To give a new type its own icon, add its key to the descriptor and one row
to that table; pick a Lucide icon that still reads apart from the others at 16 px.

| Key | Icon |
| --- | --- |
| `quote` | `FilePen` |
| `invoice` | `ReceiptText` |
| `credit-note` | `FileMinus` |
| `debit-note` | `FilePlus` |
| `pro-forma` | `FileClock` |
| `deposit-invoice` | `Coins` |
| `final-invoice` | `FileCheck` |
| `purchase-order` | `ShoppingCart` |
| `goods-receipt` | `PackageCheck` |
| `delivery-note` | `Truck` |
| `expense` | `Wallet` |
| `received-invoice` | `FileDown` |
| anything else | `FileText` |

### Motion

Buttons scale to 0.97 for 120 ms when pressed (`press` utility); popovers and dialogs fade and grow
from 0.97 over 150 ms. Nothing animates on page load, on typing or on row selection, and
`prefers-reduced-motion` turns every transition off. Never `transition: all`, never animate a width or
a height.

### Never

- No tracked uppercase labels or eyebrows, no middle-dot meta strings.
- No grid of identical cards, no card inside a card, no coloured side stripe on a card or a row.
- No gradient text or wash, no glass, no emoji or unicode character used as an icon.
- No shadow other than the two tokens, no colour as the only carrier of a status.
- No placeholder-only label, no exclamation mark in copy, no amount without tabular figures.
- No second green: green means success, and only that.

## Field labels and descriptions

A field's label reads `Name *` when the field is required. When the field has a description, a
small `?` follows the label: hovering, tapping or keyboard-focusing it opens the description in a
popover, and tapping elsewhere or pressing Escape closes it. Nothing is printed under the field
except a validation error.

Inside a react-hook-form `FormItem`, pass the description to `FormLabel`. It is wired to the input
with `aria-describedby`, and `FormMessage` still renders errors under the field:

```tsx
<FormItem>
  <FormLabel required description={t("settings.company.form.iban.description")}>
    {t("settings.company.form.iban.label")}
  </FormLabel>
  <FormControl>
    <Input {...field} />
  </FormControl>
  <FormMessage />
</FormItem>
```

Outside a form, use `FieldLabel` from `@/components/ui/field-help`. The description id is derived
from `htmlFor`, so point the input at `fieldHelpId(id)`:

```tsx
<FieldLabel htmlFor="pattern" description={t("settings.declareLastNumber.patternHint")}>
  {t("settings.declareLastNumber.pattern")}
</FieldLabel>
<Input id="pattern" aria-describedby={fieldHelpId("pattern")} />
```

### Locked fields

A field disabled by a business rule, such as a credit note's currency once it follows the linked
invoice, shows a red lock after its label. Hovering, tapping or keyboard-focusing the lock opens the
reason, with the same behaviour as the `?`: a short close delay so the pointer can reach the text,
Escape and a tap elsewhere close it. The lock carries only the reason; the `?` keeps the field's
ordinary description. Screen readers name the lock button after the field, as in "Why is Currency locked?".

Pass the reason to `FormLabel` with `lockReason`, and disable the control yourself. `FormControl`
adds the reason to the input's `aria-describedby`, after the description:

```tsx
<FormLabel lockReason={isLocked ? t("documents.form.select.lockedFromReference") : undefined}>
  {field.label}
</FormLabel>
<FormControl>
  <SearchSelect disabled={isLocked} {...props} />
</FormControl>
```

Outside a form, `FieldLabel` takes the same `lockReason` and derives the id from `htmlFor`; point the
input at `fieldLockId(id)`. A control without a field label, such as a radio inside a row, can place
`FieldLock` next to its own label and point the control at the same id.

### Custom controls

`FormControl` passes `id`, `aria-describedby` and `aria-invalid` to its direct child. A custom control
placed inside it must forward those three props to its focusable element, or the label and the
description reach nothing. For a Radix `Select`, put `FormControl` around the `SelectTrigger`, not
around the `Select`. When a field is made of several inputs, such as a file picker or a checklist,
use `FormGroup` in place of `FormControl`: it renders a `role="group"` container named by the label
and described by the help.

:::warning[Enforced in CI]
`src/components/ui/field-help.guard.spec.ts` fails the frontend unit tests when a description is
rendered under a field again: the removed `FormDescription` component, or muted helper text
(`text-muted-foreground`) placed right after a control, a label, or anywhere in a `FormItem` outside
its `FormControl`. The only muted lines allowed next to a control report live state, carry
`role="status"`, and are named by their `data-cy` in the guard's allow-list. A lock reason printed
next to a control is flagged in any colour: a text element whose key, variable or `data-cy` names a
lock belongs behind the label's lock instead.
:::

## Explanations and warnings

Explanatory prose is never printed in full on a screen. A block that explains something, such as the
legal basis of an archive's retention date, the statute quote behind a channel obligation, what a
correction route means or what a settings section does, shows its title followed by the same `?` as a
field description, and the text opens on hover, keyboard focus and tap. This covers text the server
composes (tax warnings, settlement and line-total warnings, retention citations, source quotes,
disclaimers, blocked reasons) as much as long texts written in the locale files.

A warning that asks the user to act keeps a one-line visible status: a warning icon and a short title
in the warning colour that says what to check, with the long explanation behind its `?`. A pure
explanation shows its title in the muted colour. Use `ProseHelp` from `@/components/ui/prose-help`,
which wraps the field help popover. An array of texts opens as one paragraph each, and empty texts
show no `?` at all:

```tsx
<ProseHelp tone="warning" title={t("documents.totals.taxWarningsTitle")} dataCy="document-tax-warnings">
  {warnings}
</ProseHelp>

<ProseHelp title={t("documents.archive.retainUntil", { date })} dataCy="document-archive-retention">
  {archive.retentionBasis}
</ProseHelp>
```

A settings page, section or field group takes the long text through its `help` prop instead of
`description`; `description` stays for one short line:

```tsx
<SettingsSection title={t("settings.company.approval.title")} help={t("settings.company.approval.description")}>
```

An action blocked by a country rule keeps its button disabled. Under the button, `BlockedActionReason`
shows the status "Blocked by your country's rules" with the rule behind its `?`; in a list row, a
`FieldLock` next to the button carries the rule. A disabled button never shows a tooltip, so a reason
placed only in `tooltip` is never seen.

The `?` button is described by the full text (`aria-describedby`), so a screen reader announces it on
focus without opening the popover. The popover is named after its button and is focusable: when its
text is taller than the space it has, it fades at the bottom, scrolls with the wheel or a swipe, and the
arrow and page keys scroll it while the `?` has focus. Text composed on the server for these blocks
uses commas, colons and full stops rather than em dashes; quoted statute text keeps its original
punctuation.

Visible on purpose: a short status line that is the information itself, such as the exchange rate a
dashboard total was converted at, or "Line 3 has no usable VAT rate, counted in net only", and the text
a user must read before an irreversible action, such as the danger zone's reset and delete
confirmations.

:::warning[Enforced in CI]
`src/components/ui/prose-help.guard.spec.ts` fails the frontend unit tests when, outside a
`ProseHelp`, `FieldHelp`, `FieldLock`, a `help` prop or a field label's `description`:

- a list of `warnings` or `notes` is mapped to elements;
- a retention basis, source quote, resolution note, disclaimer or blocked reason is printed (testing
  one in a condition is fine);
- an English text of 180 characters or more is rendered, whether as a child, a description, a
  tooltip or a title.

Each exception is named in the guard's allow-list, by file and by text.
:::

`cypress/e2e/124-prose-help.cy.ts` opens a long popover on a 390 px screen and runs axe with it open.

## Validation messages

Forms validate with zod 4 through `zodResolver`. A message a user reads is set on the schema with
`error`, from `t()`:

```tsx
z.string().min(1, { error: t("clients.upsert.validation.city.required") })
```

For a missing value or a value of the wrong type, such as the `NaN` an emptied number input sends,
use `typeErrors` from `@/lib/zod-messages`. A case it is not given keeps the built-in message:

```tsx
z.number({ error: typeErrors({ invalid: t("timeTracking.projects.errors.hourlyRateMin") }) })
```

A field that sets no message shows the built-in English wording `@/lib/zod-messages` installs for the
whole app (`Required`, `Invalid email`, `Number must be greater than or equal to 0`). `main.tsx` and
the Vitest setup both load it, so a component spec reads the same messages as the running app.

## Loading states

Loading never moves or resizes what is already on screen, and never shows figures that no longer
apply. When a filter or a period changes, each card keeps its size, its title and its caption, and
only its figures (a value, list rows, a chart, table rows) turn into skeletons of the same size until
the new ones arrive: the query keeps the previous result as `placeholderData: keepPreviousData`, and
the widget renderers wrap every figure in `WidgetValue`, which hides it behind a skeleton while the
grid reloads. The grid carries `aria-busy` and a screen-reader-only "Loading…" status. A first load shows skeletons
with the dimensions of the content they stand for: the widget grid reuses the card heights it last
measured at the same window width. `e2e/cypress/e2e/124-dashboard-stable-loading.cy.ts` compares
card bounding boxes before and during a load, the pattern to follow for another screen.

## Accessibility checks

Every control has an accessible name, and that name contains the text the control shows (WCAG 2.5.3).
A button that hides its label on small screens, such as an icon-only "Import" below `md`, keeps it in
`aria-label` and marks its icon `aria-hidden`. A link whose visible text is not the whole story keeps
that text as its name and adds the rest as screen-reader-only text after it, rather than replacing it
with an `aria-label`. Headings go down one level at a time: a list row or an empty state under a page
`h1` is an `h2`, and a row under a month heading (`h2`) is an `h3`. A page has one `main`, the layout's: a screen's own content area is a
plain element. A toggle that opens a group carries `aria-expanded`, and the group's list sits inside
the toggle's own list item.

The Cypress specs of the key screens (document lists and detail, the document editor and its line
rows, the create-document, delete-confirmation and client dialogs, onboarding, sign-in, sign-up and
the company settings) call `cy.assertAccessible()` from `e2e/cypress/support/a11y.ts`. It runs
[axe-core](https://github.com/dequelabs/axe-core) on the page through `cypress-axe` and fails the test
on any **serious** or **critical** violation, printing each one with its rule and element to the
runner output:

```ts
cy.assertAccessible() // the whole page, serious and critical violations fail
cy.assertAccessible({ context: '[data-cy="client-dialog"]' }) // one region
cy.assertAccessible({ rules: ["heading-order"] }) // only these rules, at every impact level
```

Call it once the screen has settled, after the element the test waits for, and again after a dialog
opens or a step changes. It first waits until no finite CSS animation or transition is running on
the page, since a menu, dialog or toast measured mid-fade reads as low contrast; infinite ones, such
as spinners, are ignored. To run it locally, start the e2e stack and run one spec:

```bash
cd e2e
npx cypress run --browser firefox --spec "cypress/e2e/05-clients.cy.ts"
```

Never disable an axe rule for the whole suite. A violation inside a third-party element the app does
not control may be excluded with `context: { exclude: [...] }` at the one call site that needs it, with
a one-line comment naming the element.

:::warning[Enforced in CI]
The axe checks run with the Cypress suite on every pull request. On the pull request from `dev` to
`main`, `lighthouse.yml` also fails when an audited page scores below 100 in Lighthouse accessibility.
:::
