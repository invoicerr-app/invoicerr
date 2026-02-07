"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Log, LogLevel } from "../logs.settings"
import { Badge } from "@/components/ui/badge"

type LogDetailsDialogProps = {
  log: Log | null
  onClose: () => void
}

const levelColors: Record<LogLevel, string> = {
  DEBUG: "bg-muted text-muted-foreground",
  INFO: "bg-blue-500/10 text-blue-500",
  WARN: "bg-yellow-500/10 text-yellow-500",
  ERROR: "bg-red-500/10 text-red-500",
  FATAL: "bg-purple-500/10 text-purple-500",
}

export function LogDetailsDialog({ log, onClose }: LogDetailsDialogProps) {
  if (!log) return null

  return (
    <Dialog open={!!log} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Log Details</span>
            <Badge className={levelColors[log.level]} variant="secondary">
              {log.level}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Timestamp</label>
              <p className="text-sm font-mono mt-1 text-foreground">{log.timestamp.toLocaleString()}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Category</label>
              <p className="text-sm font-medium mt-1 text-foreground">{log.category}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">User ID</label>
              <p className="text-sm font-mono mt-1 text-foreground">{log.userId || "N/A"}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Path</label>
              <p className="text-sm font-mono mt-1 text-foreground truncate">{log.path || "N/A"}</p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Message</label>
            <p className="text-sm mt-1 p-3 bg-muted rounded-md text-foreground">{log.message}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Details (JSON)</label>
            <pre className="text-xs mt-1 p-3 bg-muted rounded-md overflow-x-auto font-mono text-foreground">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Log ID</label>
            <p className="text-xs font-mono mt-1 text-muted-foreground">{log.id}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
