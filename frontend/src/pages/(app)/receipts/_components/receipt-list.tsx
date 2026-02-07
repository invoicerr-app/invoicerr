import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Download, Edit, Mail, Plus, Receipt as ReceiptIcon, Trash2 } from "lucide-react"
import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { useGetRaw, usePost } from "@/hooks/use-fetch"

import BetterPagination from "../../../../components/pagination"
import { Button } from "../../../../components/ui/button"
import React from "react"
import { Receipt } from "@/types"
import { ReceiptDeleteDialog } from "@/pages/(app)/receipts/_components/receipt-delete"
import { ReceiptPdfModal } from "@/pages/(app)/receipts/_components/receipt-pdf-view"
import { ReceiptUpsert } from "@/pages/(app)/receipts/_components/receipt-upsert"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface ReceiptListProps {
    receipts: Receipt[]
    loading: boolean
    title: string
    description: string
    page?: number
    pageCount?: number
    setPage?: (page: number) => void
    mutate?: () => void
    emptyState: React.ReactNode
    showCreateButton?: boolean
}

export interface ReceiptListHandle {
    handleAddClick: () => void
}

export const ReceiptList = forwardRef<ReceiptListHandle, ReceiptListProps>(
    (
        { receipts, loading, title, description, page, pageCount, setPage, mutate, emptyState, showCreateButton = false },
        ref,
    ) => {
        const { t } = useTranslation()
        const { trigger: triggerSendToClient } = usePost<{ message: string; }>(
            `/api/receipts/send`,
        )

        const [createReceiptDialog, setCreateReceiptDialog] = useState<boolean>(false)
        const [editReceiptDialog, setEditReceiptDialog] = useState<Receipt | null>(null)
        const [viewReceiptPdfDialog, setViewReceiptPdfDialog] = useState<Receipt | null>(null)
        const [deleteReceiptDialog, setDeleteReceiptDialog] = useState<Receipt | null>(null)
        const [downloadReceiptPdf, setDownloadReceiptPdf] = useState<Receipt | null>(null)

        const { data: pdf } = useGetRaw<Response>(`/api/receipts/${downloadReceiptPdf?.id}/pdf`)

        useImperativeHandle(ref, () => ({
            handleAddClick() {
                setCreateReceiptDialog(true)
            },
        }))

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

        function handleAddClick() {
            setCreateReceiptDialog(true)
        }

        function handleEdit(receipt: Receipt) {
            setEditReceiptDialog(receipt)
        }

        function handleViewPdf(receipt: Receipt) {
            setViewReceiptPdfDialog(receipt)
        }

        function handleDownloadPdf(receipt: Receipt) {
            setDownloadReceiptPdf(receipt)
        }

        function handleSendToClient(receipt: Receipt) {
            triggerSendToClient({ id: receipt.id })
                .then(() => {
                    toast.success(t("receipts.list.messages.emailSent"))
                    mutate && mutate()
                })
                .catch((error) => {
                    console.error("Error sending receipt to client:", error)
                    toast.error(t("receipts.list.messages.emailError"))
                })
        }

        function handleDelete(receipt: Receipt) {
            setDeleteReceiptDialog(receipt)
        }


        return (
            <>
                <Card className="gap-0">
                    <CardHeader className="border-b flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center space-x-2">
                                <ReceiptIcon className="h-5 w-5 " />
                                <span>{title}</span>
                            </CardTitle>
                            <CardDescription>{description}</CardDescription>
                        </div>
                        {showCreateButton && (
                            <Button onClick={handleAddClick}>
                                <Plus className="h-4 w-4 mr-0 md:mr-2" />
                                <span className="hidden md:inline-flex">{t("receipts.list.actions.addNew")}</span>
                            </Button>
                        )}
                    </CardHeader>

                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                            </div>
                        ) : receipts.length === 0 ? (
                            emptyState
                        ) : (
                            <div className="divide-y">
                                {receipts.map((receipt, index) => (
                                    <div key={index} className="p-4 sm:p-6">
                                        <div className="flex flex-row sm:items-center sm:justify-between gap-4">
                                            <div className="flex flex-row items-center gap-4 w-full">
                                                <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                                                    <ReceiptIcon className="h-5 w-5 text-blue-600" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="font-medium text-foreground break-words">
                                                            {t("receipts.list.item.title", { number: receipt.rawNumber || receipt.number })}
                                                        </h3>
                                                    </div>
                                                    <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                                                        <div className="hidden sm:grid sm:grid-cols-1 lg:grid-cols-2 gap-1">
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("receipts.list.item.invoice")}:</span>{" "}
                                                                {receipt.invoice?.rawNumber || receipt.invoice?.number || t("receipts.list.item.noInvoice")}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("receipts.list.item.totalItemCount")}:</span>{" "}
                                                                {receipt.items.length}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("receipts.list.item.totalPaid")}:</span>{" "}
                                                                {t("common.valueWithCurrency", {
                                                                    currency: receipt.invoice?.currency || "USD",
                                                                    amount: receipt.totalPaid.toFixed(2),
                                                                })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
                                                <Button
                                                    tooltip={t("receipts.list.tooltips.viewPdf")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleViewPdf(receipt)}
                                                    className="text-gray-600 hover:text-pink-600"
                                                >
                                                    <ReceiptIcon className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("receipts.list.tooltips.downloadPdf")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDownloadPdf(receipt)}
                                                    className="text-gray-600 hover:text-amber-600"
                                                >
                                                    <Download className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("receipts.list.tooltips.edit")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEdit(receipt)}
                                                    className="text-gray-600 hover:text-green-600"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("receipts.list.tooltips.sendToClient")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleSendToClient(receipt)}
                                                    className="text-gray-600 hover:text-blue-600"
                                                >
                                                    <Mail className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("receipts.list.tooltips.delete")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(receipt)}
                                                    className="text-gray-600 hover:text-red-600"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>

                    {page && pageCount && setPage && (
                        <CardFooter>
                            {!loading && receipts.length > 0 && (
                                <BetterPagination pageCount={pageCount} page={page} setPage={setPage} />
                            )}
                        </CardFooter>
                    )}
                </Card>

                <ReceiptUpsert
                    open={createReceiptDialog}
                    onOpenChange={(open) => {
                        setCreateReceiptDialog(open)
                        if (!open) mutate && mutate()
                    }}
                />

                <ReceiptUpsert
                    open={!!editReceiptDialog}
                    receipt={editReceiptDialog}
                    onOpenChange={(open) => {
                        if (!open) setEditReceiptDialog(null)
                        mutate && mutate()
                    }}
                />


                <ReceiptPdfModal
                    receipt={viewReceiptPdfDialog}
                    onOpenChange={(open) => {
                        if (!open) setViewReceiptPdfDialog(null)
                    }}
                />

                <ReceiptDeleteDialog
                    receipt={deleteReceiptDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setDeleteReceiptDialog(null)
                        mutate && mutate()
                    }}
                />
            </>
        )
    },
)
