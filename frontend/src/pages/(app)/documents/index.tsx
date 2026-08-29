import { FileStack } from "lucide-react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentTypesList } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * Lists every registered document type and links to its form. This page never names a document
 * type: it renders whatever GET /api/documents/types returns, so a new type appears here the
 * moment its descriptor is registered on the backend — no frontend change.
 */
export default function DocumentTypesPage() {
  const { t } = useTranslation()
  const { data: types, isLoading } = useDocumentTypesList()

  usePageHeader(t("documents.index.title"))

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6" data-cy="document-types-page">
      <p className="text-sm text-muted-foreground">{t("documents.index.description")}</p>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!isLoading && (types?.length ?? 0) === 0 && (
        <div className="text-center py-12 text-muted-foreground" data-cy="document-types-empty">
          {t("documents.index.empty")}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {types?.map((type) => (
          <Link key={type.id} to={`/documents/${type.id}`} data-cy={`document-type-link-${type.id}`}>
            <Card className="transition-colors hover:bg-accent">
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <FileStack className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">{type.label}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{type.id}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
