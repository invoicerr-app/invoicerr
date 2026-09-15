import type { DocumentFieldDescriptor, DocumentTypeDescriptor } from "@/components/documents/types"

/** Looks up `keys` among `descriptor.fields` (top-level only), in order, silently DROPPING any key
 *  that doesn't resolve — a typo in `listItem`, or a field a country overlay removed for this
 *  company (see the backend's company-view.ts) — rather than throwing. Shared by the list card's
 *  title and secondary-info line (document-list.tsx) and the detail page's header
 *  (document-detail.tsx): all are "a few named fields, rendered by kind", never anything a document
 *  TYPE has to special-case. */
export function resolveListFields(
  descriptor: DocumentTypeDescriptor,
  keys: string[] | undefined,
): DocumentFieldDescriptor[] {
  if (!keys?.length) return []
  return keys
    .map((key) => descriptor.fields.find((field) => field.key === key))
    .filter((field): field is DocumentFieldDescriptor => !!field)
}

export function isEmptyFieldValue(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}
