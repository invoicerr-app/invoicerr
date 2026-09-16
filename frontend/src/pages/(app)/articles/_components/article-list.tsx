import { Package, Pencil, Plus, SearchX, Trash2, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { useArticles, useCompany } from "@/hooks/queries"
import { currencies } from "@/lib/constants/currencies"
import type { Article } from "@/types"

import { FilterChip, FilterChipGroup, ListRow, ListSearch, ListSkeleton } from "../../_shared/data-list"
import { ArticleDeleteDialog } from "./article-delete"
import { ArticleUpsert } from "./article-upsert"

/** One article as a row — identity (name, type + low-stock badges, description), pricing figures in
 *  the mono face, "Edit" as the row's one contextual action and delete right beside it: with only
 *  ONE secondary action, a "⋯" menu would hide it for no reason, so the menu slot renders the plain
 *  ghost icon button instead of a dropdown (see `ListRow`'s own header on why that slot takes any
 *  node, not only a `ListRowMenu`). */
function ArticleRow({
  article,
  currencySymbol,
  onEdit,
  onDelete,
}: {
  article: Article
  currencySymbol?: string
  onEdit: (article: Article) => void
  onDelete: (article: Article) => void
}) {
  const { t } = useTranslation()
  return (
    <ListRow
      dataCy="article-item"
      identity={
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 break-words font-medium text-foreground">{article.name}</h3>
            <Badge variant="outline" className="text-xs">
              {t(`articles.fields.type.${article.type?.toLowerCase()}`) || article.type}
            </Badge>
            {/* `isLowStock` is server-computed (articles.service.ts), never re-derived here; the
                badge only ever reflects what the API already decided. */}
            {article.isLowStock && (
              <Badge variant="warning" className="gap-1 text-xs" data-cy={`article-low-stock-${article.id}`}>
                <TriangleAlert className="size-3" aria-hidden="true" />
                {t("articles.stock.lowStockBadge")}
              </Badge>
            )}
          </div>
          {article.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{article.description}</p>
          )}
        </>
      }
      figures={
        <div className="font-mono text-sm tabular-nums">
          <div>
            {article.unitPrice}
            {currencySymbol} · {article.vatRate}%
          </div>
          {article.quantity != null && (
            <div className="text-xs text-muted-foreground">
              {t("articles.fields.quantity.label")}: {article.quantity}
            </div>
          )}
        </div>
      }
      primary={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => onEdit(article)}
          dataCy="article-edit-button"
        >
          <Pencil aria-hidden="true" />
          {t("articles.actions.edit")}
        </Button>
      }
      menu={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tooltip={t("articles.actions.delete")}
          aria-label={t("articles.actions.delete")}
          onClick={() => onDelete(article)}
          dataCy="article-delete-button"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      }
    />
  )
}

/**
 * The reusable article/service catalog — same list grammar the clients screen already holds
 * (search + filter chips with counts + one filled "New …" button; rows made of identity, figures in
 * the mono face, one contextual action and, here, a single secondary control instead of a "⋯" menu).
 * Fetches and filters its own data: nothing above this component in the tree needs to know an
 * article even exists.
 */
export function ArticlesList() {
  const { t } = useTranslation()
  const { data: articles = [], isLoading } = useArticles()
  const { data: company } = useCompany()
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : ""

  const [searchTerm, setSearchTerm] = useState("")
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [createDialog, setCreateDialog] = useState(false)
  const [editDialog, setEditDialog] = useState<Article | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<Article | null>(null)

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return articles.filter(
      (article) =>
        (!term ||
          (article.name || "").toLowerCase().includes(term) ||
          (article.description || "").toLowerCase().includes(term) ||
          (article.type || "").toLowerCase().includes(term)) &&
        (!lowStockOnly || article.isLowStock),
    )
  }, [articles, searchTerm, lowStockOnly])

  const lowStockCount = articles.filter((article) => article.isLowStock).length
  const hasActiveFilter = !!searchTerm || lowStockOnly

  const clearFilters = () => {
    setSearchTerm("")
    setLowStockOnly(false)
  }

  return (
    <>
      <Card className="gap-0">
        <CardHeader className="gap-3 border-b">
          <div className="flex items-center gap-2">
            <ListSearch
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={t("articles.search.placeholder")}
              dataCy="articles-search"
              className="flex-1 sm:max-w-xs"
            />
            <Button onClick={() => setCreateDialog(true)} className="ml-auto" dataCy="article-add-button">
              <Plus aria-hidden="true" />
              <span className="hidden md:inline">{t("articles.list.add")}</span>
            </Button>
          </div>

          {articles.length > 0 && (
            <FilterChipGroup label={t("articles.filters.ariaLabel")} dataCy="articles-filters">
              <FilterChip
                label={t("articles.filters.all")}
                count={articles.length}
                active={!lowStockOnly}
                onClick={() => setLowStockOnly(false)}
                dataCy="articles-filter-all"
              />
              <FilterChip
                label={t("articles.filters.lowStock")}
                count={lowStockCount}
                tone="warning"
                active={lowStockOnly}
                onClick={() => setLowStockOnly(!lowStockOnly)}
                dataCy="articles-filter-low-stock"
              />
            </FilterChipGroup>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <ListSkeleton dataCy="articles-skeleton" />
          ) : filtered.length === 0 ? (
            hasActiveFilter ? (
              <EmptyState
                icon={SearchX}
                title={t("common.emptyState.noResultsTitle")}
                description={t("common.emptyState.noResultsHint")}
                action={
                  <Button variant="outline" onClick={clearFilters}>
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
                  <Button variant="secondary" onClick={() => setCreateDialog(true)}>
                    <Plus aria-hidden="true" />
                    {t("articles.list.add")}
                  </Button>
                }
                data-cy="articles-empty"
              />
            )
          ) : (
            <div className="divide-y" data-cy="articles-list">
              {filtered.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  currencySymbol={currencySymbol}
                  onEdit={setEditDialog}
                  onDelete={setDeleteDialog}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ArticleUpsert open={createDialog} onOpenChange={setCreateDialog} />

      <ArticleUpsert
        open={!!editDialog}
        article={editDialog}
        onOpenChange={(open) => {
          if (!open) setEditDialog(null)
        }}
      />

      <ArticleDeleteDialog
        article={deleteDialog}
        onOpenChange={(open) => {
          if (!open) setDeleteDialog(null)
        }}
      />
    </>
  )
}

export default ArticlesList
