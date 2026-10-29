import { useTranslation } from "react-i18next"

import { usePageHeader } from "@/hooks/use-page-header"

import { ArticlesList } from "./_components/article-list"

export default function ArticlesPage() {
  const { t } = useTranslation()
  usePageHeader(t("sidebar.navigation.articles"))

  return (
    <div className="page-content">
      <ArticlesList />
    </div>
  )
}
