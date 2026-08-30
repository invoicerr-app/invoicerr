/**
 * A document TYPE descriptor — the whole contract for one kind of document (quote, invoice, ...),
 * declared as DATA. Nothing in the engine (registry, controller, frontend) names a document type;
 * they only ever read a descriptor. Adding a document type means writing one of these and
 * registering it (see quote.descriptor.ts + documents.module.ts) — no bespoke business code, no
 * new frontend screen.
 */
export interface DocumentTypeDescriptor {
  /** Stable identifier: the registry key and the URL segment (e.g. "quote"). */
  id: string;
  /** Human-facing name. Plain data, not an i18n key — a plugin can name its type in any language,
   *  the same way `DocumentKindRule.kind` used to be sent as plain data by the (now removed)
   *  compliance engine. */
  label: string;
  fields: DocumentFieldDescriptor[];
  actions: DocumentActionDescriptor[];
  /**
   * Which aggregation screens this type contributes WIDGETS to — see contributions/. Same discipline
   * as `actions`: declaring a location here only says "this type has something to show there"; the
   * actual code that produces it is registered separately (contributions/contribution-registry.ts).
   * A type declared here with no handler registered is not silently skipped — collectWidgets()
   * (contributions/collect-widgets.ts) emits an explicit "unimplemented" widget instead, the same
   * "declared but not implemented must be visible" rule `actions` already holds via the 501 path.
   * Absent or empty: this type shows nothing anywhere aggregated, same as omitting `actions` would
   * leave a type with no operations at all.
   */
  contributions?: WidgetLocation[];
}

/** The two aggregation screens a document type may contribute WIDGETS to — see contributions/. Kept
 *  as a closed union (not an open string) because, unlike a field KIND or an action id, these two
 *  screens are a property of the CORE app's navigation, not something a plugin adds one of. */
export type WidgetLocation = 'dashboard' | 'statistics';

/**
 * One field of a document. `kind` selects both how the value is validated (FieldKindRegistry,
 * backend) and how it is rendered (the frontend's field-renderer registry) — neither one hard-codes
 * the document TYPE, only the field KIND.
 *
 * The kind-specific hints below are all optional and interpreted only by the kind that needs them;
 * a kind that has no use for a hint simply ignores it. This keeps `DocumentFieldDescriptor` a single
 * flat shape instead of a per-kind union, which is what lets a generic renderer iterate `fields`
 * without a switch on the document type.
 */
export interface DocumentFieldDescriptor {
  /** Key under which the value is stored in the document instance's `data` object. */
  key: string;
  /**
   * One of CORE_FIELD_KINDS, or a plugin-registered kind. Plugin kinds MUST be prefixed
   * (e.g. "plugin:acme.rating") so a future core kind can never collide with one.
   */
  kind: string;
  label: string;
  required?: boolean;
  helpText?: string;
  /** 'select': the choices offered. */
  options?: { value: string; label: string }[];
  /** 'money': a fixed ISO 4217 currency code for this field. Ignored when `currencyField` is set. */
  currency?: string;
  /**
   * 'money': the KEY of a field elsewhere in the SAME document whose current value is the currency
   * to show — e.g. a quote line's `unitPrice` follows the quote's own top-level `currency` field.
   * Always resolved against the document root, even for a field nested inside an 'array' row: a
   * per-row currency would be a business rule (mixed-currency lines), which this descriptor does
   * not encode. Takes priority over `currency`.
   */
  currencyField?: string;
  /**
   * 'reference', SINGLE target: which EntityReferenceRegistry entry resolves/searches values for
   * this field. The stored value is a plain non-empty id string (e.g. `data.client = "client-1"`) —
   * unchanged since before `entities` existed, and every existing single-target field (the "client"
   * field on both the quote and the invoice) keeps this exact shape.
   */
  entity?: string;
  /**
   * 'reference', MULTIPLE possible targets (e.g. an invoice's origin can be a quote OR another
   * invoice): the EntityReferenceRegistry entries a value may resolve against. Mutually exclusive
   * with `entity` — a field sets one or the other, never both. Set this (even to a single-element
   * array) and the field's STORED value stops being a bare id string; a bare id alone can no longer
   * say which entity it targets, so it becomes `{ entity: string; id: string }` instead, `entity`
   * being one of the strings listed here. See `targetEntitiesOf` and field-kinds.ts's 'reference'
   * validator, the only two places that branch on "is this multi-target or not".
   */
  entities?: string[];
  /** 'array': the shape of one row. */
  fields?: DocumentFieldDescriptor[];
  min?: number;
  max?: number;
  /**
   * 'rowSelection' — the three hints together say "pick a subset of another document instance's own
   * repeatable rows". Full design (why this needed a 10th kind, the identity/pointer/moving-source
   * decisions) lives in row-selection/row-selection.ts, not here — this is only the flat, declarative
   * shape a descriptor fills in, the same treatment `currencyField`/`entity`/`entities` already get.
   *  - `sourceField`: the KEY of a 'reference' field ELSEWHERE IN THIS SAME DOCUMENT whose current
   *    value names the source document instance (e.g. the credit note's own "invoice" field).
   *  - `sourceEntity`: which EntityReferenceRegistry entry `sourceField` must resolve to — required
   *    even though `sourceField`'s own descriptor already declares this, because this kind never
   *    cross-reads another field's descriptor (every kind here stays self-contained); the async
   *    validator cross-checks the two agree, so a typo here is a caught misconfiguration, not a
   *    silent mismatch. Only a SINGLE-target `sourceField` is supported (an `entity`, not `entities`)
   *    — deliberately: nothing in this core needs a row selection sourced from an ambiguous set of
   *    possible document types, and supporting it would double this kind's branching for no case at
   *    hand.
   *  - `sourceArrayField`: the KEY of the 'array' field on the SOURCE document TYPE's own descriptor
   *    whose rows may be selected.
   * The stored value is `string[]` — the stable ids (see ROW_ID_KEY) of the selected source rows, a
   * POINTER into the source document, never a copy of its values.
   */
  sourceField?: string;
  sourceEntity?: string;
  sourceArrayField?: string;
}

/** A multi-target 'reference' field's stored value: `entity` says which EntityReferenceRegistry
 *  entry `id` resolves against — see `DocumentFieldDescriptor.entities`. */
export interface MultiTargetReferenceValue {
  entity: string;
  id: string;
}

/**
 * Every entity a 'reference' field may target, whichever of `entity`/`entities` it was declared
 * with — the one place that reconciles the two so callers (the validator, a future consumer) never
 * duplicate the "which one is set" branch. Empty for a field that is not a 'reference' at all, or a
 * misconfigured one that sets neither.
 */
export function targetEntitiesOf(field: DocumentFieldDescriptor): string[] {
  if (field.entities) return field.entities;
  if (field.entity) return [field.entity];
  return [];
}

/** Whether `field` was declared with `entities` (multi-target) rather than a single `entity` — the
 *  one predicate that decides which shape the field's stored value takes. See `entities`'s comment. */
export function isMultiTargetReference(field: DocumentFieldDescriptor): boolean {
  return !!field.entities;
}

export interface DocumentActionDescriptor {
  id: string;
  label: string;
  /**
   * 'always': offered regardless of the record's status, including a brand-new record that has not
   * been saved yet (which therefore has no status at all).
   * string[]: offered only once the record's current status is one of these — a not-yet-saved
   * record never satisfies this, since it has no status to match.
   */
  availableWhen: 'always' | string[];
  /**
   * The action's OWN inputs — reusing the exact same field vocabulary as a document's `fields`
   * (DocumentFieldDescriptor), validated by the same FieldKindRegistry and rendered by the same
   * frontend field renderers. This is a deliberately separate namespace from the document's `data`:
   * a "send" action's `recipient` is a parameter of the OPERATION, not a value stored on the
   * document. Absent or empty means the action takes no parameters (e.g. "duplicate").
   */
  params?: DocumentFieldDescriptor[];
}

/**
 * The closed core: every kind a document field can be without a plugin. Deliberately small — see
 * FieldKindRegistry (field-kinds.ts) for how a plugin extends it.
 */
export const CORE_FIELD_KINDS = [
  'text',
  'longText',
  'number',
  'money',
  'date',
  'boolean',
  'select',
  'reference',
  'array',
  // The 10th: a selection of rows belonging to ANOTHER document instance — see
  // row-selection/row-selection.ts for the mechanism (registered separately, not inline here) and
  // this file's own `sourceField`/`sourceEntity`/`sourceArrayField` for the declared shape.
  'rowSelection',
] as const;

export type CoreFieldKind = (typeof CORE_FIELD_KINDS)[number];

/** Whether `action` may run on a record currently at `status` (undefined = not saved yet). */
export function isActionAvailable(action: DocumentActionDescriptor, status: string | undefined): boolean {
  if (action.availableWhen === 'always') return true;
  return status !== undefined && action.availableWhen.includes(status);
}
