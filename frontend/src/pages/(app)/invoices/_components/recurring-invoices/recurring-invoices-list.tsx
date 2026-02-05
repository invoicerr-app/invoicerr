import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Edit, Eye, Plus, ReceiptText, Trash2 } from "lucide-react"
import { forwardRef, useImperativeHandle, useState } from "react"

import BetterPagination from "@/components/pagination"
import { Button } from "@/components/ui/button"
import type React from "react"
import type { RecurringInvoice } from "@/types"
import { RecurringInvoiceDeleteDialog } from "./recurring-invoices-delete"
import { RecurringInvoiceUpsert } from "./recurring-invoices-upsert"
import { RecurringInvoiceViewDialog } from "./recurring-invoices-view"
import { useTranslation } from "react-i18next"

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
                                <ReceiptText className="h-5 w-5 " />
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
                                                <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                                                    <ReceiptText className="h-5 w-5 text-blue-600" />
                                                </div>
                                                <div className="flex-1">
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
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.totalHT")}:</span>{" "}
                                                                {t("common.valueWithCurrency", {
                                                                    currency: recurringInvoice.currency,
                                                                    amount: recurringInvoice.totalHT.toFixed(2),
                                                                })}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("recurringInvoices.list.item.totalTTC")}:</span>{" "}
                                                                {t("common.valueWithCurrency", {
                                                                    currency: recurringInvoice.currency,
                                                                    amount: recurringInvoice.totalTTC.toFixed(2),
                                                                })}
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
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("recurringInvoices.list.tooltips.edit")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEdit(recurringInvoice)}
                                                    className="text-gray-600 hover:text-green-600"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("recurringInvoices.list.tooltips.delete")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(recurringInvoice)}
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
