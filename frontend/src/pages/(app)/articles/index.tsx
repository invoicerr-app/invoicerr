import { useTranslation } from "react-i18next"

import { usePageHeader } from "@/hooks/use-page-header"

import { ArticlesList } from "./_components/article-list"

export default function ArticlesPage() {
  const { t } = useTranslation()
  usePageHeader(t("sidebar.navigation.articles"))

  return (
    <div className="mx-auto max-w-7xl px-4 pt-1 pb-8 md:px-6">
      <ArticlesList />
    </div>
  )
}
