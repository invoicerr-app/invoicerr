import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Edit, Eye, Pause, Play, SkipForward, StopCircle, Plus, ReceiptText as PaymentText, Trash2 } from "lucide-react"
import { forwardRef, useImperativeHandle, useState } from "react"

import BetterPagination from "@/components/pagination"
import { Button } from "@/components/ui/button"
import type React from "react"
import type { RecurringInvoice } from "@/types"
import { RecurringInvoiceDeleteDialog } from "./recurring-invoices-delete"
import { RecurringInvoiceUpsert } from "./recurring-invoices-upsert"
import { RecurringInvoiceViewDialog } from "./recurring-invoices-view"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"

interface RecurringInvoiceListProps {
    recurringInvoices: RecurringInvoice[]
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

export interface RecurringInvoiceListHandle {
    handleAddClick: () => void
}

export const RecurringInvoiceList = forwardRef<RecurringInvoiceListHandle, RecurringInvoiceListProps>(
    (
        { recurringInvoices, loading, title, description, page, pageCount, setPage, mutate, emptyState, showCreateButton = false },
        ref,
    ) => {
        const { t } = useTranslation()

        const [createRecurringInvoiceDialog, setCreateRecurringInvoiceDialog] = useState<boolean>(false)
        const [editRecurringInvoiceDialog, setEditRecurringInvoiceDialog] = useState<RecurringInvoice | null>(null)
        const [viewRecurringInvoiceDialog, setViewRecurringInvoiceDialog] = useState<RecurringInvoice | null>(null)
        const [deleteRecurringInvoiceDialog, setDeleteRecurringInvoiceDialog] = useState<RecurringInvoice | null>(null)

        const handlePause = async (ri: RecurringInvoice) => {
            await fetch(`/api/recurring-invoices/${ri.id}/pause`, { method: 'POST' })
            toast.success(t("recurringInvoices.list.messages.pauseSuccess"))
            mutate?.()
        }

        const handleResume = async (ri: RecurringInvoice) => {
            await fetch(`/api/recurring-invoices/${ri.id}/resume`, { method: 'POST' })
            toast.success(t("recurringInvoices.list.messages.resumeSuccess"))
            mutate?.()
        }

        const handleSkipNext = async (ri: RecurringInvoice) => {
            await fetch(`/api/recurring-invoices/${ri.id}/skip-next`, { method: 'POST' })
            toast.success(t("recurringInvoices.list.messages.skipNextSuccess"))
            mutate?.()
        }

        const handleEndNow = async (ri: RecurringInvoice) => {
            await fetch(`/api/recurring-invoices/${ri.id}/end-now`, { method: 'POST' })
            toast.success(t("recurringInvoices.list.messages.endNowSuccess"))
            mutate?.()
        }

        useImperativeHandle(ref, () => ({
            handleAddClick() {
                setCreateRecurringInvoiceDialog(true)
            },
        }))

        function handleEdit(recurringInvoice: RecurringInvoice) {
            setEditRecurringInvoiceDialog(recurringInvoice)
        }

        function handleView(recurringInvoice: RecurringInvoice) {
            setViewRecurringInvoiceDialog(recurringInvoice)
        }

        function handleDelete(recurringInvoice: RecurringInvoice) {
            setDeleteRecurringInvoiceDialog(recurringInvoice)
        }

        return (
            <>
                <Card className="gap-0">
                    <CardHeader className="border-b flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center space-x-2">
                                <PaymentText className="h-5 w-5 " />
                                <span>{title}</span>
                            </CardTitle>
                            <CardDescription>{description}</CardDescription>
                        </div>
                        {showCreateButton && (
                            <div className="flex space-x-2">
                                <Button onClick={() => setCreateRecurringInvoiceDialog(true)}>
                                    <Plus className="h-4 w-4 mr-0 md:mr-2" />
                                    <span className="hidden md:inline-flex">{t("recurringInvoices.list.actions.addNew")}</span>
                                </Button>
                            </div>
                        )}
                    </CardHeader>

                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                            </div>
                        ) : recurringInvoices.length === 0 ? (
                            emptyState
                        ) : (
                            <div className="divide-y">
                                {recurringInvoices && recurringInvoices.map((recurringInvoice) => (
                                    <div key={recurringInvoice.id} className="p-4 sm:p-6">
                                        <div className="flex flex-row sm:items-center sm:justify-between gap-4">
                                            <div className="flex flex-row items-center gap-4 w-full">
                                                <div className={`p-2 rounded-lg mb-4 md:mb-0 w-fit h-fit ${recurringInvoice.paused ? 'bg-yellow-100' : 'bg-blue-100'}`}>
                                                    <PaymentText className={`h-5 w-5 ${recurringInvoice.paused ? 'text-yellow-600' : 'text-blue-600'}`} />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        {recurringInvoice.paused && (
                                                            <Badge variant="outline" className="text-yellow-700 border-yellow-300 bg-yellow-50" data-cy="recurring-invoice-paused-badge">
                                                                {t("recurringInvoices.list.item.paused")}
                                                            </Badge>
                                                        )}
                                                        {recurringInvoice.autoIssue && (
                                                            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50" data-cy="recurring-invoice-autoIssue-badge">
                                                                {t("recurringInvoices.list.item.autoIssue")}
                                                            </Badge>
                                                        )}
                                                        {recurringInvoice.autoSend && (
                                                            <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50" data-cy="recurring-invoice-autoSend-badge">
                                                                {t("recurringInvoices.list.item.autoSend")}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                                                        <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.client")}:</span>{" "}
                                                                {recurringInvoice.client.name || recurringInvoice.client.contactFirstname + " " + recurringInvoice.client.contactLastname}
                                                            </span>
                                                            {recurringInvoice.paymentMethod && (
                                                                <span>
                                                                    <span className="font-medium text-foreground">
                                                                        {t("recurringInvoices.list.item.payment")}:
                                                                    </span>{" "}
                                                                    {((recurringInvoice.paymentMethod as any)?.name ?? (recurringInvoice.paymentMethod as any)?.type) ?? "-"}
                                                                </span>
                                                            )}
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.frequency")}:</span>{" "}
                                                                {t(`recurringInvoices.frequency.${recurringInvoice.frequency.toLowerCase()}`)}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.totalTTC")}:</span>{" "}
                                                                {t("common.valueWithCurrency", {
                                                                    currency: recurringInvoice.currency,
                                                                    amount: recurringInvoice.totalTTC.toFixed(2),
                                                                })}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.nextRun")}:</span>{" "}
                                                                {recurringInvoice.nextInvoiceDate ? new Date(recurringInvoice.nextInvoiceDate).toLocaleDateString() : "—"}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.lastRun")}:</span>{" "}
                                                                {recurringInvoice.lastInvoiceDate ? new Date(recurringInvoice.lastInvoiceDate).toLocaleDateString() : "—"}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.generatedCount")}:</span>{" "}
                                                                {(recurringInvoice as any)._count?.generatedInvoices ?? "0"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
                                                <Button
                                                    tooltip={t("recurringInvoices.list.tooltips.view")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleView(recurringInvoice)}
                                                    className="text-gray-600 hover:text-blue-600"
                                                    data-cy="recurring-invoice-view"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("recurringInvoices.list.tooltips.edit")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEdit(recurringInvoice)}
                                                    className="text-gray-600 hover:text-green-600"
                                                    data-cy="recurring-invoice-edit"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>

                                                {!recurringInvoice.paused ? (
                                                    <Button
                                                        tooltip={t("recurringInvoices.list.tooltips.pause")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handlePause(recurringInvoice)}
                                                        className="text-gray-600 hover:text-yellow-600"
                                                        data-cy="recurring-invoice-pause"
                                                    >
                                                        <Pause className="h-4 w-4" />
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        tooltip={t("recurringInvoices.list.tooltips.resume")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleResume(recurringInvoice)}
                                                        className="text-gray-600 hover:text-green-600"
                                                        data-cy="recurring-invoice-resume"
                                                    >
                                                        <Play className="h-4 w-4" />
                                                    </Button>
                                                )}

                                                <Button
                                                    tooltip={t("recurringInvoices.list.tooltips.skipNext")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleSkipNext(recurringInvoice)}
                                                    className="text-gray-600 hover:text-orange-600"
                                                    data-cy="recurring-invoice-skip-next"
                                                >
                                                    <SkipForward className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("recurringInvoices.list.tooltips.endNow")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEndNow(recurringInvoice)}
                                                    className="text-gray-600 hover:text-red-600"
                                                    data-cy="recurring-invoice-end-now"
                                                >
                                                    <StopCircle className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("recurringInvoices.list.tooltips.delete")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(recurringInvoice)}
                                                    className="text-gray-600 hover:text-red-600"
                                                    data-cy="recurring-invoice-delete"
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
                            {!loading && recurringInvoices.length > 0 && (
                                <BetterPagination pageCount={pageCount} page={page} setPage={setPage} />
                            )}
                        </CardFooter>
                    )}
                </Card>

                <RecurringInvoiceUpsert
                    open={createRecurringInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        setCreateRecurringInvoiceDialog(open)
                        if (!open) mutate && mutate()
                    }}
                />

                <RecurringInvoiceUpsert
                    open={!!editRecurringInvoiceDialog}
                    recurringInvoice={editRecurringInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setEditRecurringInvoiceDialog(null)
                        mutate && mutate()
                    }}
                />

                <RecurringInvoiceViewDialog
                    recurringInvoice={viewRecurringInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setViewRecurringInvoiceDialog(null)
                    }}
                />

                <RecurringInvoiceDeleteDialog
                    recurringInvoice={deleteRecurringInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setDeleteRecurringInvoiceDialog(null)
                        mutate && mutate()
                    }}
                />
            </>
        )
    },
)
