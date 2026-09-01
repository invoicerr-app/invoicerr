import type {
  DocumentActionDescriptor,
  DocumentFieldDescriptor,
  DocumentTypeDescriptor,
  DocumentTypeSummary,
} from "@/components/documents/types"
import type { Widget } from "@/components/widgets/types"

/**
 * Root TODO item 25's own reliquat: "l'i18n des libellés de descripteurs (données brutes
 * aujourd'hui)". A document-type descriptor's `label` (backend, descriptors/*.descriptor.ts) is
 * PLAIN DATA, not an i18n key — deliberately, so a THIRD-PARTY plugin can label its own type,
 * field, action, status or widget in whatever language it wants (see the backend's
 * `DocumentTypeDescriptor.label` comment, and `WidgetBase.label` in contributions/widgets.ts). That
 * contract must not change: a plugin type with no matching key must go on rendering exactly the raw
 * text it declared.
 *
 * What CAN change without touching that contract: for the app's own NATIVE types (quote, invoice,
 * credit-note, expense, received-invoice), attempt a DERIVED, deterministic i18n key first, and fall
 * back to the descriptor's own raw label the moment that key doesn't exist. i18next's own
 * `{ defaultValue }` option is exactly this mechanism — `t(key, { defaultValue })` returns the
 * translation when `key` is defined, `defaultValue` verbatim otherwise. Every function below is a
 * one-line wrapper around that call, differing only in which key shape it derives:
 *
 *   documents.descriptors.<typeId>.label
 *   documents.descriptors.<typeId>.fields.<fieldKey>.label
 *   documents.descriptors.<typeId>.fields.<fieldKey>.options.<optionValue>
 *   documents.descriptors.<typeId>.fields.<arrayFieldKey>.fields.<rowFieldKey>.label   (nested 'array' rows)
 *   documents.descriptors.<typeId>.actions.<actionId>.label
 *   documents.descriptors.<typeId>.actions.<actionId>.params.<paramKey>.label
 *   documents.descriptors.<typeId>.actions.<actionId>.params.<paramKey>.options.<optionValue>
 *   documents.descriptors.<typeId>.statuses.<statusId>
 *   documents.descriptors.<typeId>.widgets.<widgetId>.label
 *
 * `locales/en/translation.json` only ever carries keys for the five NATIVE types — see that file's
 * own "descriptors" section. A plugin type's id/field key/action id never matches any of them, so
 * every one of its labels degrades to `defaultValue`, i.e. exactly what rendered before this file
 * existed. This is also why every function's LAST parameter is always the raw label to fall back to,
 * never a lookup this module performs itself: the caller (a query hook, see
 * hooks/queries/use-document-types.ts) always already has the descriptor's own current value in
 * hand, so there is nothing for this module to fetch.
 *
 * WHERE this gets called: `useDocumentType`/`useDocumentTypesList`/`useAvailableDocumentTypes`
 * (hooks/queries/use-document-types.ts) and `useDashboardWidgets`/`useStatisticsWidgets`
 * (hooks/queries/use-widgets.ts) — the hook layer, not any one rendering component. A document's
 * `fields`/`actions`/`statuses` (and a contribution's widgets) all reach every consumer (the form,
 * the list, the sidebar, action dialogs, custom slots) EXCLUSIVELY through those hooks, so
 * translating there once means every renderer keeps reading `field.label`/`action.label`/
 * `status.label`/`widget.label` completely unchanged — already-resolved text, exactly the contract
 * they always had. This is the "one helper, never an ad hoc per-component derivation" the task asks
 * for: the helper is called from two files, not scattered across a dozen renderers.
 *
 * i18n-check (frontend/scripts/i18n-check.mjs) only requires STATICALLY-quoted `t("...")` keys to
 * exist in en/translation.json; a call built from a template literal with `${...}` interpolation is
 * recognized as a DYNAMIC PATTERN instead (see that script's own header) — never required to exist,
 * and any EN key that happens to match one is protected from the (non-failing) "dead key" warning.
 * Every `t(...)` call below is written as ONE inline template literal, deliberately, so the script
 * can see the real key shape rather than an opaque pre-built variable — see this file's own tests
 * (descriptor-i18n.spec.ts) for what a fake translator proves about the fallback contract itself.
 */

/**
 * The narrow shape this module needs from i18next's own `t` — matches what `useTranslation()` hands
 * out, kept intentionally loose (not the full generic `TFunction`) so this module stays framework-
 * light and a unit test can hand it a plain function with no i18next instance at all.
 */
export type DescriptorTranslator = (key: string, options?: { defaultValue?: string }) => string

/** A field path (e.g. `["lines", "description"]` for a row subfield) rendered as descriptors/
 *  types.ts's own nesting: an 'array' field's row subfields sit under a `fields` key one level down,
 *  so the i18n key mirrors that shape instead of flattening it — `lines.fields.description`, not
 *  `lines.description`, which could otherwise collide with an unrelated top-level field named
 *  "lines.description" (never happens today, but the mirroring makes it structurally impossible). */
function fieldPathSegment(path: string[]): string {
  return path.join(".fields.")
}

// ---- single-fact derivations — exported so a caller with just one label to resolve (no whole tree
// to walk) never has to hand-build a key itself. ----------------------------------------------

/** `DocumentTypeDescriptor.label` / `DocumentTypeSummary.label`. */
export function descriptorTypeLabel(t: DescriptorTranslator, typeId: string, rawLabel: string): string {
  return t(`documents.descriptors.${typeId}.label`, { defaultValue: rawLabel })
}

/** One field's own `label`, `fieldPath` being every key from the type's top-level `fields` down to
 *  this one (a single-element array for a top-level field). */
export function descriptorFieldLabel(
  t: DescriptorTranslator,
  typeId: string,
  fieldPath: string[],
  rawLabel: string,
): string {
  const segment = fieldPathSegment(fieldPath)
  return t(`documents.descriptors.${typeId}.fields.${segment}.label`, { defaultValue: rawLabel })
}

/** One `select` field's own `options[].label`, for the option whose `value` is `optionValue`. */
export function descriptorFieldOptionLabel(
  t: DescriptorTranslator,
  typeId: string,
  fieldPath: string[],
  optionValue: string,
  rawLabel: string,
): string {
  const segment = fieldPathSegment(fieldPath)
  return t(`documents.descriptors.${typeId}.fields.${segment}.options.${optionValue}`, {
    defaultValue: rawLabel,
  })
}

/** `DocumentActionDescriptor.label`. */
export function descriptorActionLabel(
  t: DescriptorTranslator,
  typeId: string,
  actionId: string,
  rawLabel: string,
): string {
  return t(`documents.descriptors.${typeId}.actions.${actionId}.label`, { defaultValue: rawLabel })
}

/** One of `action.params[]`'s own `label` — a SEPARATE namespace from the document's own `fields`
 *  (types.ts's own `DocumentActionDescriptor.params` comment), so this is not `descriptorFieldLabel`
 *  reused: the two can declare the exact same field KEY for entirely different params/fields without
 *  colliding. */
export function descriptorActionParamLabel(
  t: DescriptorTranslator,
  typeId: string,
  actionId: string,
  paramPath: string[],
  rawLabel: string,
): string {
  const segment = fieldPathSegment(paramPath)
  return t(`documents.descriptors.${typeId}.actions.${actionId}.params.${segment}.label`, {
    defaultValue: rawLabel,
  })
}

/** One action param's own `options[].label`. */
export function descriptorActionParamOptionLabel(
  t: DescriptorTranslator,
  typeId: string,
  actionId: string,
  paramPath: string[],
  optionValue: string,
  rawLabel: string,
): string {
  const segment = fieldPathSegment(paramPath)
  return t(`documents.descriptors.${typeId}.actions.${actionId}.params.${segment}.options.${optionValue}`, {
    defaultValue: rawLabel,
  })
}

/** One of `DocumentTypeDescriptor.statuses[]`'s own `label` — no trailing `.label` segment
 *  (`documents.descriptors.<typeId>.statuses.<statusId>` is the whole key), unlike every other
 *  derivation above: a status has nothing else to translate under it, so there is no sibling key a
 *  `.label` suffix would need to disambiguate from. */
export function descriptorStatusLabel(
  t: DescriptorTranslator,
  typeId: string,
  statusId: string,
  rawLabel: string,
): string {
  return t(`documents.descriptors.${typeId}.statuses.${statusId}`, { defaultValue: rawLabel })
}

/**
 * A contribution widget's own `label` (contributions/widgets.ts, backend) — `widgetId` is the
 * widget's own `id`, which every contribution in this codebase writes as `<typeId>:<suffix>` (see
 * e.g. invoice-contributions.ts's `invoice:pending`), so the type id is recovered by splitting on the
 * FIRST `:` rather than threading a separate typeId parameter through `useDashboardWidgets`/
 * `useStatisticsWidgets` (which only ever see the flat `Widget[]` the backend returns, never grouped
 * by type). A widget id with no `:` at all (never happens for a real contribution, but nothing here
 * assumes it can't) still degrades safely: `typeId` becomes the whole id, no key ever matches, the
 * raw label shows through unchanged — same fallback as every other case in this file.
 */
export function descriptorWidgetLabel(t: DescriptorTranslator, widgetId: string, rawLabel: string): string {
  const typeId = widgetId.split(":")[0]
  return t(`documents.descriptors.${typeId}.widgets.${widgetId}.label`, { defaultValue: rawLabel })
}

// ---- whole-tree translations — what the query hooks actually call -----------------------------

/**
 * Translates every field in `fields` (and, recursively, an 'array' field's own row `fields`) IN
 * PLACE conceptually — returns a fresh array/objects, never mutates `fields` itself, the same
 * "transform over a clone" discipline the backend's own company-view.ts holds for the identical
 * reason (never mutate a descriptor's shared, cached fields). Only `label` and `options[].label` are
 * ever replaced — `key`/`kind`/`value`/every other property is carried over untouched, since those
 * are read by validation and form submission, never displayed as translatable text.
 */
function translateDocumentFields(
  t: DescriptorTranslator,
  typeId: string,
  fields: DocumentFieldDescriptor[],
  parentPath: string[] = [],
): DocumentFieldDescriptor[] {
  return fields.map((field) => {
    const path = [...parentPath, field.key]
    const label = descriptorFieldLabel(t, typeId, path, field.label)
    const options = field.options?.map((option) => ({
      ...option,
      label: descriptorFieldOptionLabel(t, typeId, path, option.value, option.label),
    }))
    const nestedFields = field.fields ? translateDocumentFields(t, typeId, field.fields, path) : undefined
    return {
      ...field,
      label,
      ...(options ? { options } : {}),
      ...(nestedFields ? { fields: nestedFields } : {}),
    }
  })
}

/** Same recursion as `translateDocumentFields` above, over one action's OWN `params` instead — kept
 *  as its own function (not the same one, parameterized) so every `t(...)` call in this file stays a
 *  single, self-contained inline template literal i18n-check's static scan can see in full (see this
 *  file's own header) rather than one built from a shared, opaque key-prefix variable. */
function translateActionParams(
  t: DescriptorTranslator,
  typeId: string,
  actionId: string,
  params: DocumentFieldDescriptor[],
  parentPath: string[] = [],
): DocumentFieldDescriptor[] {
  return params.map((field) => {
    const path = [...parentPath, field.key]
    const label = descriptorActionParamLabel(t, typeId, actionId, path, field.label)
    const options = field.options?.map((option) => ({
      ...option,
      label: descriptorActionParamOptionLabel(t, typeId, actionId, path, option.value, option.label),
    }))
    const nestedFields = field.fields
      ? translateActionParams(t, typeId, actionId, field.fields, path)
      : undefined
    return {
      ...field,
      label,
      ...(options ? { options } : {}),
      ...(nestedFields ? { fields: nestedFields } : {}),
    }
  })
}

function translateAction(
  t: DescriptorTranslator,
  typeId: string,
  action: DocumentActionDescriptor,
): DocumentActionDescriptor {
  const label = descriptorActionLabel(t, typeId, action.id, action.label)
  const params = action.params ? translateActionParams(t, typeId, action.id, action.params) : undefined
  return { ...action, label, ...(params ? { params } : {}) }
}

/**
 * The one function `useDocumentType` (hooks/queries/use-document-types.ts) calls: translates a
 * type's own `label`, every field (`fields`, recursively into 'array' rows), every action (and its
 * own `params`), and every declared status. Nothing else on `DocumentTypeDescriptor` carries
 * human-facing text a plugin might have written in another language — `id`/`kind`/`key`/
 * `availableWhen`/`transitions`/`numbering`/`contributions`/`listItem`/`email` are all either
 * structural or (for `email`) a template a company can already override per its own comment, never
 * touched here.
 */
export function translateDocumentTypeDescriptor(
  t: DescriptorTranslator,
  descriptor: DocumentTypeDescriptor,
): DocumentTypeDescriptor {
  const typeId = descriptor.id
  const label = descriptorTypeLabel(t, typeId, descriptor.label)
  const fields = translateDocumentFields(t, typeId, descriptor.fields)
  const actions = descriptor.actions.map((action) => translateAction(t, typeId, action))
  const statuses = descriptor.statuses?.map((status) => ({
    ...status,
    label: descriptorStatusLabel(t, typeId, status.id, status.label),
  }))
  return { ...descriptor, label, fields, actions, ...(statuses ? { statuses } : {}) }
}

/** What `useDocumentTypesList`/`useAvailableDocumentTypes` call for each `{ id, label }` summary. */
export function translateDocumentTypeSummary(
  t: DescriptorTranslator,
  summary: DocumentTypeSummary,
): DocumentTypeSummary {
  return { ...summary, label: descriptorTypeLabel(t, summary.id, summary.label) }
}

/** What `useDashboardWidgets`/`useStatisticsWidgets` call for each widget a contribution returned —
 *  only `label` changes; `columns[].label` (TableWidget) and `points[].label` (TimeSeriesWidget) stay
 *  raw, same convention as the rest of this app's "titles get translated, per-row/-column data does
 *  not" split (see e.g. DocumentFieldValue never translating a document's own stored values either). */
export function translateWidget(t: DescriptorTranslator, widget: Widget): Widget {
  return { ...widget, label: descriptorWidgetLabel(t, widget.id, widget.label) }
}
