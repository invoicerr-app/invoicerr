import type { ComponentType } from "react"

import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"

/** What a custom slot component receives: the same descriptor/instance the generic renderer already
 *  has in hand at that point — nothing narrower. A custom component reads whatever it needs off
 *  `instance.data` itself; the registry does not try to guess which fields matter to it. */
export interface DocumentCustomSlotProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
}

export type DocumentCustomComponent = ComponentType<DocumentCustomSlotProps>

/**
 * Open registry of per-(document type, slot) UI extensions — the mechanism that lets a document
 * type add code IN ADDITION to the generic render, never IN PLACE of it: the generic list/form
 * render exactly as they always do, unconditionally, and only ADD whatever happens to be registered
 * here for their own (typeId, slot). Nothing that READS this registry (document-list.tsx today)
 * ever names a document type — only a REGISTRATION does, and by design that can only happen in one
 * place: custom-registrations.ts, the sole file allowed to import a type-specific component.
 *
 * Slots currently consulted by the generic renderer:
 *  - "list-row-extra": rendered in the document list's per-row action area, after every action the
 *    descriptor itself declares (see document-list.tsx). The one real user of this today is
 *    custom/invoice-preview-button.tsx, registered for "invoice" alone.
 *
 * A future slot (e.g. inside the create/edit modal) is added the same way: pick a new slot name,
 * consult it from wherever it renders, and it stays unused everywhere nothing is registered for it.
 */
const registry = new Map<string, DocumentCustomComponent>()

function slotKey(typeId: string, slot: string): string {
  return `${typeId}::${slot}`
}

export function registerDocumentCustomComponent(
  typeId: string,
  slot: string,
  component: DocumentCustomComponent,
): void {
  registry.set(slotKey(typeId, slot), component)
}

export function getDocumentCustomComponent(
  typeId: string,
  slot: string,
): DocumentCustomComponent | undefined {
  return registry.get(slotKey(typeId, slot))
}
