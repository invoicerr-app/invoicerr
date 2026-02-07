"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Log, LogLevel } from "../logs.settings"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type LogsTableProps = {
  logs: Log[]
  onSelectLog: (log: Log) => void
}

const levelColors: Record<LogLevel, string> = {
  DEBUG: "bg-muted text-muted-foreground",
  INFO: "bg-blue-500/10 text-blue-500",
  WARN: "bg-yellow-500/10 text-yellow-500",
  ERROR: "bg-red-500/10 text-red-500",
  FATAL: "bg-purple-500/10 text-purple-500",
}

const ITEMS_PER_PAGE = 50

export function LogsTable({ logs, onSelectLog }: LogsTableProps) {
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

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Timestamp</TableHead>
              <TableHead className="w-[100px]">Level</TableHead>
              <TableHead className="w-[150px]">Category</TableHead>
              <TableHead>Message</TableHead>
              <TableHead className="w-[120px]">User ID</TableHead>
              <TableHead className="w-[200px]">Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  No logs found
                </TableCell>
              </TableRow>
            ) : (
              currentLogs.map((log) => (
                <TableRow key={log.id} className="cursor-pointer hover:bg-accent" onClick={() => onSelectLog(log)}>
                  <TableCell className="font-mono text-sm">
                    <div className="flex flex-col">
                      <span className="text-foreground">{formatTime(log.timestamp)}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(log.timestamp)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={levelColors[log.level]} variant="secondary">
                      {log.level}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{log.category}</TableCell>
                  <TableCell className="max-w-[400px] truncate text-foreground">{log.message}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{log.userId || "-"}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground truncate">{log.path || "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
