import { Edit, Package, Plus, Search, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { forwardRef, useImperativeHandle, useState } from "react"

import { ArticleDeleteDialog } from "./article-delete"
import { ArticleUpsert } from "./article-upsert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { currencies } from "@/lib/constants/currencies"
import type React from "react"
import { useCompany } from "@/hooks/queries"
import { useTranslation } from "react-i18next"
import type { Article } from "@/types"

interface ArticlesListProps {
  articles: Article[]
  loading: boolean
  title?: string
  description?: string
  searchTerm?: string
  onSearchChange?: (value: string) => void
  emptyState: React.ReactNode
  showCreateButton?: boolean
}

export interface ArticlesListHandle {
  handleAddClick: () => void
}

export const ArticlesList = forwardRef<ArticlesListHandle, ArticlesListProps>(
  ({ articles = [], loading, title, description, searchTerm, onSearchChange, emptyState, showCreateButton = false }, ref) => {
    const { t } = useTranslation()
    const { data: company } = useCompany()
    const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : ""
    const [createDialog, setCreateDialog] = useState<boolean>(false)
    const [editDialog, setEditDialog] = useState<Article | null>(null)
    const [deleteDialog, setDeleteDialog] = useState<Article | null>(null)

    useImperativeHandle(ref, () => ({
      handleAddClick() {
        setCreateDialog(true)
      },
    }))

    return (
      <>
        <Card className="gap-0">
          <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
            {title ? (
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <span>{title}</span>
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
              </div>
            ) : onSearchChange ? (
              <div className="relative w-full sm:w-fit sm:flex-1 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t("articles.search.placeholder") || ""}
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="pl-10 w-full"
                />
              </div>
            ) : null}
            <div className="flex items-center gap-2 sm:ml-auto">
              {showCreateButton && (
                <Button onClick={() => setCreateDialog(true)} dataCy="article-add-button">
                  <Plus className="h-4 w-4 mr-0 md:mr-2" />
                  <span className="hidden md:inline-flex">{t("articles.list.add")}</span>
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
              </div>
            ) : articles.length === 0 ? (
              emptyState
            ) : (
              <div className="divide-y">
                {articles.map((article) => (
                  <div key={article.id} className="p-4 sm:p-6" data-cy="article-item">
                    <div className="flex flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex flex-row items-center gap-4 w-full">
                        <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                          <Package className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium text-foreground break-words">{article.name}</h3>
                            <Badge variant="outline" className="text-xs">
                              {t(`articles.fields.type.${article.type?.toLowerCase()}`) || article.type}
                            </Badge>
                          </div>
                          {article.description && (
                            <div className="mt-1 text-sm text-muted-foreground break-words">{article.description}</div>
                          )}
                          <div className="mt-1 text-sm text-muted-foreground">
                            {t("articles.fields.unitPrice.label")}: {article.unitPrice}{currencySymbol} · {t("articles.fields.vatRate.label")}: {article.vatRate}%
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
                        <Button tooltip={t("articles.actions.edit")} variant="ghost" size="icon" onClick={() => setEditDialog(article)} className="text-gray-600 hover:text-green-600" dataCy="article-edit-button">
                          <Edit className="h-4 w-4" />
                        </Button>

                        <Button tooltip={t("articles.actions.delete")} variant="ghost" size="icon" onClick={() => setDeleteDialog(article)} className="text-gray-600 hover:text-red-600" dataCy="article-delete-button">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <ArticleUpsert
          open={createDialog}
          onOpenChange={(open: boolean) => setCreateDialog(open)}
        />

        <ArticleUpsert
          open={!!editDialog}
          article={editDialog}
          onOpenChange={(open: boolean) => {
            if (!open) setEditDialog(null)
          }}
        />

        <ArticleDeleteDialog
          article={deleteDialog}
          onOpenChange={(open: boolean) => {
            if (!open) setDeleteDialog(null)
          }}
        />
      </>
    )
  },
)

export default ArticlesList
