import type { Article } from "@/types"
import SearchSelect from "@/components/search-input"
import { useArticles } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

interface ArticlePickerProps {
    onPick: (article: Article) => void
    className?: string
}

/**
 * Catalog article selector for quote/invoice line editors. Picking an article
 * fires `onPick` (the caller appends a prefilled line); the control is a pure
 * action trigger, so it keeps no selected value of its own.
 */
export function ArticlePicker({ onPick, className }: ArticlePickerProps) {
    const { t } = useTranslation()
    const { data: articles = [] } = useArticles()

    return (
        <SearchSelect
            className={className}
            value=""
            options={(articles || []).map((a) => ({ label: a.name, value: a.id }))}
            onValueChange={(val) => {
                const id = Array.isArray(val) ? val[0] : val
                if (!id) return
                const article = (articles || []).find((a) => a.id === id)
                if (article) onPick(article)
            }}
            placeholder={t("articles.picker.placeholder")}
            noResultsText={t("articles.picker.noResults")}
            data-cy="article-picker"
        />
    )
}

export default ArticlePicker
