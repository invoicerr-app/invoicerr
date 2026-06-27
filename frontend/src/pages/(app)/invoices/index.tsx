import { ReceiptText, Plus, List, FileText, Repeat, GitBranch, Table2 } from "lucide-react"
import { InvoiceList, type InvoiceListHandle } from "@/pages/(app)/invoices/_components/invoice-list"
import { InvoiceProgression } from "@/pages/(app)/invoices/_components/invoice-progression"
import { InvoiceTable } from "@/pages/(app)/invoices/_components/invoice-table"
import { InvoiceViewDialog } from "@/pages/(app)/invoices/_components/invoice-view"
import { useEffect, useRef, useState } from "react"
import { useGetRaw, usePost, authenticatedFetch } from "@/hooks/use-fetch"
import { useInvoices, useRecurringInvoices } from "@/hooks/queries"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InvoiceStatus, type Invoice, type InvoiceStatusFilterKey } from "@/types"
import { usePageHeader } from "@/hooks/use-page-header"
import { useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type InvoiceFilter = "all" | "oneTime" | "recurring"
type InvoiceView = "list" | "progression" | "table"

const INVOICE_VIEWS: InvoiceView[] = ["list", "progression", "table"]

export default function Invoices() {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const invoiceListRef = useRef<InvoiceListHandle>(null)

    const [page, setPage] = useState(1)
    const { data: invoices } = useInvoices(page)
    const { data: recurringInvoices } = useRecurringInvoices()
    const [downloadInvoicePdf, setDownloadInvoicePdf] = useState<Invoice | null>(null)
    const [viewInvoiceDialog, setViewInvoiceDialog] = useState<Invoice | null>(null)
    const { data: pdf } = useGetRaw<Response>(downloadInvoicePdf ? `/api/invoices/${downloadInvoicePdf.id}/pdf` : null)

    const { trigger: triggerSendInvoiceByEmail } = usePost(`/api/invoices/send`)
    const { trigger: triggerArchiveInvoice } = usePost(`/api/invoices/archive`)

    useEffect(() => {
        if (downloadInvoicePdf && pdf) {
            pdf.arrayBuffer().then((buffer) => {
                const blob = new Blob([buffer], { type: "application/pdf" })
                const url = URL.createObjectURL(blob)
                const link = document.createElement("a")
                link.href = url
                link.download = `invoice-${downloadInvoicePdf.number}.pdf`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
                setDownloadInvoicePdf(null) // Reset after download
            })
        }
    }, [downloadInvoicePdf, pdf])

    const [searchTerm, setSearchTerm] = useState("")
    const [filter, setFilter] = useState<InvoiceFilter>("all")
    const [searchParams, setSearchParams] = useSearchParams()
    const viewParam = searchParams.get("view")
    const view: InvoiceView = INVOICE_VIEWS.includes(viewParam as InvoiceView) ? (viewParam as InvoiceView) : "list"
    const setView = (next: InvoiceView) => {
        setSearchParams((params) => {
            const updated = new URLSearchParams(params)
            if (next === "list") updated.delete("view")
            else updated.set("view", next)
            return updated
        })
    }
    const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilterKey[]>(["draft", "issued", "sent", "paid"])

    const toggleStatusFilter = (key: InvoiceStatusFilterKey) => {
        setStatusFilter((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]))
    }

    const getStatusFilterKey = (invoice: Invoice): InvoiceStatusFilterKey =>
        invoice.status === InvoiceStatus.DRAFT ? "draft" :
        invoice.status === InvoiceStatus.ISSUED ? "issued" :
        invoice.status === InvoiceStatus.ARCHIVED ? "archived" :
        invoice.status === InvoiceStatus.PAID ? "paid" :
        invoice.status === InvoiceStatus.CANCELLED ? "cancelled" :
        invoice.status === InvoiceStatus.CORRECTED ? "corrected" :
        invoice.status === InvoiceStatus.PENDING_CLEARANCE ? "pending_clearance" :
        invoice.status === InvoiceStatus.CLEARED ? "cleared" :
        "sent"

    const matchesSearch = (invoice: Invoice) =>
        invoice.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.rawNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.number?.toString().includes(searchTerm) ||
        invoice.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus = (invoice: Invoice) => statusFilter.includes(getStatusFilterKey(invoice))

    const upcomingInvoices: Invoice[] = (recurringInvoices?.recurringInvoices || [])
        .filter((recurringInvoice) => !!recurringInvoice.nextInvoiceDate)
        .map((recurringInvoice) => ({
            id: `upcoming-${recurringInvoice.id}`,
            number: 0,
            recurringInvoiceId: recurringInvoice.id,
            clientId: recurringInvoice.clientId,
            companyId: recurringInvoice.companyId,
            client: recurringInvoice.client,
            company: recurringInvoice.company,
            items: [],
            status: InvoiceStatus.UPCOMING,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            dueDate: new Date(recurringInvoice.nextInvoiceDate!).toISOString(),
            paymentMethodId: recurringInvoice.paymentMethodId,
            paymentMethod: recurringInvoice.paymentMethod,
            notes: recurringInvoice.notes,
            discountRate: 0,
            totalHT: recurringInvoice.totalHT,
            totalVAT: recurringInvoice.totalVAT,
            totalTTC: recurringInvoice.totalTTC,
            currency: recurringInvoice.currency,
            isActive: true,
        }))

    const filteredInvoices = [
        ...(invoices?.invoices.filter(
            (invoice) =>
                matchesSearch(invoice) &&
                matchesStatus(invoice) &&
                (filter === "all" || (filter === "recurring" ? !!invoice.recurringInvoiceId : !invoice.recurringInvoiceId)),
        ) || []),
        ...(filter !== "oneTime" ? upcomingInvoices.filter((invoice) => matchesSearch(invoice) && matchesStatus(invoice)) : []),
    ]

    const invoiceStatusCounts = {
        draft: invoices?.invoices.filter((i) => getStatusFilterKey(i) === "draft").length || 0,
        issued: invoices?.invoices.filter((i) => getStatusFilterKey(i) === "issued").length || 0,
        sent: invoices?.invoices.filter((i) => getStatusFilterKey(i) === "sent").length || 0,
        paid: invoices?.invoices.filter((i) => getStatusFilterKey(i) === "paid").length || 0,
        archived: invoices?.invoices.filter((i) => getStatusFilterKey(i) === "archived").length || 0,
        cancelled: invoices?.invoices.filter((i) => getStatusFilterKey(i) === "cancelled").length || 0,
        corrected: invoices?.invoices.filter((i) => getStatusFilterKey(i) === "corrected").length || 0,
    }

    usePageHeader(t("sidebar.navigation.invoices"))

    const handleSendInvoice = (invoice: Invoice) => {
        triggerSendInvoiceByEmail({ id: invoice.id })
            .then((result) => {
                if (result) {
                    toast.success(t("invoices.list.messages.sendByEmailSuccess"))
                    queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                } else {
                    toast.error(t("invoices.list.messages.sendByEmailError"))
                }
            })
            .catch(() => {
                toast.error(t("invoices.list.messages.sendByEmailError"))
            })
    }

    const handleIssueInvoice = (invoice: Invoice) => {
        authenticatedFetch(`/api/invoices/${invoice.id}/issue`, { method: 'POST' })
            .then(async (res) => {
                if (!res.ok) throw new Error('Issue failed')
                toast.success(t("invoices.list.messages.issueSuccess"))
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
            })
            .catch(() => {
                toast.error(t("invoices.list.messages.issueError"))
            })
    }

    const handleArchiveInvoice = (invoice: Invoice) => {
        triggerArchiveInvoice({ invoiceId: invoice.id })
            .then(() => {
                toast.success(t("invoices.list.messages.archiveSuccess"))
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
            })
            .catch(() => {
                toast.error(t("invoices.list.messages.archiveError"))
            })
    }

    const invoiceEmptyState = (
        <div className="text-center py-12">
            <ReceiptText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
                {searchTerm ? t("invoices.emptyState.noResults") : t("invoices.emptyState.noInvoices")}
            </h3>
            <p className="mt-1 text-sm text-primary">
                {searchTerm ? t("invoices.emptyState.tryDifferentSearch") : t("invoices.emptyState.startAdding")}
            </p>
            {!searchTerm && (
                <div className="mt-6">
                    <Button onClick={() => invoiceListRef.current?.handleAddClick()}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t("invoices.actions.addNew")}
                    </Button>
                </div>
            )}
        </div>
    )
    return (
        <div className={cn("mx-auto space-y-6 p-6", view === "progression" || view === "table" ? "max-w-screen-2xl" : "max-w-7xl")}>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <Tabs value={filter} onValueChange={(value) => setFilter(value as InvoiceFilter)}>
                    <TabsList>
                        <TabsTrigger value="all" data-cy="invoice-filter-all">
                            <List className="h-4 w-4 mr-2" />
                            {t("invoices.filters.all")}
                        </TabsTrigger>
                        <TabsTrigger value="oneTime" data-cy="invoice-filter-oneTime">
                            <FileText className="h-4 w-4 mr-2" />
                            {t("invoices.filters.oneTime")}
                        </TabsTrigger>
                        <TabsTrigger value="recurring" data-cy="invoice-filter-recurring">
                            <Repeat className="h-4 w-4 mr-2" />
                            {t("invoices.filters.recurring")}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                <Tabs value={view} onValueChange={(value) => setView(value as InvoiceView)}>
                    <TabsList>
                        <TabsTrigger value="list" data-cy="invoice-view-list">
                            <List className="h-4 w-4 mr-2" />
                            {t("invoices.views.list")}
                        </TabsTrigger>
                        <TabsTrigger value="progression" data-cy="invoice-view-progression">
                            <GitBranch className="h-4 w-4 mr-2" />
                            {t("invoices.progression.title")}
                        </TabsTrigger>
                        <TabsTrigger value="table" data-cy="invoice-view-table">
                            <Table2 className="h-4 w-4 mr-2" />
                            {t("invoices.views.table")}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {view === "progression" ? (
                <>
                    <InvoiceProgression
                        invoices={filteredInvoices.filter((invoice) => invoice.status !== InvoiceStatus.UPCOMING)}
                    onIssue={handleIssueInvoice}
                    onSend={handleSendInvoice}
                    onResend={handleSendInvoice}
                    onArchive={handleArchiveInvoice}
                    onViewInvoice={setViewInvoiceDialog}
                    />
                    <InvoiceViewDialog
                        invoice={viewInvoiceDialog}
                        onOpenChange={(open: boolean) => {
                            if (!open) setViewInvoiceDialog(null)
                        }}
                        onMutate={() => queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })}
                    />
                </>
            ) : view === "table" ? (
                <InvoiceTable />
            ) : (
                <InvoiceList
                    ref={invoiceListRef}
                    invoices={filteredInvoices}
                    loading={false}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    statusFilter={statusFilter}
                    onStatusFilterChange={toggleStatusFilter}
                    statusCounts={invoiceStatusCounts}
                    page={page}
                    pageCount={invoices?.pageCount || 1}
                    setPage={setPage}
                    emptyState={invoiceEmptyState}
                    showCreateButton={true}
                />
            )}
        </div>
    )
}
