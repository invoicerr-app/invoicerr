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
  /** 'select' — TODO_PRODUIT.md T4-d: locks this field's value to a SIBLING 'reference' field's
   *  resolved entity (e.g. a credit note's own `currency` following its `invoice`). `field` names
   *  the sibling 'reference' field; `entity` is which EntityReferenceRegistry entry it resolves
   *  against (duplicated rather than cross-read off `field`'s own descriptor, same self-containment
   *  as `sourceField`/`sourceEntity` below); `sourceKey` is the key to copy off that entity's raw
   *  `getFields()` result — see field-renderers/primitive-fields.tsx's 'select' renderer for the
   *  mechanism (pre-fills, disables the control once resolved) and the backend's own
   *  `DocumentFieldDescriptor.lockedFromReference` for the full "why", including the server-side
   *  hard block this screen convenience is backed by, never a substitute for it. */
  lockedFromReference?: { field: string; entity: string; sourceKey: string }
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
  /** 'array' only: lets each ROW offer a "fill from catalog" button — see field-renderers/
   *  array-field.tsx and the backend's `DocumentFieldDescriptor.prefillFrom` (descriptors/types.ts)
   *  for the full mechanism. `entity` names the EntityReferenceRegistry entry backing the picker
   *  (e.g. "article"); `map` pairs a ROW subfield KEY with a field name on that entity's own raw
   *  record. Opaque to every kind but the array renderer — it never gets interpreted by field kind. */
  prefillFrom?: { entity: string; map: Record<string, string> }
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
  /**
   * The country policy's own per-status narrowing (see the backend's
   * `DocumentActionDescriptorView.policyRestrictedToStatuses`) — a SEPARATE fact from
   * `availableWhen`, deliberately never merged into it: `availableWhen: "always"` means "every
   * existing status, AND a brand-new, never-saved record", and a country restriction only ever
   * narrows the EXISTING-status half (a never-saved record has no status for it to have an opinion
   * about — the same reasoning the backend's own `runAction` per-status 409 check holds). Composed
   * with `availableWhen` by `isActionAvailable` below, the one place both are read together.
   */
  policyRestrictedToStatuses?: string[]
  /**
   * The STATUS EFFECT this action has on the record it acts on — mirrors the backend's own
   * `DocumentActionDescriptor.transitions` (descriptors/lifecycle.ts) exactly, wire shape unchanged.
   * Absent means this action never changes the acted-upon record's own status (its effect, if any,
   * lands on a different record entirely — "convert-to-invoice", or a third-party "duplicate").
   * Used ONLY to render a human-facing "this will move it from X to Y" hint (document-form.tsx) —
   * never to decide whether the action is offered at all, which stays `availableWhen`'s job alone.
   */
  transitions?: DocumentActionTransition[]
}

/** One entry of `DocumentActionDescriptor.transitions` — see that field's own comment. */
export interface DocumentActionTransition {
  /** 'always' matches every status, INCLUDING a brand-new, never-saved record. */
  from: string[] | "always"
  /** The resulting status — or, for a transition with more than one honest outcome (the async "send"
   *  shape, TODO.md item 22: the worker's replay either succeeds or, after every retry, fails), every
   *  status it may land on. Mirrors the backend's own `DocumentActionTransition.to` exactly. */
  to: string | string[]
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

/** One status a document TYPE's instances can be in — mirrors the backend's
 *  `DocumentStatusDescriptor` (descriptors/types.ts). Plain data, not an i18n key. */
export interface DocumentStatusDescriptor {
  id: string
  label: string
}

export interface DocumentTypeDescriptor {
  id: string
  label: string
  fields: DocumentFieldDescriptor[]
  actions: DocumentActionDescriptor[]
  listItem?: DocumentListItemHint
  /** The type's lifecycle — see the backend's `DocumentTypeDescriptor.statuses`/`initialStatus`.
   *  Absent for a type that never declared one (the backend's own opt-out). */
  statuses?: DocumentStatusDescriptor[]
  initialStatus?: string
  /** Mirrors the backend's `DocumentTypeDescriptor.numbering` (descriptors/types.ts) — which status
   *  this type's instances receive a NUMBER on first entering. Absent means this type is NEVER
   *  numbered (e.g. "expense", "credit-note") — the one flag every number-displaying UI (the list
   *  card, the edit dialog, the PDF) gates on, so a type that never declares this shows no number
   *  badge at all rather than a permanent "no number yet" placeholder that would never make sense. */
  numbering?: { onEnterStatus: string }
}

/** `statuses[].label` for `statusId`, falling back to the raw id when the descriptor names no
 *  lifecycle at all or this particular status isn't in it — the same "degrade honestly, never
 *  crash" rule the rest of this generic model already holds for a descriptor/data mismatch. */
export function statusLabel(descriptor: DocumentTypeDescriptor, statusId: string): string {
  return descriptor.statuses?.find((s) => s.id === statusId)?.label ?? statusId
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
  /** Set the first time this record enters its type's own `numbering.onEnterStatus` — null/absent
   *  before that (a draft has none, and a type with no `numbering` at all never sets it). Never
   *  cleared or reassigned once set — see the backend's `DocumentInstance` schema comment. */
  number?: number | null
  /** `number`, already formatted through the company's own pattern at the moment it was taken — see
   *  the backend's numbering/format-number.ts. Show this verbatim; never reformat `number` yourself. */
  displayNumber?: string | null
  /** Mirrors the backend's `DocumentInstance.lastActionError` — the error from the most recent
   *  FAILED asynchronous action (a "send" that ended in "send_failed", TODO.md item 22). Null/absent
   *  once cleared by any later write. Shown verbatim, never an i18n key — same convention as
   *  `ActionResult.message`. */
  lastActionError?: string | null
}

/**
 * A payment recorded against a document instance — mirrors the backend's `DocumentPaymentResult`
 * (settlement/payments.ts). NOT a document type of its own (see that file's header): no lifecycle, no
 * status, just a record hanging off an existing one.
 *
 * `amountMinor`/`currency` are the amount ACTUALLY received, in the payment's OWN currency —
 * unchanged since always. `documentAmountMinor`/`conversionRate`/`conversionRateAsOf`/
 * `conversionSource` are new (TODO_PRODUIT.md T3): the settlement-relevant figure, already converted
 * into the document's own currency at a DATED rate, pinned at record time. `conversionRate` is null
 * exactly when no conversion was applied (the payment already matched the document's own currency).
 */
export interface DocumentPayment {
  id: string
  documentId: string
  amountMinor: number
  currency: string
  documentAmountMinor: number
  conversionRate: number | null
  conversionRateAsOf: string | null
  conversionSource: string | null
  method: string | null
  paidAt: string
  note: string | null
  createdAt: string
}

/** The balance computed from a document's totals, its recorded payments, and the credit notes
 *  correcting it (item 8 of the root TODO — "le lettrage") — mirrors the backend's
 *  `DocumentSettlement` (settlement/compute-settlement.ts). See that file's header on why a credit
 *  note is never merged into `paidMinor`, and why the excess is ONE field (`excessMinor`, renamed
 *  from the earlier `overpaidMinor` — an over-CREDITED document with zero payments was never
 *  "overpaid") surfaced rather than discarded. */
export interface DocumentSettlement {
  totalGrossMinor: number
  paidMinor: number
  creditedMinor: number
  outstandingMinor: number
  excessMinor: number
  settled: boolean
}

/** One credit note counted (or ignored — see `DocumentSettlementResult.warnings`) against a
 *  document's balance — mirrors the backend's `DocumentCreditResult` (settlement/credits.ts). */
export interface DocumentCredit {
  id: string
  displayNumber: string | null
  amountMinor: number
  currency: string
}

/** What `GET /documents/:id/settlement` returns — mirrors the backend's `DocumentSettlementView`.
 *  `totals` is narrowed to only what the settlement UI needs (never the full line-by-line breakdown
 *  DocumentTotals already renders elsewhere via totals-calculator.ts's OWN, client-side copy).
 *  `credits`/`warnings` are new (item 8, "le lettrage"): always present, empty for any type that
 *  isn't an invoice. */
export interface DocumentSettlementResult {
  totals: { currency: string | null; grossMinor: number }
  payments: DocumentPayment[]
  credits: DocumentCredit[]
  warnings: string[]
  settlement: DocumentSettlement
}

/** Root TODO item 14 ("archivage légal ⚖") — one artifact this archive covers, mirrors the backend's
 *  `StoredArtifactMeta` (documents/archive/persistence.ts). Never the bytes themselves. */
export interface DocumentArchiveArtifact {
  role: string
  mime: string
  byteLength: number
  sha256: string
}

/** One row from `GET /documents/:id/archives` — mirrors the backend's `DocumentArchiveResult`. A
 *  document can have several (one per successful delivery — a re-send after "send_failed" archives
 *  again, see the backend's `DocumentArchive` schema comment), never a "current" singleton.
 *  `retentionUntil`/`retentionBasis` are both null ONLY for a country with no declared retention rule
 *  at all — `retentionBasis` is otherwise ALWAYS set, even alongside a null `retentionUntil`, saying
 *  so plainly (never an invented duration). */
export interface DocumentArchive {
  id: string
  contentHash: string
  uri: string
  artifacts: DocumentArchiveArtifact[]
  archivedAt: string
  retentionUntil: string | null
  retentionBasis: string | null
}

/** What `POST /documents/:id/archives/:archiveId/verify` returns — mirrors the backend's
 *  `ArchiveVerificationResult`. RE-HASHES the bytes stored on disk on every call; never a cached
 *  verdict. */
export type ArchiveVerificationResult =
  | { status: "intact" }
  | { status: "corrupted"; details: { role: string; expected: string; actual: string | null }[] }

/** One row from `GET /documents/:id/authority-events` — mirrors the backend's
 *  `DocumentAuthorityEventResult` (post-deposit conformity tracking, root TODO item 10's own named
 *  remainder). Append-only, most recent (`observedAt`) first. `statusText`/`reason` are shown
 *  VERBATIM, never translated — the same convention `ActionResult.message`/
 *  `DocumentInstance.lastActionError` already hold: this is what the ISSUING PLATFORM itself said,
 *  not this app's own copy. `statusCode` is either a real platform code (`"fr:202"`, `"pl:200"`, …)
 *  or one of the two SWEEP-OWNED synthetic codes, `"poll:gave-up"`/`"poll:blocked"` — see
 *  `document-conformity-section.tsx`'s own `computeConformityVerdict` for how these map to a badge. */
export interface DocumentAuthorityEvent {
  id: string
  providerId: string
  statusCode: string
  statusText: string | null
  reason: string | null
  observedAt: string
}

/** What `POST /documents/:id/share-link` returns — mirrors the backend's `CreatedShareLink`. The
 *  ONLY place `token`/`path` ever appear: this response is shown once (share-link-dialog.tsx keeps
 *  it in local state only, never persisted), and `GET /documents/:id/share-links` afterwards never
 *  carries either field again — see `ShareLinkSummary` below. */
export interface CreatedShareLink {
  id: string
  token: string
  path: string
  expiresAt: string
}

/** One row from `GET /documents/:id/share-links` — mirrors the backend's `ShareLinkSummary`.
 *  Deliberately carries NO `token`/`tokenHash`: re-displaying a past link's URL is not merely
 *  refused by the screen, the API response makes it impossible. */
export interface ShareLinkSummary {
  id: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  active: boolean
}

export interface EntityReferenceOption {
  id: string
  label: string
}

/**
 * Composes the descriptor's OWN `availableWhen` with the country policy's optional per-status
 * narrowing (`policyRestrictedToStatuses`) — the one place both facts are read together, so every
 * caller (document-form.tsx, document-list.tsx) gets the composition "for free" by calling this
 * exactly as before, with no country-awareness of its own.
 *
 * The restriction is skipped entirely for `status === undefined` (a brand-new, never-saved record):
 * see `policyRestrictedToStatuses`'s own comment for why — a country's per-status rule narrows which
 * EXISTING statuses the action may run from, never whether a fresh record may reach its first save.
 */
export function isActionAvailable(action: DocumentActionDescriptor, status: string | undefined): boolean {
  const availableByDescriptor =
    action.availableWhen === "always" || (status !== undefined && action.availableWhen.includes(status))
  if (!availableByDescriptor) return false

  if (status !== undefined && action.policyRestrictedToStatuses) {
    return action.policyRestrictedToStatuses.includes(status)
  }
  return true
}

/**
 * Mirrors the backend's own `resolveTransitionTarget` (descriptors/lifecycle.ts) exactly: the status
 * (or, for a transition with more than one honest outcome, every status — see
 * `DocumentActionTransition.to`'s own comment) this action's declared `transitions` say a record
 * currently at `fromStatus` (undefined = not saved yet) will move to. Undefined when the action
 * declares no `transitions` at all (its effect, if any, lands on a DIFFERENT record —
 * "convert-to-invoice", "duplicate") or none of them matches.
 *
 * Display-only on this side: the backend is what actually ENFORCES the transition (runAction) — this
 * is only ever read to render the "this will move it from X to Y" hint (document-form.tsx), never to
 * decide whether an action may run, which stays `isActionAvailable`'s job alone.
 */
export function resolveTransitionTarget(
  action: DocumentActionDescriptor,
  fromStatus: string | undefined,
): string | string[] | undefined {
  if (!action.transitions) return undefined
  for (const transition of action.transitions) {
    if (transition.from === "always") return transition.to
    if (fromStatus !== undefined && transition.from.includes(fromStatus)) return transition.to
  }
  return undefined
}

/**
 * A RECURRENCE (root TODO item 5) — mirrors the backend's `DocumentScheduleRecord`
 * (schedules/schedule.persistence.ts). "Replay `actionId` on `sourceDocumentId`, on this cadence" —
 * generic, the same way `DocumentInstance` names no document type: the invoice case (cadence ===
 * "monthly", actionId === "duplicate") is the FIRST consumer, never something this shape hard-codes.
 */
export interface DocumentSchedule {
  id: string
  typeId: string
  sourceDocumentId: string
  actionId: string
  /** One of "weekly" | "monthly" | "quarterly" | "yearly" — plain string, same convention as
   *  `DocumentInstance.status`: closed at the backend's own cadence.ts, not typed as a union here. */
  cadence: string
  anchorDay: number | null
  nextRunAt: string
  lastRunAt: string | null
  /** The most recent occurrence's failure, if any — VISIBLE, never a silent gap (see the backend's
   *  `DocumentSchedule.lastError` schema comment). Cleared by the next SUCCESSFUL occurrence. */
  lastError: string | null
  enabled: boolean
  /** Today, only `{ thenSend?: boolean }` — see the backend's duplicate-extension.ts. */
  params: Record<string, unknown> | null
  createdAt: string
}
