import { FileText, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useGetRaw } from "@/hooks/use-fetch"
import { useQuotes } from "@/hooks/queries"

import { Button } from "@/components/ui/button"
import type { Quote } from "@/types"
import { QuoteList } from "@/pages/(app)/quotes/_components/quote-list"
import type { QuoteListHandle } from "@/pages/(app)/quotes/_components/quote-list"
import { usePageHeader } from "@/hooks/use-page-header"
import { useTranslation } from "react-i18next"

type QuoteStatusFilter = "draft" | "sent" | "signed" | undefined

export default function Quotes() {
    const { t } = useTranslation()
    const quoteListRef = useRef<QuoteListHandle>(null)
    const [page, setPage] = useState(1)
    const { data: quotes } = useQuotes(page)
    const [downloadQuotePdf, setDownloadQuotePdf] = useState<Quote | null>(null)
    const { data: pdf } = useGetRaw<Response>(downloadQuotePdf ? `/api/quotes/${downloadQuotePdf.id}/pdf` : null)

    useEffect(() => {
        if (downloadQuotePdf && pdf) {
            pdf.arrayBuffer().then((buffer) => {
                const blob = new Blob([buffer], { type: "application/pdf" })
                const url = URL.createObjectURL(blob)
                const link = document.createElement("a")
                link.href = url
                link.download = `quote-${downloadQuotePdf.number}.pdf`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
                setDownloadQuotePdf(null) // Reset after download
            })
        }
    }, [downloadQuotePdf, pdf])

    const [searchTerm, setSearchTerm] = useState("")
    const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>(undefined)

    const filteredQuotes =
        quotes?.quotes.filter(
            (quote) =>
                (quote.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    quote.rawNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    quote.number?.toString().includes(searchTerm) ||
                    quote.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())) &&
                (!statusFilter ||
                    (statusFilter === "draft" && quote.status === "DRAFT") ||
                    (statusFilter === "sent" && quote.status === "SENT") ||
                    (statusFilter === "signed" && quote.status === "SIGNED")),
        ) || []

    const quoteStatusCounts = {
        draft: quotes?.quotes.filter((q) => q.status === "DRAFT").length || 0,
        sent: quotes?.quotes.filter((q) => q.status === "SENT").length || 0,
        signed: quotes?.quotes.filter((q) => q.status === "SIGNED").length || 0,
    }

    usePageHeader(t("sidebar.navigation.quotes"))

    const emptyState = (
        <div className="text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
                {searchTerm ? t("quotes.emptyState.noResults") : t("quotes.emptyState.noQuotes")}
            </h3>
            <p className="mt-1 text-sm text-primary">
                {searchTerm ? t("quotes.emptyState.tryDifferentSearch") : t("quotes.emptyState.startAdding")}
            </p>
            {!searchTerm && (
                <div className="mt-6">
                    <Button onClick={() => quoteListRef.current?.handleAddClick()}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t("quotes.actions.addNew")}
                    </Button>
                </div>
            )}
        </div>
    )

    return (
        <div className="max-w-7xl mx-auto space-y-6 p-6">
            <QuoteList
                ref={quoteListRef}
                quotes={filteredQuotes}
                loading={false}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                statusCounts={quoteStatusCounts}
                page={page}
                pageCount={quotes?.pageCount || 1}
                setPage={setPage}
                emptyState={emptyState}
                showCreateButton={true}
            />
        </div>
    )
}
