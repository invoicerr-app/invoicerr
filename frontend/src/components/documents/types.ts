// Mirrors backend/src/modules/documents/descriptors/types.ts. Deliberately duplicated rather than
// shared (front and back are two separate npm projects with no shared package, same as
// DocumentKindRule already did for the — now removed — compliance engine): this is a wire shape,
// not code.

export interface DocumentFieldOption {
  value: string
  label: string
}

export interface DocumentFieldDescriptor {
  key: string
  /** One of the core kinds (see field-renderers/registry.ts), or a plugin-registered one. */
  kind: string
  label: string
  required?: boolean
  helpText?: string
  /** 'select': the choices offered. */
  options?: DocumentFieldOption[]
  /** 'select' only: whether a value NOT among `options` is still accepted — but ONLY when `options`
   *  is itself EMPTY (no known catalog for this field at all, e.g. no VAT rate list for the active
   *  company's country — see the backend's vat-rates/). A select with zero options is a dead
   *  control; this is what tells the renderer to fall back to a plain input instead. Never relaxes
   *  anything once a real, non-empty list exists — the backend enforces the exact same rule. */
  allowCustomValue?: boolean
  /** 'money': a fixed ISO 4217 currency code. Ignored when `currencyField` is set. */
  currency?: string
  /** 'money': the key of a top-level sibling field whose current value is the currency to show. */
  currencyField?: string
  /** 'reference', SINGLE target: which entity the generic search/resolve endpoints target (e.g.
   *  "client"). The stored value is a plain non-empty id string. */
  entity?: string
  /** 'reference', MULTIPLE possible targets (e.g. an invoice's origin can be a quote OR another
   *  invoice) — mutually exclusive with `entity`. When set, the field's stored value is
   *  `{ entity, id }` (see `MultiTargetReferenceValue`), not a bare id: a bare id alone can no
   *  longer say which entity it targets once more than one is possible. */
  entities?: string[]
  /** 'array': the shape of one row. */
  fields?: DocumentFieldDescriptor[]
  min?: number
  max?: number
  /** 'rowSelection': the KEY of a 'reference' field elsewhere in THIS document naming the source
   *  document instance — see field-renderers/row-selection-field.tsx and the backend's
   *  row-selection/row-selection.ts for the full design. The stored value is `string[]` (the
   *  selected source rows' stable ids) — a POINTER into the source, never a copy of its values. */
  sourceField?: string
  /** 'rowSelection': which entity `sourceField` must resolve to. */
  sourceEntity?: string
  /** 'rowSelection': the KEY of the 'array' field on the SOURCE type's own descriptor to pick rows from. */
  sourceArrayField?: string
}

/** A multi-target 'reference' field's stored value — see `DocumentFieldDescriptor.entities`. */
export interface MultiTargetReferenceValue {
  entity: string
  id: string
}

/** Whether `field` was declared with `entities` (multi-target) rather than a single `entity`. */
export function isMultiTargetReference(field: DocumentFieldDescriptor): boolean {
  return !!field.entities?.length
}

export interface DocumentActionDescriptor {
  id: string
  label: string
  /** 'always', or the list of record statuses this action is offered for. */
  availableWhen: "always" | string[]
  /** The action's OWN inputs — the exact same field vocabulary as a document's `fields`, rendered
   *  by the exact same DocumentField components, in a small dialog of their own (see
   *  action-params-dialog.tsx) rather than a second form system. Absent/empty: no dialog, the
   *  action just runs. */
  params?: DocumentFieldDescriptor[]
  /**
   * Present only when the active company's COUNTRY forbids this action right now (see the backend's
   * country-policy/country-policy.ts) — PLAIN TEXT, same convention as `label`/a run result's
   * `message`, not an i18n key: this never names a country in code, on either side, it only ever
   * shows what the backend computed. Absent when the action is allowed by the country policy —
   * `isActionAvailable`'s status check is a completely separate concern from this one; an action can
   * fail either, both, or neither.
   */
  policyBlockedReason?: string
}

/** What running an action hands back — see the backend's ActionResult for the full contract. */
export interface ActionResult {
  document?: DocumentInstance
  changed: boolean
  /** Plain data (not an i18n key), same convention as a descriptor's `label` — shown as-is. */
  message?: string
}

/**
 * The generic list's (document-list.tsx) only per-type hint: which field KEYS form a card's title,
 * and which show as secondary info beneath it. This is what lets the list render CARDS — a title
 * plus a couple of secondary facts, the way clients/articles already do — without inventing a
 * heuristic per document type ("if it's an invoice, show the client"): the descriptor says which
 * field(s) that is, the same way it already says which fields exist at all. See the backend's
 * `DocumentTypeDescriptor.listItem` (descriptors/types.ts) for the full contract this mirrors.
 */
export interface DocumentListItemHint {
  /** Rendered as the card's title, in order, joined by " · ". */
  titleFields?: string[]
  /** Rendered as "<field label>: <value>" secondary lines under the title, in order. */
  secondaryFields?: string[]
}

export interface DocumentTypeDescriptor {
  id: string
  label: string
  fields: DocumentFieldDescriptor[]
  actions: DocumentActionDescriptor[]
  listItem?: DocumentListItemHint
}

export interface DocumentTypeSummary {
  id: string
  label: string
}

export interface DocumentInstance {
  id: string
  typeId: string
  status: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface EntityReferenceOption {
  id: string
  label: string
}

export function isActionAvailable(action: DocumentActionDescriptor, status: string | undefined): boolean {
  if (action.availableWhen === "always") return true
  return status !== undefined && action.availableWhen.includes(status)
}
