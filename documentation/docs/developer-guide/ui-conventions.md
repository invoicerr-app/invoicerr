---
sidebar_position: 15
---

# UI Conventions

Conventions the frontend (`frontend/src`) follows, so every screen behaves the same way.

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
  {formatServerMessages(t, warnings)}
</ProseHelp>

<ProseHelp title={t("documents.archive.retainUntil", { date })} dataCy="document-archive-retention">
  {archive.retentionBasisMessage
    ? formatServerMessage(t, archive.retentionBasisMessage)
    : archive.retentionBasis}
</ProseHelp>
```

### Server-composed text is a message, never a sentence

An explanation the server composes (tax warnings, line-total and credit warnings, currency notes,
retention citations) crosses the API as `{ key, params }`, never as a finished English sentence. The
frontend renders it through `t()` with `formatServerMessage` / `formatServerMessages`
(`@/lib/server-message`), so the same warning is translatable on screen and still printable in a PDF.

- The English text lives once in `backend/src/modules/documents/messages/messages.en.ts` and, under
  the same key and with the same `{{name}}` placeholders, in
  `frontend/src/locales/en/translation.json`. `messages.en.spec.ts` fails when the two drift.
- Values (a country code, a rate, a rule label, a statute reference) travel as `params`; never build a
  sentence in a `params` value.
- A key is typed against the backend catalog, so an unknown key is a compile error.
- Anything the server itself prints (the rendered PDF) formats the same message with
  `formatServerMessage`, from the same English catalog.

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
`h1` is an `h2`. A page has one `main`, the layout's: a screen's own content area is a
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
