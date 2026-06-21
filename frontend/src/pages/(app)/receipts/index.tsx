import { Plus, Receipt as ReceiptIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useGetRaw, useSse } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import type { Receipt } from "@/types"
import { usePageHeader } from "@/hooks/use-page-header"
import { useTranslation } from "react-i18next"
import { ReceiptList, type ReceiptListHandle } from "./_components/receipt-list"

export default function Receipts() {
    const { t } = useTranslation()
    const receiptListRef = useRef<ReceiptListHandle>(null)
    const [page, setPage] = useState(1)
    const { data: receipts } = useSse<{ pageCount: number; receipts: Receipt[] }>(`/api/receipts/sse?page=${page}`)
    const [downloadReceiptPdf, setDownloadReceiptPdf] = useState<Receipt | null>(null)
    const { data: pdf } = useGetRaw<Response>(`/api/receipts/${downloadReceiptPdf?.id}/pdf`)

    useEffect(() => {
        if (downloadReceiptPdf && pdf) {
            pdf.arrayBuffer().then((buffer) => {
                const blob = new Blob([buffer], { type: "application/pdf" })
                const url = URL.createObjectURL(blob)
                const link = document.createElement("a")
                link.href = url
                link.download = `receipt-${downloadReceiptPdf.number}.pdf`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
                setDownloadReceiptPdf(null) // Reset after download
            })
        }
    }, [downloadReceiptPdf, pdf])

    const [searchTerm, setSearchTerm] = useState("")

    const filteredReceipts =
        receipts?.receipts.filter(
            (receipt) =>
                receipt.invoice?.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                receipt.invoice?.client?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                receipt.rawNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                receipt.number?.toString().includes(searchTerm) ||
                receipt.invoice?.rawNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                receipt.invoice?.number?.toString().includes(searchTerm)
        ) || []

    usePageHeader(t("sidebar.navigation.receipts"))

    const emptyState = (
        <div className="text-center py-12">
            <ReceiptIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
                {searchTerm ? t("receipts.emptyState.noResults") : t("receipts.emptyState.noReceipts")}
            </h3>
            <p className="mt-1 text-sm text-primary">
                {searchTerm ? t("receipts.emptyState.tryDifferentSearch") : t("receipts.emptyState.startAdding")}
            </p>
            {!searchTerm && (
                <div className="mt-6">
                    <Button onClick={() => receiptListRef.current?.handleAddClick()}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t("receipts.actions.addNew")}
                    </Button>
                </div>
            )}
        </div>
    )

    return (
        <div className="max-w-7xl mx-auto space-y-6 p-6">

            <ReceiptList
                ref={receiptListRef}
                receipts={filteredReceipts}
                loading={false}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                page={page}
                pageCount={receipts?.pageCount || 1}
                setPage={setPage}
                emptyState={emptyState}
                showCreateButton={true}
            />
        </div>
    )
}
