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
}

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
  /** 'reference': which EntityReferenceRegistry entry resolves/searches values for this field. */
  entity?: string;
  /** 'array': the shape of one row. */
  fields?: DocumentFieldDescriptor[];
  min?: number;
  max?: number;
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
] as const;

export type CoreFieldKind = (typeof CORE_FIELD_KINDS)[number];

/** Whether `action` may run on a record currently at `status` (undefined = not saved yet). */
export function isActionAvailable(action: DocumentActionDescriptor, status: string | undefined): boolean {
  if (action.availableWhen === 'always') return true;
  return status !== undefined && action.availableWhen.includes(status);
}
