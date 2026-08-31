import { useTranslation } from "react-i18next"

import { DocumentForm } from "@/components/documents/document-form"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface DocumentUpsertDialogProps {
  descriptor: DocumentTypeDescriptor
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present = editing that instance; absent = a brand-new, unsaved draft. */
  instance?: DocumentInstance
  /**
   * Seed values for a BRAND-NEW record's form — ignored once `instance` is set (an existing
   * record's own `data` always wins; there is nothing left to "seed"). Generic on purpose, not tied
   * to any one document type: the received-invoice upload flow
   * (custom/received-invoice-upload-button.tsx, root TODO item 18) is the one real user today,
   * pre-filling extracted fields (and the system-only `fileRef`/`fileName`/`fileMime` — see
   * received-invoice.descriptor.ts's own header on why those are never declared `fields`) into an
   * otherwise-blank create dialog before the user reviews and confirms.
   */
  initialData?: Record<string, unknown>
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * The create/edit surface for ANY document type, as ONE modal — where the old, per-type screens had
 * an `InvoiceUpsert` and, separately, a `QuoteUpsert` doing this by hand for each (see
 * `avant-refonte-documents` in git history), this is what makes a third type need no dialog of its
 * own: it only ever reads `descriptor` and, optionally, `instance`.
 *
 * Deliberately stays OPEN across a successful action on the SAME document type (e.g. "save-draft"
 * then, in the same sitting, "send"): DocumentForm already tracks its own current id/status
 * internally once the first save happens (see its onDocumentUpdate), so there is nothing for this
 * wrapper to resync — closing here would force a reopen just to keep working on what is still the
 * same record. It closes itself only when the action's result is a DIFFERENT document type (the
 * quote's "convert-to-invoice" handing back a fresh invoice): this dialog cannot show a foreign
 * type's fields, so the page (not this component) navigates to that type's own screen instead — see
 * [typeId].tsx's onActionSuccess, which this component's own prop of the same name only forwards.
 */
export function DocumentUpsertDialog({
  descriptor,
  open,
  onOpenChange,
  instance,
  initialData,
  onActionSuccess,
}: DocumentUpsertDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        data-cy={instance ? "document-edit-dialog" : "document-create-dialog"}
      >
        <DialogHeader>
          <DialogTitle>
            {instance
              ? t("documents.form.editingTitle", { label: descriptor.label })
              : t("documents.form.newTitle", { label: descriptor.label })}
          </DialogTitle>
        </DialogHeader>

        <DocumentForm
          key={instance?.id ?? "new"}
          descriptor={descriptor}
          documentId={instance?.id}
          initialData={instance?.data ?? initialData}
          status={instance?.status}
          displayNumber={instance?.displayNumber}
          lastActionError={instance?.lastActionError}
          onActionSuccess={onActionSuccess}
        />
      </DialogContent>
    </Dialog>
  )
}
