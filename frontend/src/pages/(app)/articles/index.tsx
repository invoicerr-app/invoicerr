import { ArticlesList, type ArticlesListHandle } from "@/pages/(app)/articles/_components/article-list"
import { Package, Plus } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { useArticles } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { useTranslation } from "react-i18next"

export default function ArticlesPage() {
  const { t } = useTranslation()
  const listRef = useRef<ArticlesListHandle>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const { data: articles = [] } = useArticles()

  const filtered = (articles || []).filter((a) =>
    (a.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.description || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.type || "").toLowerCase().includes(searchTerm.toLowerCase()),
  )

  usePageHeader(t("sidebar.navigation.articles"))

  const emptyState = (
    <div className="text-center py-12">
      <Package className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-foreground">{t("articles.empty")}</h3>
      <p className="mt-1 text-sm text-primary">{t("articles.description")}</p>
      {!searchTerm && (
        <div className="mt-6">
          <Button onClick={() => listRef.current?.handleAddClick()}>
            <Plus className="h-4 w-4 mr-2" />
            {t("articles.list.add")}
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <ArticlesList
        ref={listRef}
        articles={filtered}
        loading={false}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        emptyState={emptyState}
        showCreateButton={true}
      />
    </div>
  )
}
