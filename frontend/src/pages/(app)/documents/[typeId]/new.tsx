import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate, useParams } from "react-router"

import { DocumentCreateDialog } from "@/components/documents/document-create-dialog"
import { DocumentTypeIcon } from "@/components/documents/document-type-icon"
import { DocumentLoadState } from "@/components/documents/document-load-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentType, useDocumentTypeSummary } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * A new record of any type, as its own page: the form on the left, the document composing itself on
 * the right. A caller that wants the form pre-filled (a correction, a conversion) navigates here with
 * `state.initialData`; leaving the page goes back to the type's list.
 */
export default function NewDocumentPage() {
  const { t } = useTranslation()
  const { typeId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: descriptor, isLoading, error, refetch } = useDocumentType(typeId)
  // Read once: the seed belongs to the visit that brought it, not to later re-renders.
  const [initialData] = useState(
    () => (location.state as { initialData?: Record<string, unknown> } | null)?.initialData,
  )

  const summary = useDocumentTypeSummary(typeId)
  const label = descriptor?.label ?? summary?.label
  usePageHeader(
    label ? t("documents.form.newTitle", { label }) : "",
    <DocumentTypeIcon icon={descriptor?.icon ?? summary?.icon} />,
  )

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 pt-1 md:px-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (error || !descriptor) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <DocumentLoadState
          error={error}
          notFoundTitle={t("documents.form.unknownType", { typeId })}
          notFoundDataCy="document-type-unknown"
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  return (
    <DocumentCreateDialog
      descriptor={descriptor}
      presentation="page"
      open
      onOpenChange={(open) => {
        if (!open) void navigate(`/documents/${descriptor.id}`)
      }}
      initialData={initialData}
    />
  )
}
