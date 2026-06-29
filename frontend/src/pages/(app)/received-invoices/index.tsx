"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useGet, authenticatedFetch } from "@/hooks/use-fetch"
import { useCompany } from "@/hooks/queries/use-company"
import { usePageHeader } from "@/hooks/use-page-header"
import { Download, Eye, Inbox, Loader2, ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"
import Pagination from "@/components/pagination"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InboundStatus = "RECEIVED" | "PARSED" | "ACCEPTED" | "REJECTED"

interface InboundInvoiceSummary {
  id: string
  channel: string
  providerId?: string
  externalId: string
  senderId?: string
  syntax?: string
  invoiceNumber?: string
  issueDate?: string
  sellerName?: string
  sellerTaxId?: string
  buyerTaxId?: string
  currency?: string
  totalNet?: number
  totalTax?: number
  totalGross?: number
  status: InboundStatus
  receivedAt: string
}

interface InboundInvoiceDetail extends InboundInvoiceSummary {
  rawPayload: string
}

interface ListResponse {
  invoices: InboundInvoiceSummary[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<InboundStatus, string> = {
  RECEIVED: "bg-gray-100 text-gray-700",
  PARSED: "bg-blue-100 text-blue-700",
  ACCEPTED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
}

function StatusBadge({ status }: { status: InboundStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {t(`receivedInvoices.status.${status}`, status)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

function InboundDetailDialog({
  invoiceId,
  companyId,
  open,
  onOpenChange,
  onAction,
}: {
  invoiceId: string | null
  companyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: () => void
}) {
  const { t } = useTranslation()
  const { data: invoice, loading } = useGet<InboundInvoiceDetail>(
    invoiceId && open ? `/api/compliance/received-invoices/${companyId}/${invoiceId}` : null,
  )

  const handleDownloadRaw = () => {
    if (!invoice) return
    const ext = invoice.rawPayload.trimStart().startsWith("{") ? "json" : "xml"
    const blob = new Blob([invoice.rawPayload], { type: ext === "json" ? "application/json" : "application/xml" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `invoice-${invoice.externalId}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleAccept = async () => {
    if (!invoice) return
    const res = await authenticatedFetch(`/api/compliance/received-invoices/${companyId}/${invoice.id}/accept`, { method: "POST" })
    if (res.ok) {
      toast.success(t("receivedInvoices.actions.acceptSuccess", "Invoice accepted"))
      onAction()
      onOpenChange(false)
    } else {
      toast.error(t("receivedInvoices.actions.acceptError", "Failed to accept invoice"))
    }
  }

  const handleReject = async () => {
    if (!invoice) return
    const res = await authenticatedFetch(`/api/compliance/received-invoices/${companyId}/${invoice.id}/reject`, {
      method: "POST",
      body: JSON.stringify({}),
    })
    if (res.ok) {
      toast.success(t("receivedInvoices.actions.rejectSuccess", "Invoice rejected"))
      onAction()
      onOpenChange(false)
    } else {
      toast.error(t("receivedInvoices.actions.rejectError", "Failed to reject invoice"))
    }
  }

  const canAct = invoice && invoice.status !== "ACCEPTED" && invoice.status !== "REJECTED"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("receivedInvoices.detail.title", "Invoice Detail")}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : invoice ? (
          <div className="overflow-auto flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 bg-muted/50 p-4 rounded-lg text-sm">
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.invoiceNumber", "Invoice number")}</p>
                <p className="font-medium">{invoice.invoiceNumber ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.issueDate", "Issue date")}</p>
                <p className="font-medium">{invoice.issueDate ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.sellerName", "Seller")}</p>
                <p className="font-medium">{invoice.sellerName ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.sellerTaxId", "Seller tax ID")}</p>
                <p className="font-medium">{invoice.sellerTaxId ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.buyerTaxId", "Buyer tax ID")}</p>
                <p className="font-medium">{invoice.buyerTaxId ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.currency", "Currency")}</p>
                <p className="font-medium">{invoice.currency ?? "—"}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 bg-muted/50 p-4 rounded-lg text-sm">
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.totalNet", "Net amount")}</p>
                <p className="font-medium">{invoice.totalNet != null ? `${invoice.totalNet.toFixed(2)} ${invoice.currency ?? ""}`.trim() : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.totalTax", "Tax amount")}</p>
                <p className="font-medium">{invoice.totalTax != null ? `${invoice.totalTax.toFixed(2)} ${invoice.currency ?? ""}`.trim() : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.totalGross", "Gross amount")}</p>
                <p className="font-medium font-bold">{invoice.totalGross != null ? `${invoice.totalGross.toFixed(2)} ${invoice.currency ?? ""}`.trim() : "—"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-muted/50 p-4 rounded-lg text-sm">
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.channel", "Channel")}</p>
                <p className="font-medium">{invoice.channel}{invoice.providerId ? ` (${invoice.providerId})` : ""}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.externalId", "External ID")}</p>
                <p className="font-medium font-mono text-xs break-all">{invoice.externalId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.detail.receivedAt", "Received at")}</p>
                <p className="font-medium">{format(new Date(invoice.receivedAt), "PPP p")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("receivedInvoices.columns.status", "Status")}</p>
                <StatusBadge status={invoice.status} />
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleDownloadRaw}>
                <Download className="h-4 w-4 mr-1.5" />
                {t("receivedInvoices.detail.downloadRaw", "Download raw")}
              </Button>
              {canAct && (
                <>
                  <Button variant="outline" size="sm" className="text-emerald-700 hover:text-emerald-700" onClick={handleAccept}>
                    <ThumbsUp className="h-4 w-4 mr-1.5" />
                    {t("receivedInvoices.actions.accept", "Accept")}
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleReject}>
                    <ThumbsDown className="h-4 w-4 mr-1.5" />
                    {t("receivedInvoices.actions.reject", "Reject")}
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ReceivedInvoices() {
  const { t } = useTranslation()
  const { data: company } = useCompany()
  const companyId = company?.id

  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const {
    data: listData,
    loading,
    mutate: refetch,
  } = useGet<ListResponse>(
    companyId ? `/api/compliance/received-invoices/${companyId}?page=${page}&pageSize=20` : null,
  )

  usePageHeader(t("receivedInvoices.title", "Received Invoices"))

  const handleView = (id: string) => {
    setSelectedId(id)
    setDetailOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const invoices = listData?.invoices ?? []

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">{t("receivedInvoices.title", "Received Invoices")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("receivedInvoices.description", "Supplier invoices received via e-invoicing channels.")}
        </p>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Inbox className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">{t("receivedInvoices.emptyState.title", "No received invoices")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t(
                  "receivedInvoices.emptyState.description",
                  "Supplier invoices received via PDP, SdI, Peppol or KSeF will appear here.",
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-lg border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("receivedInvoices.columns.date", "Date")}</TableHead>
                  <TableHead>{t("receivedInvoices.columns.number", "Invoice No.")}</TableHead>
                  <TableHead>{t("receivedInvoices.columns.sender", "Sender")}</TableHead>
                  <TableHead>{t("receivedInvoices.columns.amount", "Amount")}</TableHead>
                  <TableHead>{t("receivedInvoices.columns.channel", "Channel")}</TableHead>
                  <TableHead>{t("receivedInvoices.columns.status", "Status")}</TableHead>
                  <TableHead className="text-right">{t("receivedInvoices.columns.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {inv.issueDate ?? format(new Date(inv.receivedAt), "yyyy-MM-dd")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {inv.invoiceNumber ?? <span className="text-muted-foreground text-xs">{inv.externalId.slice(0, 16)}</span>}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{inv.sellerName ?? inv.senderId ?? "—"}</p>
                        {inv.sellerTaxId && <p className="text-xs text-muted-foreground">{inv.sellerTaxId}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {inv.totalGross != null ? (
                        <span>
                          {inv.totalGross.toFixed(2)}
                          {inv.currency ? <span className="text-xs text-muted-foreground ml-1">{inv.currency}</span> : null}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {inv.channel}{inv.providerId ? `/${inv.providerId}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleView(inv.id)}>
                        <Eye className="h-4 w-4 mr-1" />
                        {t("receivedInvoices.actions.view", "View")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {(listData?.pageCount ?? 1) > 1 && (
            <Pagination
              page={page}
              pageCount={listData?.pageCount ?? 1}
              setPage={setPage}
            />
          )}
        </>
      )}

      {companyId && (
        <InboundDetailDialog
          invoiceId={selectedId}
          companyId={companyId}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onAction={refetch}
        />
      )}
    </div>
  )
}
