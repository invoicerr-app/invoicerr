import { ArticlesList, type ArticlesListHandle } from "@/pages/(app)/articles/_components/article-list"
import { Package, Plus, SearchX } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useArticles } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { useTranslation } from "react-i18next"

export default function ArticlesPage() {
  const { t } = useTranslation()
  const listRef = useRef<ArticlesListHandle>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const { data: articles = [] } = useArticles()

  const filtered = (articles || []).filter(
    (a) =>
      (a.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.description || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.type || "").toLowerCase().includes(searchTerm.toLowerCase()),
  )

  usePageHeader(t("sidebar.navigation.articles"))

  // `secondary` on the empty-state CTA: the list header's "Add article" stays the page's one filled
  // button.
  const emptyState = searchTerm ? (
    <EmptyState
      icon={SearchX}
      title={t("common.emptyState.noResultsTitle")}
      description={t("common.emptyState.noResultsHint")}
      action={
        <Button variant="outline" onClick={() => setSearchTerm("")}>
          {t("common.emptyState.clearSearch")}
        </Button>
      }
      data-cy="articles-empty"
    />
  ) : (
    <EmptyState
      icon={Package}
      title={t("articles.empty")}
      description={t("articles.description")}
      action={
        <Button variant="secondary" onClick={() => listRef.current?.handleAddClick()}>
          <Plus aria-hidden="true" />
          {t("articles.list.add")}
        </Button>
      }
      data-cy="articles-empty"
    />
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
