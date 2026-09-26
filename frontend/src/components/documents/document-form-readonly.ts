import { createContext, useContext } from "react"

/**
 * Whether the document form currently rendering is READ-ONLY - set once, at the root
 * (`document-form.tsx#DocumentFormFields`), whenever `saveDraftLockNotice` fires for this record
 * (issue #468: an issued invoice/credit-note, a signed/accepted quote, or a country-policy lock - see
 * that function's own header, action-presentation.ts). The notice already SAYS the record can't be
 * saved; this is what makes the form AGREE with it instead of still looking editable underneath.
 *
 * A plain boolean context, not a prop threaded through every field renderer and every nested row
 * (`array-field.tsx` renders each line's own subfields through the SAME `DocumentField`, recursively)
 * - the alternative would mean every kind's own props gaining a `readOnly` field just to forward it
 * one level further, for a fact that is genuinely global to the whole form, never per-field. Defaults
 * to `false` outside a provider, which is exactly today's pre-existing behavior for a renderer
 * mounted in isolation (its own `*.spec.tsx`, none of which wrap `<DocumentFormFields>`).
 */
const DocumentFormReadOnlyContext = createContext(false)

export const DocumentFormReadOnlyProvider = DocumentFormReadOnlyContext.Provider

export function useDocumentFormReadOnly(): boolean {
  return useContext(DocumentFormReadOnlyContext)
}
