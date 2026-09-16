import { useTranslation } from "react-i18next"

import { usePageHeader } from "@/hooks/use-page-header"

import { ArticlesList } from "./_components/article-list"

export default function ArticlesPage() {
  const { t } = useTranslation()
  usePageHeader(t("sidebar.navigation.articles"))

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <ArticlesList />
    </div>
  )
}
