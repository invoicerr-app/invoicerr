import type { FieldRendererProps } from "./registry"

/**
 * Basic stock management ("gestion de stock basique") — the renderer for 'hiddenReference' (e.g. a
 * line's `articleId`). Mirrors the backend's render-html.ts skipping this kind entirely for the PDF:
 * this is the CREATE/EDIT FORM's own equivalent, drawing nothing at all rather than DocumentField's
 * usual "unsupported kind" fallback (document-field.tsx) — that fallback exists for a kind nobody
 * registered a renderer FOR, which is a configuration bug; 'hiddenReference' registers this on
 * purpose, because there is nothing for a human to see or edit here in the first place.
 *
 * The value itself is never lost by rendering nothing: array-field.tsx's row already carries this
 * key in its `emptyRow` object (built from every row subfield, this one included), and its own
 * `RowPrefillPicker` sets it directly via react-hook-form's `setValue` the moment an article is
 * picked — neither of those needs a mounted control to work. A line typed by hand, with no article
 * ever picked, simply keeps this key `undefined`, exactly like every other unset optional field.
 */
export function HiddenReferenceField(_props: FieldRendererProps) {
  return null
}
