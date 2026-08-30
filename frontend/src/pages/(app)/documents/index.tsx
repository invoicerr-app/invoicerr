import { FileStack } from "lucide-react"
import { Navigate } from "react-router"
import { useTranslation } from "react-i18next"

import { Skeleton } from "@/components/ui/skeleton"
import { useAvailableDocumentTypes } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * There is no "Documents" screen of its own — the sidebar's Documents group (components/sidebar.tsx)
 * leads straight to each available type's own page ([typeId].tsx). This route exists only so `/documents`
 * itself is never a dead end: it redirects to the first document type the active company's COUNTRY
 * makes available, or — if none are — explains why, by the REASON the backend computed
 * (country-policy/country-policy.ts's resolveAvailableDocumentTypes). A blank screen here would read
 * as a bug; this is the "jamais un écran vide" requirement made concrete.
 */
export default function DocumentsIndexPage() {
  const { t } = useTranslation()
  const { data, isLoading } = useAvailableDocumentTypes()

  usePageHeader(t("documents.index.title"))

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (data && data.types.length > 0) {
    return <Navigate to={`/documents/${data.types[0].id}`} replace />
  }

  return (
    <div
      className="mx-auto max-w-2xl p-12 text-center text-muted-foreground"
      data-cy="documents-index-no-types"
    >
      <FileStack className="mx-auto mb-3 h-10 w-10 opacity-50" />
      <p>{data?.reason ?? t("documents.index.empty")}</p>
    </div>
  )
}
