"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useGet, authenticatedFetch } from "@/hooks/use-fetch"
import { usePageHeader } from "@/hooks/use-page-header"
import { FileCheck2, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"
import Pagination from "@/components/pagination"

// ---------------------------------------------------------------------------
// Types (summary shapes of GET /api/compliance/documents and /reports)
// ---------------------------------------------------------------------------

interface PipelineDocument {
  id: string
  invoiceId?: string | null
  invoiceNumber?: string | null
  kind: string
  direction: string
  status: string
  number?: string | null
  channelType?: string | null
  channelProviderId?: string | null
  authorityIds: { scheme: string; value: string }[]
  lastEventType?: string | null
  lastEventAt?: string | null
  createdAt: string
  updatedAt: string
}

interface DocumentsResponse {
  documents: PipelineDocument[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface ComplianceReportSummary {
  id: string
  kind: string
  periodKey: string
  companyId?: string | null
  invoiceRef?: string | null
  status: string
  submittedRef?: string | null
  submittedAt?: string | null
  createdAt: string
  updatedAt: string
}

interface ReportsResponse {
  reports: ComplianceReportSummary[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

// ---------------------------------------------------------------------------
// Filter options + status badges
// ---------------------------------------------------------------------------

const ALL = "ALL"

/** ComplianceStatus enum values (prisma schema). */
const STATUS_OPTIONS = [
  "DRAFT",
  "ISSUED",
  "PENDING_CLEARANCE",
  "CLEARED",
  "REJECTED",
  "CONTINGENCY",
  "DELIVERED",
  "AWAITING_RESPONSE",
  "ACCEPTED",
  "REFUSED",
  "DISPUTED",
  "REPORTED",
  "CANCELLED",
  "CORRECTED",
  "LEGACY",
]

/** ChannelType values (compliance/types.ts). */
const CHANNEL_OPTIONS = ["EMAIL", "PEPPOL", "GOV_PORTAL_API", "PAC", "PDP", "OSE", "SDI", "PRINT"]

/** Same palette as the invoice-view compliance section. */
const STATUS_COLORS: Record<string, string> = {
  CLEARED: "text-emerald-700 bg-emerald-50",
  DELIVERED: "text-emerald-700 bg-emerald-50",
  ACCEPTED: "text-emerald-700 bg-emerald-50",
  REPORTED: "text-emerald-700 bg-emerald-50",
  ISSUED: "text-violet-700 bg-violet-50",
  PENDING_CLEARANCE: "text-amber-700 bg-amber-50",
  AWAITING_RESPONSE: "text-amber-700 bg-amber-50",
  DISPUTED: "text-amber-700 bg-amber-50",
  CONTINGENCY: "text-amber-700 bg-amber-50",
  REJECTED: "text-red-700 bg-red-50",
  REFUSED: "text-red-700 bg-red-50",
  CANCELLED: "text-red-700 bg-red-50",
}

function DocumentStatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "text-slate-500 bg-slate-50"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${color}`}>
      {status.replace(/_/g, " ")}
    </span>
  )
}

const REPORT_STATUS_COLORS: Record<string, string> = {
  PENDING: "text-amber-700 bg-amber-50",
  SUBMITTED: "text-emerald-700 bg-emerald-50",
  FILED: "text-emerald-700 bg-emerald-50",
}

function ReportStatusBadge({ status }: { status: string }) {
  const color = REPORT_STATUS_COLORS[status] ?? "text-slate-500 bg-slate-50"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {status}
    </span>
  )
}

function formatDateTime(value?: string | null): string {
  return value ? format(new Date(value), "yyyy-MM-dd HH:mm") : "—"
}

// ---------------------------------------------------------------------------
// Pipeline section — the submission queue across all invoices
// ---------------------------------------------------------------------------

function PipelineSection() {
  const { t } = useTranslation()

  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [channelFilter, setChannelFilter] = useState(ALL)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const params = new URLSearchParams({ page: String(page), pageSize: "20" })
  if (statusFilter !== ALL) params.set("status", statusFilter)
  if (channelFilter !== ALL) params.set("channel", channelFilter)

  const { data, loading, mutate: refetch } = useGet<DocumentsResponse>(`/api/compliance/documents?${params.toString()}`)

  const handleRefreshStatus = async (doc: PipelineDocument) => {
    setRefreshingId(doc.id)
    try {
      const res = await authenticatedFetch(`/api/compliance/documents/${doc.id}/refresh`, { method: "POST" })
      if (!res.ok) throw new Error("Refresh failed")
      toast.success(t("compliance.pipeline.messages.refreshSuccess", "Status refreshed"))
      refetch()
    } catch {
      toast.error(t("compliance.pipeline.messages.refreshError", "Failed to refresh status"))
    } finally {
      setRefreshingId(null)
    }
  }

  const documents = data?.documents ?? []

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("compliance.pipeline.title", "Submission pipeline")}</h2>
          <p className="text-muted-foreground text-sm">
            {t(
              "compliance.pipeline.description",
              "Every e-invoicing submission with its channel, authority references and latest lifecycle event.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val)
              setPage(1)
            }}
          >
            <SelectTrigger size="sm" className="w-[190px]" data-cy="compliance-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("compliance.pipeline.filters.allStatuses", "All statuses")}</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={channelFilter}
            onValueChange={(val) => {
              setChannelFilter(val)
              setPage(1)
            }}
          >
            <SelectTrigger size="sm" className="w-[170px]" data-cy="compliance-channel-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("compliance.pipeline.filters.allChannels", "All channels")}</SelectItem>
              {CHANNEL_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <ShieldCheck className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">{t("compliance.pipeline.emptyState.title", "No compliance documents")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t(
                  "compliance.pipeline.emptyState.description",
                  "Issue an invoice to start tracking its e-invoicing submission here.",
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("compliance.pipeline.columns.document", "Document")}</TableHead>
                  <TableHead>{t("compliance.pipeline.columns.kind", "Kind")}</TableHead>
                  <TableHead>{t("compliance.pipeline.columns.status", "Status")}</TableHead>
                  <TableHead>{t("compliance.pipeline.columns.channel", "Channel")}</TableHead>
                  <TableHead>{t("compliance.pipeline.columns.authorityRefs", "Authority refs")}</TableHead>
                  <TableHead>{t("compliance.pipeline.columns.lastEvent", "Last event")}</TableHead>
                  <TableHead className="text-right">{t("compliance.pipeline.columns.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id} data-cy="compliance-document-row">
                    <TableCell className="font-medium whitespace-nowrap">
                      {doc.number ?? doc.invoiceNumber ?? (
                        <span className="text-muted-foreground text-xs font-mono">{doc.id.slice(0, 8)}</span>
                      )}
                      {doc.direction === "INBOUND" && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {t("compliance.pipeline.direction.inbound", "Inbound")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {doc.kind.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      <DocumentStatusBadge status={doc.status} />
                    </TableCell>
                    <TableCell>
                      {doc.channelType ? (
                        <Badge variant="outline" className="text-xs">
                          {doc.channelType}
                          {doc.channelProviderId ? `/${doc.channelProviderId}` : ""}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {doc.authorityIds.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {doc.authorityIds.map((a, i) => (
                            <span key={i} className="text-xs font-mono text-muted-foreground break-all">
                              {a.scheme}: {a.value}
                            </span>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {doc.lastEventType ? (
                        <div>
                          <p className="text-xs font-medium">{doc.lastEventType.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(doc.lastEventAt)}</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={refreshingId === doc.id}
                        onClick={() => handleRefreshStatus(doc)}
                        data-cy="compliance-refresh-button"
                      >
                        <RefreshCw className={`h-4 w-4 mr-1 ${refreshingId === doc.id ? "animate-spin" : ""}`} />
                        {t("compliance.pipeline.actions.refresh", "Refresh")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {(data?.pageCount ?? 1) > 1 && (
            <Pagination page={page} pageCount={data?.pageCount ?? 1} setPage={setPage} />
          )}
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Reports section — read-only ComplianceReport listing (periodic filings)
// ---------------------------------------------------------------------------

function ReportsSection() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  const { data, loading } = useGet<ReportsResponse>(`/api/compliance/reports?page=${page}&pageSize=10`)

  const reports = data?.reports ?? []

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("compliance.reports.title", "Reporting")}</h2>
        <p className="text-muted-foreground text-sm">
          {t(
            "compliance.reports.description",
            "Periodic filings generated for tax authorities (e-reporting, SAF-T, OSS…).",
          )}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 gap-3">
            <FileCheck2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("compliance.reports.emptyState", "No compliance reports generated yet.")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("compliance.reports.columns.kind", "Kind")}</TableHead>
                  <TableHead>{t("compliance.reports.columns.period", "Period")}</TableHead>
                  <TableHead>{t("compliance.reports.columns.status", "Status")}</TableHead>
                  <TableHead>{t("compliance.reports.columns.submittedRef", "Submission ref")}</TableHead>
                  <TableHead>{t("compliance.reports.columns.submittedAt", "Submitted at")}</TableHead>
                  <TableHead>{t("compliance.reports.columns.createdAt", "Created at")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id} data-cy="compliance-report-row">
                    <TableCell className="font-medium whitespace-nowrap">{report.kind.replace(/_/g, " ")}</TableCell>
                    <TableCell className="whitespace-nowrap">{report.periodKey}</TableCell>
                    <TableCell>
                      <ReportStatusBadge status={report.status} />
                    </TableCell>
                    <TableCell className="text-xs font-mono break-all">{report.submittedRef ?? "—"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatDateTime(report.submittedAt)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(report.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {(data?.pageCount ?? 1) > 1 && (
            <Pagination page={page} pageCount={data?.pageCount ?? 1} setPage={setPage} />
          )}
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Compliance() {
  const { t } = useTranslation()

  usePageHeader(t("compliance.title", "Compliance"), <ShieldCheck className="h-5 w-5 text-blue-600" />)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">{t("compliance.title", "Compliance")}</h1>
        <p className="text-muted-foreground text-sm">
          {t(
            "compliance.description",
            "Track e-invoicing submissions and periodic tax filings across all channels.",
          )}
        </p>
      </div>

      <PipelineSection />
      <ReportsSection />
    </div>
  )
}
