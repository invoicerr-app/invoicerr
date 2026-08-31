import type { ComponentType } from "react"

import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"

/** What a custom slot component receives: the same descriptor/instance the generic renderer already
 *  has in hand at that point — nothing narrower. A custom component reads whatever it needs off
 *  `instance.data` itself; the registry does not try to guess which fields matter to it.
 *
 *  `instance` is optional because not every slot is per-RECORD: "list-header-extra" (see below)
 *  renders once for the whole list, before any instance exists to act on — the received-invoice
 *  upload button is the one real user of that shape today (custom/received-invoice-upload-button.
 *  tsx). Every per-row slot ("list-row-extra") still always receives one in practice; this stays a
 *  single, uniform prop shape rather than a second interface, the same way a document field's own
 *  optional hints (currencyField, entity, …) all live on one flat `DocumentFieldDescriptor` instead
 *  of a per-kind union. */
export interface DocumentCustomSlotProps {
  descriptor: DocumentTypeDescriptor
  instance?: DocumentInstance
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
 *    descriptor itself declares (see document-list.tsx). Registered for "invoice"
 *    (custom/invoice-preview-button.tsx) and for "received-invoice"
 *    (custom/received-invoice-download-button.tsx, root TODO item 18).
 *  - "list-header-extra": rendered in the document list's HEADER, next to the generic "New <type>"
 *    button (document-list.tsx) — additive, never a replacement for it. The one real user is
 *    custom/received-invoice-upload-button.tsx: uploading a file is a genuinely different entry
 *    point into creating a record than the generic blank form, so it gets its own button rather than
 *    trying to fold "pick a file" into the generic create dialog for every type.
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
