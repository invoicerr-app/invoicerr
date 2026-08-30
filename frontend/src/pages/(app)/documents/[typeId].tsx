import { FileQuestion } from "lucide-react"
import { useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useTranslation } from "react-i18next"

import { DocumentList } from "@/components/documents/document-list"
import { DocumentUpsertDialog } from "@/components/documents/document-upsert-dialog"
import type { DocumentInstance } from "@/components/documents/types"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentInstances, useDocumentType } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * The one generic page: fetches a document type's descriptor and its saved instances, and renders
 * DocumentList (the table) plus DocumentUpsertDialog (create/edit) from them. Nothing here is
 * specific to "quote" or any other type — a plugin adding a document type needs no page of its own,
 * only a registered descriptor (and, on the frontend, a renderer per any new field kind it
 * introduces — see field-renderers/index.ts — plus, optionally, a custom slot component registered
 * in custom-registrations.ts, the one place allowed to name a type).
 */
export default function DocumentTypePage() {
  const { t } = useTranslation()
  const { typeId } = useParams()
  const navigate = useNavigate()

  const { data: descriptor, isLoading, error } = useDocumentType(typeId)
  const { data: instances = [], isLoading: instancesLoading } = useDocumentInstances(typeId)

  // undefined = the dialog is closed; null = creating a brand-new draft; a DocumentInstance = editing
  // that one. The list already hands over each instance's FULL `data` (see the backend's
  // listDocuments, which selects everything), so editing never needs a second fetch.
  const [dialogTarget, setDialogTarget] = useState<DocumentInstance | null | undefined>(undefined)

  usePageHeader(descriptor?.label ?? typeId)

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !descriptor) {
    return (
      <div
        className="max-w-4xl mx-auto p-12 text-center text-muted-foreground"
        data-cy="document-type-unknown"
      >
        <FileQuestion className="mx-auto h-10 w-10 mb-3 opacity-50" />
        {t("documents.form.unknownType", { typeId })}
      </div>
    )
  }

  const handleActionSuccess = (result: DocumentInstance) => {
    // An action can create/update an instance of a DIFFERENT document type (e.g. the quote's
    // "convert-to-invoice" hands back a brand-new INVOICE) — this page only ever knows how to show
    // ITS OWN type's fields (they came from `descriptor`), so it navigates to the other type's own
    // page instead of trying to render a foreign record in this dialog. Nothing here names which
    // type that might be: `result.typeId` is read from the action's own response.
    //
    // Same-type success needs nothing here at all: DocumentForm already tracks its own current
    // id/status once the first save happens, and the list refetches on its own (useRunDocumentAction
    // invalidates the "documents" query) — so the dialog just stays open, showing the same record.
    if (result.typeId !== typeId) {
      setDialogTarget(undefined)
      navigate(`/documents/${result.typeId}`)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6" data-cy="document-type-page">
      <DocumentList
        descriptor={descriptor}
        instances={instances}
        isLoading={instancesLoading}
        onCreate={() => setDialogTarget(null)}
        onEdit={(instance) => setDialogTarget(instance)}
        onActionSuccess={handleActionSuccess}
      />

      {dialogTarget !== undefined && (
        <DocumentUpsertDialog
          descriptor={descriptor}
          open
          onOpenChange={(open) => !open && setDialogTarget(undefined)}
          instance={dialogTarget ?? undefined}
          onActionSuccess={handleActionSuccess}
        />
      )}
    </div>
  )
}
