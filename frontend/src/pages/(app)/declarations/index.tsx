import { Gavel, SearchX } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import BetterPagination from "@/components/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDeclarations } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * Makes visible what `reporting/report-on-send.ts` already does silently
 * after every "send": which declaration went out, when, with what status, and its error if any. Since
 * the five-country pivot only Portugal ("pt-at") has a declaration provider at all (status:
 * implemented-awaiting-accreditation — see `reporting/providers/pt-declaration-provider.ts`'s own
 * header), so this screen is honest about that: `hasObligation` (from the backend's own
 * `listDeclarations`) is what lets it say "no declaration obligation for this country" plainly,
 * rather than showing a permanently empty table that looks like a loading bug.
 *
 * `statusCode`/`reason` are the PLATFORM's own words (pt-at: "ACCEPTED"/"REJECTED"; this codebase's
 * own synthetic "report:blocked"/"report:failed" for a missing credential or an exhausted retry — see
 * `reporting/report-job.ts`) — shown verbatim when this screen has no friendlier label for one, the
 * same convention `document-conformity-section.tsx` already holds for its own per-document timeline.
 */

const STATUS_LABEL_KEY: Record<string, string> = {
  ACCEPTED: "declarations.status.accepted",
  REJECTED: "declarations.status.rejected",
  "report:blocked": "declarations.status.blocked",
  "report:failed": "declarations.status.failed",
}

// Theme tokens only (index.css) — the same success/destructive/warning triad every other status
// chip in the app already renders through (see document-settlement.tsx's own TONE_CLASSES header).
const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning"> = {
  ACCEPTED: "success",
  REJECTED: "destructive",
  "report:blocked": "warning",
  "report:failed": "warning",
}

const ALL_STATUSES_VALUE = "all"

export default function DeclarationsPage() {
  const { t } = useTranslation()
  usePageHeader(t("sidebar.navigation.declarations"))

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const { data, isLoading } = useDeclarations(page, status)

  const declarations = data?.declarations ?? []
  const statusCodes = data?.statusCodes ?? []

  function statusLabel(code: string): string {
    const key = STATUS_LABEL_KEY[code]
    return key ? t(key) : code
  }

  function handleStatusChange(value: string) {
    setStatus(value === ALL_STATUSES_VALUE ? undefined : value)
    setPage(1)
  }

  // Zero rows can mean three different, non-interchangeable things — never collapsed into one
  // generic "nothing here": a filter that matched nothing (data DOES exist, just not this status), a
  // country with no reporting obligation at all (nothing will EVER show up here), or a country WITH
  // an obligation that simply hasn't produced a declaration yet (a real "so far, so good").
  const emptyMessage = status
    ? t("declarations.emptyState.noResults")
    : !data?.hasObligation
      ? t("declarations.emptyState.noObligation")
      : t("declarations.emptyState.noDeclarations")

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6" data-cy="declarations-page">
      <p className="text-sm text-muted-foreground">{t("declarations.description")}</p>

      <Card className="gap-0">
        <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
          <Select value={status ?? ALL_STATUSES_VALUE} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full sm:w-64" dataCy="declarations-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES_VALUE} dataCy="declarations-status-option-all">
                {t("declarations.filters.allStatuses")}
              </SelectItem>
              {statusCodes.map((code) => (
                <SelectItem key={code} value={code} dataCy={`declarations-status-option-${code}`}>
                  {statusLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6" data-cy="declarations-loading">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : declarations.length === 0 ? (
            <EmptyState
              icon={status ? SearchX : Gavel}
              title={emptyMessage}
              action={
                status && (
                  <Button variant="outline" onClick={() => handleStatusChange(ALL_STATUSES_VALUE)}>
                    {t("common.emptyState.clearFilters")}
                  </Button>
                )
              }
              data-cy={!status && !data?.hasObligation ? "declarations-no-obligation" : "declarations-empty"}
            />
          ) : (
            <Table data-cy="declarations-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("declarations.table.document")}</TableHead>
                  <TableHead>{t("declarations.table.country")}</TableHead>
                  <TableHead>{t("declarations.table.provider")}</TableHead>
                  <TableHead>{t("declarations.table.status")}</TableHead>
                  <TableHead>{t("declarations.table.date")}</TableHead>
                  <TableHead>{t("declarations.table.error")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {declarations.map((declaration) => (
                  <TableRow key={declaration.id} data-cy={`declaration-row-${declaration.id}`}>
                    <TableCell data-cy="declaration-document">
                      {declaration.displayNumber ?? declaration.documentId}
                    </TableCell>
                    <TableCell>{declaration.countryCode ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{declaration.providerId}</TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANT[declaration.statusCode] ?? "secondary"}
                        data-cy="declaration-status-badge"
                      >
                        {statusLabel(declaration.statusCode)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(declaration.observedAt).toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="max-w-[280px] truncate text-destructive"
                      data-cy="declaration-error"
                    >
                      {declaration.reason ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && data.pageCount > 1 && (
        <BetterPagination pageCount={data.pageCount} page={page} setPage={setPage} />
      )}
    </div>
  )
}
