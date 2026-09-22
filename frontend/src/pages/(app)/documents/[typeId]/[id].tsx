import { FileQuestion } from "lucide-react"
import { useParams } from "react-router"
import { useTranslation } from "react-i18next"

import { DocumentDetail } from "@/components/documents/document-detail"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentInstance, useDocumentType } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * One saved document's own page — `/documents/:typeId/:id` — for EVERY document type: fetches the
 * type's descriptor and the record, and hands both to DocumentDetail. Nothing here is specific to
 * "invoice" or any other type — the same rule the list page ([typeId]/index.tsx) holds: a plugin adding
 * a document type needs no page of its own, only a registered descriptor.
 *
 * DocumentDetail is keyed by the record id: navigating from one document straight to another (an
 * action that hands back a different record — "duplicate", "convert-to-invoice") is a NEW mount,
 * so the form's own snapshot (see that component's header) is never carried across two records.
 */
export default function DocumentDetailPage() {
  const { t } = useTranslation()
  const { typeId, id } = useParams()

  const { data: descriptor, isLoading: descriptorLoading, error: descriptorError } = useDocumentType(typeId)
  const { data: instance, isLoading: instanceLoading, error: instanceError } = useDocumentInstance(typeId, id)

  usePageHeader(descriptor?.label ?? typeId)

  if (descriptorLoading || instanceLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  if (descriptorError || !descriptor) {
    return (
      <div
        className="mx-auto max-w-4xl p-12 text-center text-muted-foreground"
        data-cy="document-type-unknown"
      >
        <FileQuestion className="mx-auto mb-3 h-10 w-10 opacity-50" aria-hidden="true" />
        {t("documents.form.unknownType", { typeId })}
      </div>
    )
  }

  if (instanceError || !instance) {
    return (
      <div className="mx-auto max-w-4xl p-12 text-center text-muted-foreground" data-cy="document-not-found">
        <FileQuestion className="mx-auto mb-3 h-10 w-10 opacity-50" aria-hidden="true" />
        {t("documents.detail.notFound")}
      </div>
    )
  }

  return <DocumentDetail key={instance.id} descriptor={descriptor} instance={instance} />
}
