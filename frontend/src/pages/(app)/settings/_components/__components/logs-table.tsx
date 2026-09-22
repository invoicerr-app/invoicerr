"use client"

import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { Log, LogLevel } from "../logs.settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type LogsTableProps = {
  logs: Log[]
  onSelectLog: (log: Log) => void
}

/** The chip a log LEVEL renders as — see `logs-filters.tsx`'s own copy of this mapping for why it is
 *  duplicated per-file rather than shared. */
function levelBadgeProps(level: LogLevel): {
  variant?: "secondary" | "warning" | "info" | "destructive"
  className?: string
} {
  switch (level) {
    case "DEBUG":
      return { variant: "secondary" }
    case "INFO":
      return { variant: "info" }
    case "WARN":
      return { variant: "warning" }
    case "ERROR":
      return { className: "border-transparent bg-destructive-soft text-destructive-soft-foreground" }
    case "FATAL":
      return { variant: "destructive" }
  }
}

const ITEMS_PER_PAGE = 50

export function LogsTable({ logs, onSelectLog }: LogsTableProps) {
  const { t } = useTranslation()
  const [currentPage, setCurrentPage] = useState(1)

  const totalPages = Math.ceil(logs.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const currentLogs = logs.slice(startIndex, endIndex)

  function formatTime(date: Date) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date)
  }

  function formatDate(date: Date) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date)
  }

  if (logs.length === 0) {
    return (
      <EmptyState icon={ScrollText} size="sm" title={t("settings.logs.table.empty")} data-cy="logs-empty" />
    )
  }

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">{t("settings.logs.table.timestamp")}</TableHead>
              <TableHead className="w-[100px]">{t("settings.logs.table.level")}</TableHead>
              <TableHead className="w-[150px]">{t("settings.logs.table.category")}</TableHead>
              <TableHead>{t("settings.logs.table.message")}</TableHead>
              <TableHead className="w-[120px]">{t("settings.logs.table.userId")}</TableHead>
              <TableHead className="w-[200px]">{t("settings.logs.table.path")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentLogs.map((log) => (
              <TableRow
                key={log.id}
                className="cursor-pointer hover:bg-accent"
                onClick={() => onSelectLog(log)}
              >
                <TableCell className="font-mono text-sm tabular-nums">
                  <div className="flex flex-col">
                    <span className="text-foreground">{formatTime(log.timestamp)}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(log.timestamp)}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge {...levelBadgeProps(log.level)}>{log.level}</Badge>
                </TableCell>
                <TableCell className="font-medium text-foreground">{log.category}</TableCell>
                <TableCell className="max-w-[400px] truncate text-foreground">{log.message}</TableCell>
                <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                  {log.userId || "-"}
                </TableCell>
                <TableCell className="truncate font-mono text-sm tabular-nums text-muted-foreground">
                  {log.path || "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground tabular-nums">
            {t("settings.logs.table.page", { page: currentPage, total: totalPages })}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft />
              {t("settings.logs.table.previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              {t("settings.logs.table.next")}
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
