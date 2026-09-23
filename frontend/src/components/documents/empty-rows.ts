import type { DocumentFieldDescriptor } from "@/components/documents/types"

/**
 * Mirrors the backend's `descriptors/validate.ts#dropEmptyRows` (deliberately duplicated, not
 * shared — see types.ts's own header on why front and back keep independent copies of the same wire
 * shape): the SAME "empty" rule, field by field, applied on the CLIENT before a save-triggering
 * action ever runs (`use-document-form.ts`'s `validate` callback). See that backend function's own
 * header for the full "why" — issue #365, "empty line items should not survive a save". Running the
 * exact same rule here, not merely relying on the backend's own copy, is what lets the row actually
 * DISAPPEAR from the screen instead of the save being blocked by `form.trigger()` on that row's own
 * now-unreachable required fields (description/quantity/unit/unitPrice/vatRate on an invoice line):
 * react-hook-form validates whatever is still IN the form the instant this runs, so the row has to be
 * gone from the live form state, not merely absent from the eventual request body.
 *
 * `undefined`/`null`/`""` (a field never touched, or typed then cleared) and a bare number `0` (a
 * quantity or a price typed as zero) both count as "nothing entered" — never a required-field
 * satisfaction question (an untouched but genuinely 0 `discountPercent` is fine on its own elsewhere;
 * this only asks whether the ROW AS A WHOLE has anything worth keeping). A row where the user typed
 * ANYTHING real in even ONE field — only a price, only a description — is left exactly as it is,
 * required-field gaps included: `form.trigger()` still asks for whatever that row is still missing,
 * exactly as it always has.
 */
function isEmptyRowValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true
  return typeof value === "number" && value === 0
}

function isEmptyRow(rowFields: DocumentFieldDescriptor[], row: unknown): boolean {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return false
  const record = row as Record<string, unknown>
  return rowFields.every((rowField) => isEmptyRowValue(record[rowField.key]))
}

/**
 * Drops every row of every declared 'array' field whose subfields are ALL empty. Returns a NEW
 * object — never mutates `data` in place — mirroring the backend function's own discipline; the
 * caller (`use-document-form.ts`) is the one that decides whether/how to write the result back into
 * react-hook-form's own state (`form.setValue`, not a second `useFieldArray` instance — see that
 * hook's own header on why `setValue` is the one channel a SEPARATE `useFieldArray` instance, e.g.
 * `field-renderers/array-field.tsx`'s own, actually reacts to).
 */
export function dropEmptyRows(
  fields: DocumentFieldDescriptor[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...data }
  for (const field of fields) {
    if (field.kind !== "array" || !field.fields?.length) continue
    const rows = cleaned[field.key]
    if (!Array.isArray(rows)) continue
    const rowFields = field.fields
    cleaned[field.key] = rows.filter((row) => !isEmptyRow(rowFields, row))
  }
  return cleaned
}
