"use client"

import { useTranslation } from "react-i18next"

import type { Log, LogLevel } from "../logs.settings"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type LogDetailsDialogProps = {
  log: Log | null
  onClose: () => void
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

export function LogDetailsDialog({ log, onClose }: LogDetailsDialogProps) {
  const { t } = useTranslation()
  if (!log) return null

  return (
    <Dialog open={!!log} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t("settings.logs.details.title")}</span>
            <Badge {...levelBadgeProps(log.level)}>{log.level}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.logs.details.timestamp")}
              </span>
              <p className="mt-1 font-mono text-sm tabular-nums text-foreground">
                {log.timestamp.toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.logs.details.category")}
              </span>
              <p className="mt-1 text-sm font-medium text-foreground">{log.category}</p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.logs.details.userId")}
              </span>
              <p className="mt-1 font-mono text-sm tabular-nums text-foreground">
                {log.userId || t("settings.logs.details.notAvailable")}
              </p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.logs.details.path")}
              </span>
              <p className="mt-1 truncate font-mono text-sm text-foreground">
                {log.path || t("settings.logs.details.notAvailable")}
              </p>
            </div>
          </div>

          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("settings.logs.details.message")}
            </span>
            <p className="mt-1 rounded-md bg-muted p-3 text-sm text-foreground">{log.message}</p>
          </div>

          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("settings.logs.details.detailsJson")}
            </span>
            <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </div>

          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("settings.logs.details.logId")}
            </span>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{log.id}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
