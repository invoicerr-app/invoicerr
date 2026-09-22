/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ROW SELECTION — the 10th core field kind
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * THE PROBLEM
 * -----------
 * A document commonly needs to point at a SUBSET of another document instance's own repeatable rows
 * — not the whole document (that is what 'reference' already does), and not a fresh table of the
 * user's own rows (that is what 'array' already does). Neither kind, nor any combination of the two,
 * can express "let the user choose some of THAT document's own line items": 'reference' only ever
 * resolves to an id, with no notion of picking one row inside the thing it points at; 'array' only
 * ever describes rows that live INSIDE the current document, with no notion of a row belonging to
 * someone else. This is a structural gap in the field-kind vocabulary, not a business rule any one
 * document type happens to need — which is why it is a 10th CORE kind here, not a one-off mechanism
 * built for whichever document type first ran into it.
 *
 * THE SHAPE
 * ---------
 * A 'rowSelection' field declares three hints (types.ts):
 *   `sourceField`       the KEY of a 'reference' field elsewhere in THIS SAME document, whose current
 *                        value names the source document instance.
 *   `sourceEntity`      which EntityReferenceRegistry entry `sourceField` must resolve to — see
 *                        types.ts's own comment on why this is declared here too rather than read off
 *                        `sourceField`'s descriptor.
 *   `sourceArrayField`  the KEY of the 'array' field on the SOURCE type's own descriptor whose rows
 *                        may be selected.
 * The stored value is `RowSelectionValue` — `string[]`, the STABLE ids of the selected source rows.
 *
 * THREE DECISIONS, MADE ON PURPOSE
 * ---------------------------------
 * 1) A ROW'S IDENTITY. Selecting "row 2" only means something if rows have an identity that survives
 *    the source document being edited, reordered, or having other rows added/removed — a POSITION
 *    (array index) does not: delete row 1 and what was row 2 silently becomes row 1, which would
 *    silently repoint every existing selection at the wrong row. That is exactly the "ghost
 *    selection" this mechanism must never produce, so rows need a real, content-independent id.
 *    `array` rows had no such id before this kind existed (they were plain `{description, quantity,
 *    unitPrice, ...}` objects) — this file adds one (`ROW_ID_KEY`, stamped by `stampRowIds`) as the
 *    prerequisite this kind rests on, not as a change to what 'array' itself validates or renders.
 *    ALREADY-SAVED DOCUMENTS: stamping happens lazily, at SAVE time (DocumentsService.runAction calls
 *    `stampRowIds` right before persisting), and only for array fields at least one CURRENTLY
 *    REGISTERED 'rowSelection' field actually points at (see `referencedArrayFieldKeys` below) — a
 *    document type nothing selects from pays no identity cost at all. A row saved before this
 *    existed, or belonging to a document not yet resaved since, simply has no id yet: `listSourceRows`
 *    (resolve-row-selection.ts) EXCLUDES such rows from what can be picked, rather than fabricating a
 *    fresh id on the fly (which would not be the same id on the next read — a textbook ghost). The
 *    document becomes selectable-from the next time it is saved through the normal action pipeline,
 *    the same transition every other structural change in this system goes through; no destructive
 *    backfill migration rewrites already-stored JSON.
 *
 * 2) POINTER, NOT COPY. A selection stores the source rows' ids, not a snapshot of their values. A
 *    copy would freeze the picked lines even as the source document (still a draft, still editable)
 *    changes underneath it — and worse, a copy that has silently drifted from its source is itself a
 *    ghost: it renders fine, looks legitimate, and is quietly wrong, exactly what this mechanism must
 *    never do. A pointer has no such failure mode: dereference it, and either the row is still there
 *    (show it, live) or it is not (block, loudly — decision 3). Whether a document type ever wants to
 *    FREEZE the corrected amounts once a row is selected (e.g. for accounting reasons) is a business
 *    rule for that document type to decide and enforce itself — this core mechanism does not know
 *    what a credit note is, and does not decide that for it.
 *
 * 3) THE SOURCE THAT MOVES. If a selected row is deleted from the source, or the `sourceField`
 *    reference itself is repointed at a different document, the selection is no longer valid. This
 *    MUST block — never silently drop the missing id, never render an empty/blank row in its place.
 *    `resolve-row-selection.ts`'s `validateRowSelections` re-checks EVERY selected id against the
 *    CURRENT state of the CURRENT source, every time the document is saved (the same trust boundary
 *    `validateAgainstDescriptor` already applies to every other field, every time) — so a row that
 *    existed when it was first picked, but has since disappeared, or a reference that has since been
 *    repointed at a document without that row, fails the very next save with a message that names
 *    which row (or which field) is the problem, exactly like an unknown field kind already blocks
 *    with a message instead of silently skipping the field (validate.ts).
 *
 * WHY TWO FILES
 * -------------
 * This file is the SYNCHRONOUS half: the structural shape check (is the value an array of ids,
 * within `min`/`max`, no duplicates) that FieldKindRegistry can run the same way it runs any other
 * kind's validator — no I/O, no company scoping, pure data in, error or null out. It also owns row
 * identity (`ROW_ID_KEY`, `stampRowIds`) since that is a property of 'array' rows generally, needed
 * BECAUSE this kind exists, not a fact specific to cross-document resolution.
 * `resolve-row-selection.ts` is the ASYNC half: actually reading the source document (company-scoped,
 * through persistence.ts) to decide whether a selection still holds. That needs the same kind of
 * lookup 'reference' already declines to do synchronously (see field-kinds.ts's own comment on why
 * reference existence is not checked inline) — the difference here is that this kind's whole PURPOSE
 * is exactly that check, so it cannot skip it the way 'reference' does. Keeping the async half in its
 * own file is what keeps FieldKindRegistry/validateAgainstDescriptor pure and DB-free, and keeps this
 * mechanism entirely out of field-kinds.ts and the document descriptors themselves — DocumentsService
 * is the only caller of resolve-row-selection.ts, exactly the way it is the only caller of
 * persistence.ts's findOwnedDocument.
 */
import { randomUUID } from 'node:crypto';

import { DocumentFieldDescriptor } from '../descriptors/types';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { FieldKindRegistry, FieldValidator } from '../descriptors/field-kinds';

export const ROW_SELECTION_KIND = 'rowSelection';

/**
 * The property a row object carries its stable identity under. `$`-prefixed and unlike any key this
 * codebase's descriptors declare for a row's own sub-fields (`description`, `quantity`, `unitPrice`,
 * ...) — a descriptor must never declare a row sub-field literally named this, the same way a plugin
 * field kind must be prefixed to never collide with a future core one (field-kinds.ts).
 */
export const ROW_ID_KEY = '$rowId';

/** A 'rowSelection' field's stored value: the STABLE ids of the selected source rows — a pointer,
 *  never a copy of their values (see this file's header, decision 2). */
export type RowSelectionValue = string[];

/** The stable id already stamped on `row`, or undefined for a row nobody has stamped yet (created
 *  before this kind existed, or never saved since) — never fabricated here. */
export function rowIdOf(row: unknown): string | undefined {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const id = (row as Record<string, unknown>)[ROW_ID_KEY];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Every 'array' field key, at the top level of `typeId`'s own descriptor, that at least one
 * CURRENTLY REGISTERED 'rowSelection' field (on ANY registered type) points its `sourceArrayField`
 * at — see this file's header, decision 1, for why identity is only stamped where it is actually
 * needed. Recomputed from the registry rather than cached: `typeRegistry` is a handful of descriptors
 * built once at boot, so this is cheap, and it stays correct even if a plugin registers a new
 * 'rowSelection' field pointing at an existing type after that type's own module has loaded.
 */
export function referencedArrayFieldKeys(typeRegistry: DocumentTypeRegistry, typeId: string): Set<string> {
  const keys = new Set<string>();
  for (const type of typeRegistry.list()) {
    for (const field of type.fields) {
      if (field.kind === ROW_SELECTION_KIND && field.sourceEntity === typeId && field.sourceArrayField) {
        keys.add(field.sourceArrayField);
      }
    }
  }
  return keys;
}

/** Assigns a fresh, stable id to any row in `rows` that does not already have one — idempotent (a row
 *  that already carries ROW_ID_KEY is returned untouched) and non-mutating (a new array/objects are
 *  returned, `rows` itself is never written to). Rows that are not plain objects are left as-is: that
 *  is a shape problem `validateAgainstDescriptor` already reports, not this function's job. */
function withStableRowIds(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    if (rowIdOf(row) !== undefined) return row;
    return { ...(row as Record<string, unknown>), [ROW_ID_KEY]: randomUUID() };
  });
}

/**
 * Walks `fields` the same way validateAgainstDescriptor recurses into 'array' rows, and returns a NEW
 * data object where every 'array' field listed in `stampable` has had `withStableRowIds` applied —
 * `data` itself is never mutated. Called once by DocumentsService.runAction, on the data about to be
 * persisted, right after it has passed validation (never on data that failed it).
 */
export function stampRowIds(
  fields: DocumentFieldDescriptor[],
  data: Record<string, unknown>,
  stampable: Set<string>,
): Record<string, unknown> {
  if (stampable.size === 0) return data;

  const result: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if (field.kind !== 'array') continue;
    const value = result[field.key];
    if (!Array.isArray(value)) continue;

    if (stampable.has(field.key)) {
      result[field.key] = withStableRowIds(value);
    }
    // Nested arrays-of-arrays are not a shape any current descriptor uses, but recursing costs
    // nothing and keeps this consistent with validateAgainstDescriptor's own recursion.
    if (field.fields?.length) {
      result[field.key] = (result[field.key] as unknown[]).map((row) =>
        row && typeof row === 'object' && !Array.isArray(row)
          ? stampRowIds(field.fields as DocumentFieldDescriptor[], row as Record<string, unknown>, stampable)
          : row,
      );
    }
  }
  return result;
}

/**
 * The SYNCHRONOUS, structural half of this kind's validation (see this file's header for why the
 * cross-document existence check is a separate, async mechanism in resolve-row-selection.ts): proves
 * only that the value is SHAPED like a selection — a list of non-empty id strings, no duplicate pick,
 * within `min`/`max` — the same division of labour 'array' itself already has (field-kinds.ts checks
 * shape/bounds; validateAgainstDescriptor's own recursion checks row-by-row content).
 */
export const validateRowSelectionShape: FieldValidator = (value, { field }) => {
  if (!Array.isArray(value)) return 'must be a list of selected rows.';
  if (!value.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    return 'must be a list of selected row ids.';
  }
  if (new Set(value).size !== value.length) return 'selects the same row more than once.';
  if (field.min !== undefined && value.length < field.min) return `must select at least ${field.min} row(s).`;
  if (field.max !== undefined && value.length > field.max) return `must select at most ${field.max} row(s).`;
  return null;
};

/** Registers this kind's structural validator — the ONE line field-kinds.ts's registerCoreFieldKinds
 *  calls, so the mechanism's actual logic stays entirely in this directory rather than inline there. */
export function registerRowSelectionFieldKind(registry: FieldKindRegistry): void {
  registry.register(ROW_SELECTION_KIND, validateRowSelectionShape);
}
