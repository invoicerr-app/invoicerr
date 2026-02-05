import { Card, CardContent } from "@/components/ui/card"
import { Plus, Receipt as ReceiptIcon, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useGetRaw, useSse } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Receipt } from "@/types"
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
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-0 lg:justify-between">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                        <ReceiptIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                        <div className="text-sm text-primary">{t("receipts.header.subtitle")}</div>
                        <div className="font-medium text-foreground">
                            {t("receipts.header.count", {
                                count: filteredReceipts.length,
                                found: searchTerm ? t("receipts.header.found") : "",
                            })}
                        </div>
                    </div>
                </div>

                <div className="flex flex-row items-center gap-4 w-full lg:w-fit lg:gap-6 lg:justify-between">
                    <div className="relative w-full lg:w-fit">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder={t("receipts.search.placeholder")}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 w-full"
                        />
                    </div>
                    <Button onClick={() => receiptListRef.current?.handleAddClick()}>
                        <Plus className="h-4 w-4 mr-0 md:mr-2" />
                        <span className="hidden md:inline-flex">{t("receipts.actions.addNew")}</span>
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card>
                    <CardContent>
                        <div className="flex items-center space-x-4">
                            <div className="p-3 bg-blue-100 rounded-lg">
                                <ReceiptIcon className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-semibold text-foreground">{receipts?.receipts.length || 0}</p>
                                <p className="text-sm text-primary">{t("receipts.stats.total")}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <ReceiptList
                ref={receiptListRef}
                receipts={filteredReceipts}
                loading={false}
                title={t("receipts.list.title")}
                description={t("receipts.list.description")}
                page={page}
                pageCount={receipts?.pageCount || 1}
                setPage={setPage}
                emptyState={emptyState}
                showCreateButton={true}
            />
        </div>
    )
}
