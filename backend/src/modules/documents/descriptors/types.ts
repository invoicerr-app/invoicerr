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
  /**
   * The generic LIST screen's only per-type hint (document-list.tsx, frontend): which field KEYS
   * form this type's card heading, and which show as secondary info beneath it. This is what makes
   * "cards, not a bare table" possible without the frontend inventing a heuristic ("if it's an
   * invoice, show the client") — the exact per-type branching this whole model exists to avoid. A
   * bare table sidesteps the question entirely (every column gets equal weight); a card cannot,
   * because a card needs SOMETHING to be the title. So the descriptor says which field(s) that is,
   * the same way it already says which fields exist at all.
   *
   * Both lists hold KEYS of THIS type's own top-level `fields` only (never a nested 'array' row
   * field, and never a dotted path) — resolving one that isn't there (a typo, or a field a future
   * country overlay removes, see company-view.ts) is a mismatch the frontend skips over silently,
   * never a crash: the same "degrade honestly instead of breaking" rule the rest of this core holds
   * for a descriptor/data mismatch elsewhere (an unrecognized field kind, a dangling reference id).
   * Absent or both empty: the list shows a generic fallback title ("<type label> #<short id>") and
   * no secondary line — never nothing at all.
   */
  listItem?: {
    /** Rendered as the card's title, in order, joined by " · ". Falls back to a generic
     *  "<label> #<id>" when omitted, empty, or every named field is unset on a given instance —
     *  which is why this should name field(s) that are actually REQUIRED on the type (an invoice's
     *  `client`, an expense's `description`): the fallback exists for the mismatch case above, not
     *  as a routine substitute for a real title. */
    titleFields?: string[];
    /** Rendered as "<field label>: <value>" secondary lines under the title, in order. */
    secondaryFields?: string[];
  };
  /**
   * The type's LIFECYCLE: every STATUS one of its instances can be in, and which one a brand-new
   * instance starts at. See lifecycle.ts's header for the full design (why `availableWhen` below is
   * derived from `DocumentActionDescriptor.transitions` rather than the other way around, and how
   * the runtime enforces that a handler's write actually lands on the declared status).
   *
   * Optional, deliberately: a descriptor built only to exercise an UNRELATED concern (a field kind,
   * a row-selection cross-check, a widget contribution) in a test has no lifecycle to declare and
   * should not have to invent one just to keep compiling — `lifecycle.ts`'s `validateLifecycle` (run
   * by `DocumentTypeRegistry.register()`) treats an ABSENT `statuses` as "this type opts out of the
   * lifecycle model entirely" and validates nothing for it. Every SHIPPED type (quote, invoice,
   * credit-note, expense) declares one.
   */
  statuses?: DocumentStatusDescriptor[];
  /** Which `statuses[].id` a brand-new, never-saved instance of this type starts at — required, and
   *  checked against `statuses`, whenever `statuses` itself is declared (see `validateLifecycle`). */
  initialStatus?: string;
  /**
   * Declares AT WHICH TRANSITION this type's instances receive a NUMBER — see numbering/ for the
   * full mechanism (format, atomic sequence, the runtime hook in documents.service.ts's `runAction`).
   * `onEnterStatus` names one of THIS type's own `statuses`, checked by `validateLifecycle` below the
   * exact same way `initialStatus`/`transitions` already are.
   *
   * A number is taken the FIRST time a record's persisted status actually EQUALS `onEnterStatus` —
   * never before (a draft has none) and never again afterward, however many different ways there
   * might be to reach that status: once `DocumentInstance.number` is set it is never cleared, so
   * "status matches AND number is still null" already means "first time", with no need to track
   * which transition edge fired.
   *
   * Absent means this type is NEVER numbered, on any record, by anything — the deliberate state for
   * "expense" (no status a number would even make sense to hang off) and, today, for "credit-note"
   * (its lifecycle has no status besides "draft" to enter — see credit-note.descriptor.ts's own
   * comment on why `numbering` is not declared for it despite a credit note plausibly needing one in
   * real bookkeeping). This is the numbering equivalent of `contributions`/`statuses` themselves being
   * optional: a type that never declares a concern gets none of that concern's machinery.
   */
  numbering?: { onEnterStatus: string };
  /**
   * This type's DEFAULT email — subject/body, sent when the document is delivered by mail (the
   * quote's own unconditional "send", the invoice's "email" transport — see actions/generic-actions.ts
   * and transports/email-transport.ts). Plain, sober ENGLISH text, same convention as `label`: a
   * descriptor is data, not an i18n key, and every SHIPPED type (quote/invoice/credit-note/expense)
   * declares one so "no template configured" never actually happens for a core type.
   *
   * `subject`/`body` are PLAIN TEXT with `{placeholder}` interpolation — see
   * actions/email-template.ts's `renderEmailTemplate` for the pure interpolation mechanism, and
   * `buildEmailTemplateParts` for the fixed vocabulary it fills in (`displayNumber`, `typeLabel`,
   * `companyName`, `totalGross`, `recipientName`). A company MAY override this per type — see
   * `Company.documentEmailTemplates` (schema.prisma) — which takes priority over this field when
   * present; this is only the FALLBACK a type ships with. A type that declares NO `email` at all
   * (a third-party type, none shipped here) falls back further still, to
   * `actions/email-template.ts`'s own `GENERIC_FALLBACK_EMAIL_TEMPLATE` — visibly, in code, never a
   * silently-borrowed default.
   */
  email?: DocumentEmailTemplate;
  /**
   * Root TODO item 15 ("mentions obligatoires") — opts this type into the country-mandated-mentions
   * mechanism (`mentions/`): `rendering/render-instance-pdf.ts` resolves the seller's own country and
   * this instance's own `issueDate` field ONLY when this flag is set, and passes the result to
   * `rendering/render-html.ts`'s own `legalMentions` block. EN 16931's BG-1 (the mentions' natural
   * home in the CII/UBL export — `formats/semantic/build-semantic-invoice.ts`) is an INVOICE concept;
   * this flag is what keeps that same country-is-data mechanism from being wired, unconditionally,
   * into a document type that has no `issueDate` field at all (e.g. "expense") or where a per-line
   * VAT rate has a different meaning entirely — the exact same "no business code names a document
   * type" discipline `usesVatRateCatalog` already holds for a FIELD, scaled to a document TYPE.
   * Declared here (not inferred from the presence of an `issueDate` field) because a type could
   * plausibly track an issue date without being one this country's law actually addresses.
   *
   * Only `invoice.descriptor.ts` sets this today. Absent (the default for every other type,
   * including third-party ones) means exactly what it always meant before this flag existed: no
   * mentions block, ever — the existing PDF of every other document type is byte-for-byte unchanged.
   */
  usesLegalMentions?: boolean;
}

/** One document type's default (or company-overriding) EMAIL template — see
 *  `DocumentTypeDescriptor.email` and `Company.documentEmailTemplates` (schema.prisma) for the two
 *  places this exact shape is used, and actions/email-template.ts for how it gets interpolated. */
export interface DocumentEmailTemplate {
  subject: string;
  body: string;
}

/** One status a document TYPE's instances can be in — see `DocumentTypeDescriptor.statuses`. Plain
 *  data, not an i18n key, same convention as `DocumentTypeDescriptor.label`. */
export interface DocumentStatusDescriptor {
  id: string;
  label: string;
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
  /**
   * 'select' only: whether a value NOT among `options` is still accepted — but ONLY when `options`
   * is itself EMPTY, never as a way to bypass a known, non-empty list. This is the escape hatch for
   * "no known catalog for this field at all" (see vat-rates/ and descriptors/company-view.ts, which
   * is what actually fills `options` per company for a field like the invoice line's `vatRate`): a
   * select with zero options is a dead control, so this field is what tells both the backend
   * validator (field-kinds.ts) and the frontend renderer to fall back to a plain input instead of
   * leaving the user stuck. It does NOT relax anything once a real catalog IS known — a scripted
   * client must be refused exactly what the screen would refuse, the same discipline
   * country-policy's own runAction check already holds for actions.
   */
  allowCustomValue?: boolean;
  /**
   * 'select' only: this field's `options` are populated PER COMPANY, from the VAT rate catalog
   * (vat-rates/) for the active company's resolved country — see descriptors/company-view.ts, the
   * only code that interprets this hint. Declared as a hint on the field (the same treatment
   * `currencyField`/`entity` already get) rather than hardcoded into any one document type's
   * descriptor, so it stays reusable the day a second field (or a second document type) also needs a
   * VAT-rate choice.
   */
  usesVatRateCatalog?: boolean;
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
   * 'select' — TODO_PRODUIT.md T4-d: locks this field's value to a SIBLING 'reference' field's
   * resolved entity, e.g. a credit note's own `currency` following the `invoice` it corrects
   * (settlement/credits.ts credits a claim structurally denominated in the invoice's OWN currency —
   * see that file's own header; a credit note declaring a DIFFERENT currency has no business
   * meaning at all). `field` names the sibling 'reference' field elsewhere in this SAME document;
   * `entity` is which EntityReferenceRegistry entry it resolves against — duplicated here rather
   * than cross-read off `field`'s own descriptor, the SAME self-containment discipline
   * `sourceField`/`sourceEntity` (the 'rowSelection' kind, below) already holds, for the identical
   * reason (every kind here stays self-contained; a mismatch between the two is a misconfiguration
   * a test can catch, never a runtime cross-read). `sourceKey` is the key to copy off that entity's
   * raw `getFields()` result — the exact same OPTIONAL provider method `prefillFrom` above already
   * calls, never a second mechanism.
   *
   * DELIBERATELY A UI-ONLY CONVENIENCE, never the actual rule: this hint only drives
   * field-renderers/primitive-fields.tsx's 'select' renderer (pre-fills the value, disables the
   * control once the reference resolves) — a scripted client posting a mismatched `currency`
   * directly is refused independently, server-side, by whichever "save-draft" handler the
   * document type registers (see actions/credit-note-actions.ts's own header for the credit note's
   * own named validation). Screen and server enforce the SAME rule through two different paths on
   * purpose (the screen for a good experience, the server because the screen is never trusted
   * alone) — never make one a substitute for the other.
   */
  lockedFromReference?: { field: string; entity: string; sourceKey: string };
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
   * 'array' only: lets each ROW offer a "fill from catalog" action — the mechanism the 14-articles
   * cypress spec's "prefills an invoice line when an article is picked from the catalog" exercises.
   * `entity` names the EntityReferenceRegistry entry that backs the picker (e.g. "article" — see
   * references/article-reference.provider.ts); `map` pairs a ROW subfield KEY with the name of a
   * field on THAT entity's own raw record (e.g. `{ description: 'name', unitPrice: 'unitPrice',
   * vatRate: 'vatRate' }`). The core never interprets `map`'s values itself, and never mentions
   * "article" anywhere in this file or in field-kinds.ts/validate.ts — it only carries the shape;
   * the frontend (field-renderers/array-field.tsx) is what actually resolves the picked entity's raw
   * fields (via the provider's OPTIONAL `getFields`, see reference-registry.ts) and copies the
   * mapped ones onto the row, with a per-target-KIND coercion (a 'select' target always needs a
   * string, an entity field might be a number) that is itself generic, keyed by FIELD KIND, never by
   * which entity or document type is involved.
   *
   * Declaring this on a field whose entity has no `getFields` implementation degrades to "the button
   * still opens the picker, but nothing gets filled" rather than a crash — the same "a rendering gap
   * must never block the form" discipline render-instance-pdf.ts already holds for a dangling
   * reference.
   */
  prefillFrom?: { entity: string; map: Record<string, string> };
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
  /**
   * Declares the STATUS EFFECT this action has on the ACTED-UPON record — see lifecycle.ts's header
   * for the full contract. In short: each entry's `from` names the starting status(es) it applies to
   * ('always' = any, including a brand-new, never-saved record), `to` is the resulting status (or,
   * for a transition with more than one honest outcome — see `DocumentActionTransition.to` — every
   * status it may result in); the runtime (documents.service.ts's runAction, via lifecycle.ts's
   * `checkTransitionResult`) refuses to let a handler persist any OTHER status once this is declared.
   *
   * Absent means this action never changes the status of the record it acts on — its effect, if any,
   * lands on a DIFFERENT record entirely ("convert-to-invoice" writes a fresh invoice; "duplicate"
   * writes a fresh copy rather than modifying the source it read), or it has no implementation to
   * observe yet ("export-accounting"). `availableWhen` then stays the sole, explicit, hand-declared
   * fact about when it may run — exactly as before this field existed.
   *
   * When PRESENT, `availableWhen` must be exactly `lifecycle.ts`'s `transitionsAvailableWhen(transitions)`
   * — descriptors set it by calling that helper (never by hand-typing a second, possibly-drifting
   * copy), and `validateLifecycle` re-derives it at registration to catch a mismatch.
   */
  transitions?: DocumentActionTransition[];
}

/** One entry of `DocumentActionDescriptor.transitions` — see that field's own comment, and
 *  lifecycle.ts's header for the full design. */
export interface DocumentActionTransition {
  /** Which starting status(es) this entry applies to. 'always' matches every status, INCLUDING a
   *  brand-new record that has no status yet (`fromStatus === undefined`) — the same "no status to
   *  match" case `isActionAvailable`'s own 'always' branch already treats as satisfied. */
  from: string[] | 'always';
  /**
   * The status the record must be in immediately after this action runs, given a `from` match — OR,
   * for an action whose SAME invocation can legitimately land on more than one outcome from the SAME
   * starting status, every status it is allowed to land on. This is what an asynchronous "send"
   * needs (TODO item 22, documents/queue/): the exact same action, replayed by the worker once a
   * record is already "sending", either succeeds (-> "sent") or, after every retry is exhausted,
   * fails (-> "send_failed") — two honestly different outcomes of ONE declared transition, not two
   * separate actions. `checkTransitionResult` (lifecycle.ts) accepts EITHER as valid; a single string
   * stays the common case (the record's next status is fully determined by `from` alone) and every
   * transition declared before this array form existed keeps meaning exactly what it always meant.
   */
  to: string | string[];
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
