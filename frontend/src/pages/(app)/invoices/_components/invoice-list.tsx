import { Edit, Mail, Plus, ReceiptText as PaymentText, Search, Trash2, Stamp, RotateCcw, XCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { forwardRef, useImperativeHandle, useState } from "react"
import { usePost, authenticatedFetch } from "@/hooks/use-fetch"

import BetterPagination from "../../../../components/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InvoiceStatus, getDisplayInvoiceStatus, getInvoiceKindLabel, getInvoiceKindColor, type Invoice, type InvoiceStatusFilterKey } from "@/types"
import { InvoiceDeleteDialog } from "./invoice-delete"
import { InvoiceUpsert } from "./invoice-upsert"
import { InvoiceViewDialog } from "./invoice-view"
import { SendConfirmationDialog } from "@/components/send-confirmation-dialog"
import type React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

interface InvoiceListProps {
    invoices: Invoice[]
    loading: boolean
    title?: string
    description?: string
    searchTerm?: string
    onSearchChange?: (value: string) => void
    statusFilter?: InvoiceStatusFilterKey[]
    onStatusFilterChange?: (key: InvoiceStatusFilterKey) => void
    statusCounts?: { draft: number; issued: number; sent: number; paid: number; archived: number; cancelled: number; corrected: number }
    page?: number
    pageCount?: number
    setPage?: (page: number) => void
    mutate?: () => void
    emptyState: React.ReactNode
    showCreateButton?: boolean
    onAddClick?: () => void
}

export interface InvoiceListHandle {
    handleAddClick: () => void
}

export const InvoiceList = forwardRef<InvoiceListHandle, InvoiceListProps>(
    (
        { invoices, loading, title, description, searchTerm, onSearchChange, statusFilter, onStatusFilterChange, statusCounts, page, pageCount, setPage, mutate, emptyState, showCreateButton = false, onAddClick },
        ref,
    ) => {
        const { t } = useTranslation()
        const navigate = useNavigate()
        const { trigger: triggerSendInvoiceByEmail, loading: sendInvoiceByEmailLoading } = usePost(`/api/invoices/send`)

        const [createInvoiceDialog, setCreateInvoiceDialog] = useState<boolean>(false)
        const [editInvoiceDialog, setEditInvoiceDialog] = useState<Invoice | null>(null)
        const [viewInvoiceDialog, setViewInvoiceDialog] = useState<Invoice | null>(null)
        const [deleteInvoiceDialog, setDeleteInvoiceDialog] = useState<Invoice | null>(null)
        const [sendInvoiceDialog, setSendInvoiceDialog] = useState<Invoice | null>(null)

        useImperativeHandle(ref, () => ({
            handleAddClick() {
                setCreateInvoiceDialog(true)
            },
        }))

        function handleEdit(invoice: Invoice) {
            setEditInvoiceDialog(invoice)
        }

        function handleView(invoice: Invoice) {
            setViewInvoiceDialog(invoice)
        }

        function handleViewPdf(invoice: Invoice) {
            navigate(`/invoices/pdf/${invoice.id}`, { state: { invoice } })
        }

        function handleDelete(invoice: Invoice) {
            setDeleteInvoiceDialog(invoice)
        }

        const getStatusColor = (status: string) => {
            switch (getDisplayInvoiceStatus(status)) {
                case "DRAFT":
                    return "bg-gray-200 text-gray-700"
                case "ISSUED":
                    return "bg-violet-100 text-violet-800"
                case "SENT":
                    return "bg-yellow-100 text-yellow-800"
                case "OVERDUE":
                    return "bg-red-100 text-red-800"
                case "PAID":
                    return "bg-green-100 text-green-800"
                case "UPCOMING":
                    return "bg-purple-100 text-purple-800"
                case "ARCHIVED":
                    return "bg-slate-100 text-slate-600"
                case "CANCELLED":
                    return "bg-red-100 text-red-700"
                case "CORRECTED":
                    return "bg-amber-100 text-amber-800"
                case "PENDING_CLEARANCE":
                    return "bg-sky-100 text-sky-800"
                case "CLEARED":
                    return "bg-teal-100 text-teal-800"
                default:
                    return "bg-gray-100 text-gray-800"
            }
        }

        const getStatusLabel = (status: string) => {
            return t(`invoices.list.status.${getDisplayInvoiceStatus(status).toLowerCase()}`)
        }

        const handleSendInvoiceByEmail = (invoice: Invoice) => {
            setSendInvoiceDialog(invoice)
        }

        const handleIssue = (invoice: Invoice) => {
            authenticatedFetch(`/api/invoices/${invoice.id}/issue`, { method: 'POST' })
                .then(async (res) => {
                    if (!res.ok) throw new Error('Issue failed')
                    toast.success(t("invoices.list.messages.issueSuccess"))
                    mutate?.()
                })
                .catch(() => {
                    toast.error(t("invoices.list.messages.issueError"))
                })
        }

        const handleCorrect = (invoice: Invoice) => {
            authenticatedFetch(`/api/invoices/${invoice.id}/correct`, {
                method: 'POST',
                body: JSON.stringify({}),
            })
                .then(async (res) => {
                    const data = await res.json()
                    if (data.correctionInvoiceId) {
                        toast.success(t("invoices.list.messages.correctSuccess"))
                    } else {
                        toast.error(data.message || t("invoices.list.messages.correctError"))
                    }
                    mutate?.()
                })
                .catch(() => {
                    toast.error(t("invoices.list.messages.correctError"))
                })
        }

        const handleCancel = (invoice: Invoice) => {
            authenticatedFetch(`/api/invoices/${invoice.id}/cancel`, {
                method: 'POST',
                body: JSON.stringify({}),
            })
                .then(async (res) => {
                    const data = await res.json()
                    if (data.accepted) {
                        toast.success(t("invoices.list.messages.cancelSuccess"))
                    } else {
                        toast.error(data.reason || t("invoices.list.messages.cancelError"))
                    }
                    mutate?.()
                })
                .catch(() => {
                    toast.error(t("invoices.list.messages.cancelError"))
                })
        }

        const confirmSendInvoiceByEmail = () => {
            if (!sendInvoiceDialog) return

            triggerSendInvoiceByEmail({ id: sendInvoiceDialog.id })
                .then((result) => {
                    setSendInvoiceDialog(null)
                    if (result) {
                        toast.success(t("invoices.list.messages.sendByEmailSuccess"))
                    } else {
                        toast.error(t("invoices.list.messages.sendByEmailError"))
                    }
                })
                .catch((error) => {
                    console.error("Error sending invoice by email:", error)
                    toast.error(t("invoices.list.messages.sendByEmailError"))
                })
        }

        return (
            <>
                <Card className="gap-0">
                    <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
                        {title ? (
                            <div>
                                <CardTitle className="flex items-center space-x-2">
                                    <PaymentText className="h-5 w-5 " />
                                    <span>{title}</span>
                                </CardTitle>
                                {description && <CardDescription>{description}</CardDescription>}
                            </div>
                        ) : onSearchChange ? (
                            <div className="relative w-full sm:w-fit sm:flex-1 sm:max-w-sm">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder={t("invoices.search.placeholder")}
                                    value={searchTerm}
                                    onChange={(e) => onSearchChange(e.target.value)}
                                    className="pl-10 w-full"
                                />
                            </div>
                        ) : null}
                        <div className="flex items-center gap-2 sm:ml-auto">
                            {onStatusFilterChange && (
                                <div className="flex items-center gap-2">
                                    <Badge
                                        onClick={() => onStatusFilterChange("draft")}
                                        variant="outline"
                                        className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${statusFilter?.includes("draft")
                                            ? "bg-gray-500 text-white font-semibold shadow-sm scale-105"
                                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                            }`}
                                    >
                                        {t("invoices.statusFilters.draft")} ({statusCounts?.draft ?? 0})
                                    </Badge>
                                    <Badge
                                        onClick={() => onStatusFilterChange("issued")}
                                        variant="outline"
                                        className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${statusFilter?.includes("issued")
                                            ? "bg-violet-500 text-white font-semibold shadow-sm scale-105"
                                            : "bg-violet-50 text-violet-700/70 hover:bg-violet-100"
                                            }`}
                                    >
                                        {t("invoices.statusFilters.issued")} ({statusCounts?.issued ?? 0})
                                    </Badge>
                                    <Badge
                                        onClick={() => onStatusFilterChange("sent")}
                                        variant="outline"
                                        className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${statusFilter?.includes("sent")
                                            ? "bg-yellow-500 text-white font-semibold shadow-sm scale-105"
                                            : "bg-yellow-50 text-yellow-700/70 hover:bg-yellow-100"
                                            }`}
                                    >
                                        {t("invoices.statusFilters.sent")} ({statusCounts?.sent ?? 0})
                                    </Badge>
                                    <Badge
                                        onClick={() => onStatusFilterChange("paid")}
                                        variant="outline"
                                        className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${statusFilter?.includes("paid")
                                            ? "bg-green-600 text-white font-semibold shadow-sm scale-105"
                                            : "bg-green-50 text-green-700/70 hover:bg-green-100"
                                            }`}
                                    >
                                        {t("invoices.statusFilters.paid")} ({statusCounts?.paid ?? 0})
                                    </Badge>
                                    <Badge
                                        onClick={() => onStatusFilterChange("archived")}
                                        variant="outline"
                                        className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${statusFilter?.includes("archived")
                                            ? "bg-slate-600 text-white font-semibold shadow-sm scale-105"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                            }`}
                                    >
                                        {t("invoices.statusFilters.archived")} ({statusCounts?.archived ?? 0})
                                    </Badge>
                                    <Badge
                                        onClick={() => onStatusFilterChange("cancelled")}
                                        variant="outline"
                                        className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${statusFilter?.includes("cancelled")
                                            ? "bg-red-500 text-white font-semibold shadow-sm scale-105"
                                            : "bg-red-50 text-red-700/70 hover:bg-red-100"
                                            }`}
                                    >
                                        {t("invoices.statusFilters.cancelled")} ({statusCounts?.cancelled ?? 0})
                                    </Badge>
                                    <Badge
                                        onClick={() => onStatusFilterChange("corrected")}
                                        variant="outline"
                                        className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${statusFilter?.includes("corrected")
                                            ? "bg-amber-500 text-white font-semibold shadow-sm scale-105"
                                            : "bg-amber-50 text-amber-700/70 hover:bg-amber-100"
                                            }`}
                                    >
                                        {t("invoices.statusFilters.corrected")} ({statusCounts?.corrected ?? 0})
                                    </Badge>
                                </div>
                            )}
                            {showCreateButton && (
                                <Button onClick={() => (onAddClick ? onAddClick() : setCreateInvoiceDialog(true))} dataCy="invoice-add-button">
                                    <Plus className="h-4 w-4 mr-0 md:mr-2" />
                                    <span className="hidden md:inline-flex">{t("invoices.list.actions.addNew")}</span>
                                </Button>
                            )}
                        </div>
                    </CardHeader>

                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                            </div>
                        ) : invoices.length === 0 ? (
                            emptyState
                        ) : (
                            <div className="divide-y">
                                {invoices.map((invoice, index) => (
                                    <div key={index} className="p-4 sm:p-6" data-cy="invoice-row">
                                        <div className="flex flex-row sm:items-center sm:justify-between gap-4">
                                            <div className="flex flex-row items-center gap-4 w-full">
                                                <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                                                    <PaymentText className="h-5 w-5 text-blue-600" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="font-medium text-foreground break-words">
                                                            {invoice.status === InvoiceStatus.UPCOMING ? (
                                                                t("invoices.list.item.upcomingTitle", {
                                                                    client: invoice.client.name || `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`,
                                                                })
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleView(invoice)}
                                                                    className="underline hover:text-primary text-left"
                                                                    data-cy="invoice-name"
                                                                >
                                                                    {t("invoices.list.item.title", {
                                                                        number: invoice.rawNumber || invoice.number,
                                                                        title: invoice.title,
                                                                    })}
                                                                </button>
                                                            )}
                                                        </h3>
                                                        {invoice.kind && invoice.kind !== "INVOICE" && (
                                                            <Badge variant="secondary" className={`text-xs ${getInvoiceKindColor(invoice.kind)}`} data-cy="invoice-kind">
                                                                {getInvoiceKindLabel(invoice.kind)}
                                                            </Badge>
                                                        )}
                                                        <span
                                                            data-cy="invoice-status"
                                                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(invoice.status)}`}
                                                        >
                                                            {getStatusLabel(invoice.status)}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                                                        <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("invoices.list.item.client")}:</span>{" "}
                                                                {invoice.client.name || invoice.client.contactFirstname + " " + invoice.client.contactLastname}
                                                            </span>
                                                            {invoice.status === InvoiceStatus.UPCOMING ? (
                                                                <span>
                                                                    <span className="font-medium text-foreground">{t("invoices.list.item.nextInvoiceDate")}:</span>{" "}
                                                                    {new Date(invoice.dueDate).toLocaleDateString()}
                                                                </span>
                                                            ) : (
                                                                <>
                                                                    <span>
                                                                        <span className="font-medium text-foreground">{t("invoices.list.item.issued")}:</span>{" "}
                                                                        {new Date(invoice.createdAt).toLocaleDateString()}
                                                                    </span>
                                                                    <span>
                                                                        <span className="font-medium text-foreground">{t("invoices.list.item.due")}:</span>{" "}
                                                                        {new Date(invoice.dueDate).toLocaleDateString()}
                                                                    </span>
                                                                </>
                                                            )}
                                                            {invoice.paymentMethod && (
                                                                <span>
                                                                    <span className="font-medium text-foreground">
                                                                        {t("invoices.list.item.payment")}:
                                                                    </span>{" "}
                                                                    {((invoice.paymentMethod as any)?.name ?? (invoice.paymentMethod as any)?.type) ?? "-"}
                                                                </span>
                                                            )}
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("invoices.list.item.totalHT")}:</span>{" "}
                                                                {t("common.valueWithCurrency", {
                                                                    currency: invoice.currency,
                                                                    amount: invoice.totalHT.toFixed(2),
                                                                })}
                                                            </span>
                                                            <span>
                                                                <span className="font-medium text-foreground">{t("invoices.list.item.totalTTC")}:</span>{" "}
                                                                {t("common.valueWithCurrency", {
                                                                    currency: invoice.currency,
                                                                    amount: invoice.totalTTC.toFixed(2),
                                                                })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {invoice.status !== InvoiceStatus.UPCOMING && (
                                            <div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
                                                <Button
                                                    tooltip={t("invoices.list.tooltips.exportPdf")}
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleViewPdf(invoice)}
                                                    className="text-gray-600 hover:text-pink-600"
                                                >
                                                    <PaymentText className="h-4 w-4" />
                                                </Button>

                                                {invoice.status === InvoiceStatus.DRAFT && (
                                                    <Button
                                                        data-cy="invoice-edit-button"
                                                        tooltip={t("invoices.list.tooltips.edit")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEdit(invoice)}
                                                        className="text-gray-600 hover:text-blue-600"
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                )}

                                                {invoice.status === InvoiceStatus.DRAFT && (
                                                    <Button
                                                        data-cy="invoice-issue-button"
                                                        tooltip={t("invoices.list.tooltips.issue")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleIssue(invoice)}
                                                        className="text-gray-600 hover:text-violet-600"
                                                    >
                                                        <Stamp className="h-4 w-4" />
                                                    </Button>
                                                )}

                                                {/* Correction actions for issued invoices */}
                                                {(invoice.status === InvoiceStatus.ISSUED || invoice.status === InvoiceStatus.SENT) && (
                                                    <Button
                                                        data-cy="invoice-correct-button"
                                                        tooltip={t("invoices.list.tooltips.creditNote")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleCorrect(invoice)}
                                                        className="text-gray-600 hover:text-emerald-600"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                    </Button>
                                                )}

                                                {(invoice.status === InvoiceStatus.ISSUED || invoice.status === InvoiceStatus.SENT) && (
                                                    <Button
                                                        data-cy="invoice-cancel-button"
                                                        tooltip={t("invoices.list.tooltips.cancel")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleCancel(invoice)}
                                                        className="text-gray-600 hover:text-red-600"
                                                    >
                                                        <XCircle className="h-4 w-4" />
                                                    </Button>
                                                )}

                                                {invoice.status !== "PAID" && (
                                                    <Button
                                                        tooltip={t("invoices.list.tooltips.sendByEmail")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => { handleSendInvoiceByEmail(invoice) }}
                                                        className="text-gray-600 hover:text-purple-600"
                                                    >
                                                        <Mail className="h-4 w-4" />
                                                    </Button>
                                                )}

                                                {invoice.status === InvoiceStatus.DRAFT && (
                                                    <Button
                                                        tooltip={t("invoices.list.tooltips.delete")}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDelete(invoice)}
                                                        className="text-gray-600 hover:text-red-600"
                                                        dataCy="invoice-delete-button"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}

                                            </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>

                    {page && pageCount && setPage && (
                        <CardFooter>
                            {!loading && invoices.length > 0 && (
                                <BetterPagination pageCount={pageCount} page={page} setPage={setPage} />
                            )}
                        </CardFooter>
                    )}
                </Card >

                <InvoiceUpsert
                    open={createInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        setCreateInvoiceDialog(open)
                        if (!open) mutate && mutate()
                    }}
                />

                <InvoiceUpsert
                    open={!!editInvoiceDialog}
                    invoice={editInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setEditInvoiceDialog(null)
                        mutate && mutate()
                    }}
                />

                <InvoiceViewDialog
                    invoice={viewInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setViewInvoiceDialog(null)
                    }}
                />

                <InvoiceDeleteDialog
                    invoice={deleteInvoiceDialog}
                    onOpenChange={(open: boolean) => {
                        if (!open) setDeleteInvoiceDialog(null)
                        mutate && mutate()
                    }}
                />

                <SendConfirmationDialog
                    open={sendInvoiceDialog != null}
                    onOpenChange={(open: boolean) => {
                        if (!open) setSendInvoiceDialog(null)
                    }}
                    title={t("invoices.sendConfirmation.title")}
                    description={t("invoices.sendConfirmation.description")}
                    email={sendInvoiceDialog?.client.contactEmail ?? ""}
                    emailLabel={t("invoices.sendConfirmation.emailLabel")}
                    confirmLabel={t("invoices.sendConfirmation.confirm")}
                    cancelLabel={t("invoices.sendConfirmation.cancel")}
                    onConfirm={confirmSendInvoiceByEmail}
                    loading={sendInvoiceByEmailLoading}
                />
            </>
        )
    },
)
