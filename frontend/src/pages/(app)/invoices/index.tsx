import { ReceiptText, Plus, List, FileText, Repeat, GitBranch, Table2, ScrollText } from "lucide-react"
import { InvoiceList, type InvoiceListHandle } from "@/pages/(app)/invoices/_components/invoice-list"
import { InvoiceProgression } from "@/pages/(app)/invoices/_components/invoice-progression"
import { InvoiceTable } from "@/pages/(app)/invoices/_components/invoice-table"
import { InvoiceViewDialog } from "@/pages/(app)/invoices/_components/invoice-view"
import { useEffect, useRef, useState } from "react"
import { useGetRaw, usePost, authenticatedFetch } from "@/hooks/use-fetch"
import { useCompany, useDocumentKinds, useInvoices, useRecurringInvoices } from "@/hooks/queries"
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

const DEFAULT_FILTERS = ["all", "oneTime", "recurring"] as const
type DefaultInvoiceFilter = (typeof DEFAULT_FILTERS)[number]

/**
 * A tab value: one of the three built-ins, or `kind:<KIND>` for a document kind the backend
 * reported as non-legal. Kept as a plain string on purpose — the kinds are country data, so this
 * component must never enumerate them.
 */
const KIND_FILTER_PREFIX = "kind:"

const isDefaultFilter = (value: string): value is DefaultInvoiceFilter =>
  (DEFAULT_FILTERS as readonly string[]).includes(value)

type InvoiceView = "list" | "progression" | "table"

const INVOICE_VIEWS: InvoiceView[] = ["list", "progression", "table"]

export default function Invoices() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const invoiceListRef = useRef<InvoiceListHandle>(null)

  const [page, setPage] = useState(1)
  const { data: invoices } = useInvoices(page)
  const { data: recurringInvoices } = useRecurringInvoices()
  // Which document kinds this company's country uses, and which of them are NOT legal documents.
  // The answer is the compliance engine's, never this component's: a pro forma is not an invoice —
  // it takes no number from the legal series, is never issued, transmitted or archived — but where
  // that line falls is a country rule. Asking keeps the rule in the profiles and out of the UI.
  // No country resolved (company still loading, countryCode never filled in) means no answer, and
  // the page then renders exactly as it always did rather than guessing.
  const { data: company } = useCompany()
  const { data: documentKinds } = useDocumentKinds(company?.countryCode)
  const commercialKinds = (documentKinds ?? []).filter((rule) => !rule.legalDocument).map((rule) => rule.kind)
  const [downloadInvoicePdf, setDownloadInvoicePdf] = useState<Invoice | null>(null)
  const [viewInvoiceDialog, setViewInvoiceDialog] = useState<Invoice | null>(null)
  const { data: pdf } = useGetRaw<Response>(
    downloadInvoicePdf ? `/api/invoices/${downloadInvoicePdf.id}/pdf` : null,
  )

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
  const [filter, setFilter] = useState<string>("all")
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get("view")
  const view: InvoiceView = INVOICE_VIEWS.includes(viewParam as InvoiceView)
    ? (viewParam as InvoiceView)
    : "list"
  const setView = (next: InvoiceView) => {
    setSearchParams((params) => {
      const updated = new URLSearchParams(params)
      if (next === "list") updated.delete("view")
      else updated.set("view", next)
      return updated
    })
  }
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilterKey[]>([
    "draft",
    "issued",
    "sent",
    "paid",
    // F-008: on by default, deliberately. A rejected invoice left out of the default filter is
    // worse than one mislabelled "sent" — it disappears from the list entirely, and the user has
    // no reason to go looking for it. A rejection is the one outcome that must not need a click.
    "rejected",
  ])

  const toggleStatusFilter = (key: InvoiceStatusFilterKey) => {
    setStatusFilter((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )
  }

  const getStatusFilterKey = (invoice: Invoice): InvoiceStatusFilterKey =>
    invoice.status === InvoiceStatus.DRAFT
      ? "draft"
      : invoice.status === InvoiceStatus.ISSUED
        ? "issued"
        : invoice.status === InvoiceStatus.ARCHIVED
          ? "archived"
          : invoice.status === InvoiceStatus.PAID
            ? "paid"
            : invoice.status === InvoiceStatus.CANCELLED
              ? "cancelled"
              : invoice.status === InvoiceStatus.CORRECTED
                ? "corrected"
                : invoice.status === InvoiceStatus.PENDING_CLEARANCE
                  ? "pending_clearance"
                  : invoice.status === InvoiceStatus.CLEARED
                    ? "cleared"
                    : invoice.status === InvoiceStatus.REJECTED ||
                        invoice.status === InvoiceStatus.REFUSED ||
                        invoice.status === InvoiceStatus.TRANSMISSION_FAILED
                      ? "rejected"
                      : "sent"

  const matchesSearch = (invoice: Invoice) =>
    invoice.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.rawNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    invoice.number?.toString().includes(searchTerm) ||
    invoice.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())

  const matchesStatus = (invoice: Invoice) => statusFilter.includes(getStatusFilterKey(invoice))

  const selectedKind = commercialKinds.find((kind) => filter === `${KIND_FILTER_PREFIX}${kind}`) ?? null
  // Self-healing: a kind tab can stop being offered between renders (the kinds arrive after the
  // first paint, the active company changes country). Falling back to "all" keeps the group from
  // showing no active tab over an empty list.
  const activeFilter = selectedKind !== null || isDefaultFilter(filter) ? filter : "all"

  const isCommercialDocument = (invoice: Invoice) => !!invoice.kind && commercialKinds.includes(invoice.kind)

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
    ...(invoices?.invoices.filter((invoice) => {
      if (!matchesSearch(invoice) || !matchesStatus(invoice)) return false
      // A commercial-kind tab shows that kind and nothing else — including no recurring/one-time
      // split, which is a property of the legal series and says nothing about a pro forma.
      if (selectedKind) return invoice.kind === selectedKind
      // ...and the three built-in tabs are the legal series only. This is the separation the whole
      // feature exists for: a document the country does not number, issue or archive must not sit
      // in the same list as the ones it does.
      if (isCommercialDocument(invoice)) return false
      return (
        activeFilter === "all" ||
        (activeFilter === "recurring" ? !!invoice.recurringInvoiceId : !invoice.recurringInvoiceId)
      )
    }) || []),
    // Upcoming rows are projections of recurring templates, not stored documents: they carry no
    // kind, so a commercial-kind tab never shows them.
    ...(!selectedKind && activeFilter !== "oneTime"
      ? upcomingInvoices.filter((invoice) => matchesSearch(invoice) && matchesStatus(invoice))
      : []),
  ]

  // Counted over the same document scope the list is showing, so a status badge never counts a
  // document the active tab hides.
  const countedInvoices = (invoices?.invoices || []).filter((invoice) =>
    selectedKind ? invoice.kind === selectedKind : !isCommercialDocument(invoice),
  )

  const invoiceStatusCounts = {
    draft: countedInvoices.filter((i) => getStatusFilterKey(i) === "draft").length,
    issued: countedInvoices.filter((i) => getStatusFilterKey(i) === "issued").length,
    sent: countedInvoices.filter((i) => getStatusFilterKey(i) === "sent").length,
    paid: countedInvoices.filter((i) => getStatusFilterKey(i) === "paid").length,
    archived: countedInvoices.filter((i) => getStatusFilterKey(i) === "archived").length,
    cancelled: countedInvoices.filter((i) => getStatusFilterKey(i) === "cancelled").length,
    corrected: countedInvoices.filter((i) => getStatusFilterKey(i) === "corrected").length,
    rejected: countedInvoices.filter((i) => getStatusFilterKey(i) === "rejected").length,
  }

  usePageHeader(t("sidebar.navigation.invoices"))

  const handleSendInvoice = (invoice: Invoice) => {
    triggerSendInvoiceByEmail({ id: invoice.id })
      .then((result) => {
        if (!result) {
          toast.error(t("invoices.list.messages.sendByEmailError"))
        } else {
          // Same distinction as the detail dialog: `delivered === false` means the document is in
          // a queue, and the outcome — including failure — arrives afterwards.
          toast[result.delivered === false ? "info" : "success"](
            t(
              result.delivered === false
                ? "invoices.list.messages.sendSubmitted"
                : "invoices.list.messages.sendByEmailSuccess",
            ),
          )
          queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
        }
      })
      .catch(() => {
        toast.error(t("invoices.list.messages.sendByEmailError"))
      })
  }

  const handleIssueInvoice = (invoice: Invoice) => {
    authenticatedFetch(`/api/invoices/${invoice.id}/issue`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Issue failed")
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
    <div
      className={cn(
        "mx-auto space-y-6 p-6",
        view === "progression" || view === "table" ? "max-w-screen-2xl" : "max-w-7xl",
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Tabs value={activeFilter} onValueChange={setFilter}>
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
            {/* One tab per non-legal kind the country offers — today that is the pro forma, and
                nowhere here says so. A jurisdiction that stops offering it drops the tab by
                returning one less rule. The label falls back to the kind itself so a kind this
                build predates still reads as something. */}
            {commercialKinds.map((kind) => (
              <TabsTrigger
                key={kind}
                value={`${KIND_FILTER_PREFIX}${kind}`}
                data-cy={`invoice-filter-kind-${kind.toLowerCase()}`}
              >
                <ScrollText className="h-4 w-4 mr-2" />
                {t(`invoices.filters.kinds.${kind.toLowerCase()}`, kind)}
              </TabsTrigger>
            ))}
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
            onOpenInvoice={(id: string) => {
              // Fetch it rather than hunt the list: the draft was created a moment ago and the
              // list query may not have refreshed yet.
              authenticatedFetch(`/api/invoices/${id}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((next) => {
                  if (next) setViewInvoiceDialog(next as Invoice)
                })
            }}
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
