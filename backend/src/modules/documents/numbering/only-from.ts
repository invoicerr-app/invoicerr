/**
 * The single predicate behind `DocumentTypeDescriptor.numbering.onlyFrom` (descriptors/types.ts) - kept
 * as its own tiny file, not inlined at each of the THREE call sites that need it
 * (documents.service.ts's post-handler hook, actions/async-send.ts's `numberOnEnqueue` gate, and
 * lifecycle.ts's own boot-time validation of the list itself), so all three read the exact same rule
 * rather than three hand-written copies that could quietly drift from one another - the same
 * discipline `transitionsAvailableWhen` already holds for `availableWhen` vs. `transitions`.
 */

/** Only the two fields this predicate actually reads - never the full `DocumentTypeDescriptor['numbering']`
 *  type, so a caller building a bespoke literal (lifecycle.spec.ts) never has to satisfy fields it has
 *  no reason to invent. */
export interface NumberingOnlyFromGate {
  onlyFrom?: string[];
}

/**
 * Whether a record arriving at `numbering.onEnterStatus` FROM `previousStatus` may actually be
 * numbered. `numbering.onlyFrom` absent means "any prior status" - the original, unrestricted
 * behaviour quote/invoice still have (see `types.ts`'s own header). When it IS declared,
 * `previousStatus` must be a defined status that is a member of that list: `undefined` (a brand-new,
 * never-saved record reaching `onEnterStatus` directly, which no shipped type's own lifecycle allows
 * today, since every one of them starts at a different `initialStatus`) is treated as NOT allowed,
 * deliberately conservative - see `onlyFrom`'s own doc comment on why a status this feature cannot
 * positively confirm must never be trusted to mean "genuinely arrived the intended way".
 */
export function isNumberingAllowedFrom(
  numbering: NumberingOnlyFromGate | undefined,
  previousStatus: string | undefined,
): boolean {
  if (numbering?.onlyFrom === undefined) return true;
  return previousStatus !== undefined && numbering.onlyFrom.includes(previousStatus);
}
