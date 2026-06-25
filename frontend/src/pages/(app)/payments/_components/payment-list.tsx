import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Edit, Mail, Plus, Receipt as PaymentIcon, Search, Trash2 } from "lucide-react"
import { forwardRef, useImperativeHandle, useState } from "react"
import { usePost } from "@/hooks/use-fetch"

import BetterPagination from "../../../../components/pagination"
import { Button } from "../../../../components/ui/button"
import { Input } from "@/components/ui/input"
import type React from "react"
import type { Payment } from "@/types"
import { PaymentDeleteDialog } from "@/pages/(app)/payments/_components/payment-delete"
import { PaymentUpsert } from "@/pages/(app)/payments/_components/payment-upsert"
import { SendConfirmationDialog } from "@/components/send-confirmation-dialog"
import { toast } from "sonner"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

interface PaymentListProps {
    payments: Payment[]
    loading: boolean
    title?: string
    description?: string
    searchTerm?: string
    onSearchChange?: (value: string) => void
    page?: number
    pageCount?: number
    setPage?: (page: number) => void
    mutate?: () => void
    emptyState: React.ReactNode
    showCreateButton?: boolean
}

export interface PaymentListHandle {
    handleAddClick: () => void
}

export const PaymentList = forwardRef<PaymentListHandle, PaymentListProps>(
    (
        { payments, loading, title, description, searchTerm, onSearchChange, page, pageCount, setPage, mutate, emptyState, showCreateButton = false },
        ref,
    ) => {
        const { t } = useTranslation()
        const navigate = useNavigate()
        const { trigger: triggerSendToClient, loading: sendToClientLoading } = usePost<{ message: string; }>(
            `/api/payments/send`,
        )

        const [createPaymentDialog, setCreatePaymentDialog] = useState<boolean>(false)
        const [editPaymentDialog, setEditPaymentDialog] = useState<Payment | null>(null)
        const [deletePaymentDialog, setDeletePaymentDialog] = useState<Payment | null>(null)
        const [sendPaymentDialog, setSendPaymentDialog] = useState<Payment | null>(null)

        useImperativeHandle(ref, () => ({
            handleAddClick() {
                setCreatePaymentDialog(true)
            },
        }))

        function handleAddClick() {
            setCreatePaymentDialog(true)
        }

        function handleEdit(payment: Payment) {
            setEditPaymentDialog(payment)
        }

        function handleViewPdf(payment: Payment) {
            navigate(`/payments/pdf/${payment.id}`, { state: { payment } })
        }

        function handleSendToClient(payment: Payment) {
            setSendPaymentDialog(payment)
        }

        function confirmSendToClient() {
            if (!sendPaymentDialog) return

            triggerSendToClient({ id: sendPaymentDialog.id })
                .then((result) => {
                    setSendPaymentDialog(null)
                    if (result) {
                        toast.success(t("payments.list.messages.emailSent"))
                        mutate && mutate()
                    } else {
                        toast.error(t("payments.list.messages.emailError"))
                    }
                })
                .catch((error) => {
                    console.error("Error sending payment to client:", error)
                    toast.error(t("payments.list.messages.emailError"))
                })
        }

        function handleDelete(payment: Payment) {
            setDeletePaymentDialog(payment)
        }


        return (
            <>
                <Card className="gap-0">
                    <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
                        {title ? (
                            <div>
                                <CardTitle className="flex items-center space-x-2">
                                    <span>{title}</span>
                                </CardTitle>
                                {description && <CardDescription>{description}</CardDescription>}
                            </div>
                        ) : onSearchChange ? (
                            <div className="relative w-full sm:w-fit sm:flex-1 sm:max-w-sm">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder={t("payments.search.placeholder")}
                                    value={searchTerm}
                                    onChange={(e) => onSearchChange(e.target.value)}
                                    className="pl-10 w-full"
                                />
                            </div>
                        ) : null}
                        {showCreateButton && (
                            <Button onClick={handleAddClick}>
                                <Plus className="h-4 w-4 mr-0 md:mr-2" />
                                <span className="hidden md:inline-flex">{t("payments.list.actions.addNew")}</span>
                            </Button>
                        )}
                    </CardHeader>

                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                            </div>
                        ) : payments.length === 0 ? (
                            emptyState
                        ) : (
                            <div className="divide-y">
                                {payments.map((payment, index) => (
                                    <div key={index} className="p-4 sm:p-6">
                                        <div className="flex flex-row sm:items-center sm:justify-between gap-4">
                                            <div className="flex flex-row items-center gap-4 w-full">
                                                <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                                                    <PaymentIcon className="h-5 w-5 text-blue-600" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="font-medium text-foreground break-words">
                                                            {t("payments.list.item.title", { number: payment.rawNumber || payment.number })}
                                                        </h3>
                                                    </div>
                                                    <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                                                        <div className="hidden sm:grid sm:grid-cols-1 lg:grid-cols-2 gap-1">
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("payments.list.item.invoice")}:</span>{" "}
                                                                {payment.invoice?.rawNumber || payment.invoice?.number || t("payments.list.item.noInvoice")}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("payments.list.item.totalItemCount")}:</span>{" "}
                                                                {payment.items.length}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("payments.list.item.totalPaid")}:</span>{" "}
                                                                {t("common.valueWithCurrency", {
                                                                    currency: payment.invoice?.currency || "USD",
                                                                    amount: payment.totalPaid.toFixed(2),
                                                                })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
                                                <Button
                                                    tooltip={t("payments.list.tooltips.viewPdf")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleViewPdf(payment)}
                                                    className="text-gray-600 hover:text-pink-600"
                                                >
                                                    <PaymentIcon className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("payments.list.tooltips.edit")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEdit(payment)}
                                                    className="text-gray-600 hover:text-green-600"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("payments.list.tooltips.sendToClient")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleSendToClient(payment)}
                                                    className="text-gray-600 hover:text-blue-600"
                                                    disabled={sendToClientLoading}
                                                >
                                                    <Mail className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    tooltip={t("payments.list.tooltips.delete")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(payment)}
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
                            {!loading && payments.length > 0 && (
                                <BetterPagination pageCount={pageCount} page={page} setPage={setPage} />
                            )}
                        </CardFooter>
                    )}
                </Card>

                <PaymentUpsert
                    open={createPaymentDialog}
                    onOpenChange={(open) => {
                        setCreatePaymentDialog(open)
                        if (!open) mutate && mutate()
                    }}
                />

                <PaymentUpsert
                    open={!!editPaymentDialog}
                    payment={editPaymentDialog}
                    onOpenChange={(open) => {
                        if (!open) setEditPaymentDialog(null)
                        mutate && mutate()
                    }}
                />


                <PaymentDeleteDialog
                    payment={deletePaymentDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setDeletePaymentDialog(null)
                        mutate && mutate()
                    }}
                />

                <SendConfirmationDialog
                    open={sendPaymentDialog != null}
                    onOpenChange={(open: boolean) => {
                        if (!open) setSendPaymentDialog(null)
                    }}
                    title={t("payments.sendConfirmation.title")}
                    description={t("payments.sendConfirmation.description")}
                    email={sendPaymentDialog?.invoice?.client.contactEmail ?? ""}
                    emailLabel={t("payments.sendConfirmation.emailLabel")}
                    confirmLabel={t("payments.sendConfirmation.confirm")}
                    cancelLabel={t("payments.sendConfirmation.cancel")}
                    onConfirm={confirmSendToClient}
                    loading={sendToClientLoading}
                />
            </>
        )
    },
)
