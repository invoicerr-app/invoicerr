import { Clock, Edit, Plus, Receipt, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCompany, useDeleteTimeEntry, useTimeEntries } from "@/hooks/queries"
import { currencies } from "@/lib/constants/currencies"
import type { GenerateInvoiceFromTimeEntriesResult, Project, TimeEntry } from "@/types"

import { GenerateInvoiceDialog } from "./generate-invoice-dialog"
import { TimeEntryUpsert } from "./time-entry-upsert"

interface TimeEntryListProps {
  project: Project
}

function amountFor(entry: TimeEntry): number {
  return (entry.durationMinutes / 60) * (entry.effectiveHourlyRate ?? 0)
}

export function TimeEntryList({ project }: TimeEntryListProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: company } = useCompany()
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : ""

  const { data: entries = [], isLoading } = useTimeEntries({ projectId: project.id })
  const { mutateAsync: deleteEntry } = useDeleteTimeEntry()

  const [createOpen, setCreateOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null)
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<TimeEntry | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Only an UNBILLED, BILLABLE entry is ever selectable — the exact same pair of conditions the
  // backend's own `billToInvoice` enforces (time-entries.service.ts), so a checkbox never offers what
  // the API would refuse anyway.
  const selectableEntries = useMemo(
    () => entries.filter((entry) => entry.billable && !entry.invoiceId),
    [entries],
  )
  const selectedEntries = useMemo(
    () => selectableEntries.filter((entry) => selectedIds.has(entry.id)),
    [selectableEntries, selectedIds],
  )
  const allSelected = selectableEntries.length > 0 && selectedIds.size === selectableEntries.length

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(selectableEntries.map((entry) => entry.id)) : new Set())
  }

  const handleDelete = async () => {
    if (!deleteEntryTarget) return
    try {
      await deleteEntry({ id: deleteEntryTarget.id })
      toast.success(t("timeTracking.entries.messages.deleteSuccess"))
    } catch (err) {
      console.error(err)
      toast.error(t("timeTracking.entries.messages.deleteError"))
    } finally {
      setDeleteEntryTarget(null)
    }
  }

  const handleGenerated = (result: GenerateInvoiceFromTimeEntriesResult) => {
    setSelectedIds(new Set())
    toast.success(
      t("timeTracking.generateInvoice.messages.viewInvoice", { count: result.billedEntryIds.length }),
    )
    navigate("/documents/invoice")
  }

  return (
    <Card className="gap-0" data-cy="time-entry-panel">
      <CardHeader className="border-b flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle>
          {project.name} — {project.client.name}
        </CardTitle>
        <Button onClick={() => setCreateOpen(true)} dataCy="time-entry-add-button">
          <Plus className="h-4 w-4 mr-0 md:mr-2" />
          <span className="hidden md:inline-flex">{t("timeTracking.entries.list.add")}</span>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Clock}
            size="sm"
            title={t("timeTracking.entries.empty")}
            data-cy="time-entry-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={allSelected}
                      disabled={selectableEntries.length === 0}
                      onChange={(e) => toggleAll(e.target.checked)}
                      data-cy="time-entry-select-all"
                    />
                  </TableHead>
                  <TableHead>{t("timeTracking.entries.columns.date")}</TableHead>
                  <TableHead>{t("timeTracking.entries.columns.description")}</TableHead>
                  <TableHead className="text-right">{t("timeTracking.entries.columns.hours")}</TableHead>
                  <TableHead className="text-right">{t("timeTracking.entries.columns.amount")}</TableHead>
                  <TableHead>{t("timeTracking.entries.columns.status")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const selectable = entry.billable && !entry.invoiceId
                  return (
                    <TableRow key={entry.id} data-cy={`time-entry-row-${entry.id}`}>
                      <TableCell>
                        {selectable && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={selectedIds.has(entry.id)}
                            onChange={(e) => toggleOne(entry.id, e.target.checked)}
                            data-cy={`time-entry-checkbox-${entry.id}`}
                          />
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {new Date(entry.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{entry.description || "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {(entry.durationMinutes / 60).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {amountFor(entry).toFixed(2)}
                        {currencySymbol}
                      </TableCell>
                      <TableCell>
                        {entry.invoiceId ? (
                          <Badge variant="success" data-cy={`time-entry-billed-${entry.id}`}>
                            {t("timeTracking.entries.status.billed")}
                          </Badge>
                        ) : !entry.billable ? (
                          <Badge variant="outline">{t("timeTracking.entries.status.nonBillable")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("timeTracking.entries.status.unbilled")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!entry.invoiceId && (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              tooltip={t("timeTracking.actions.edit")}
                              aria-label={t("timeTracking.actions.edit")}
                              onClick={() => setEditEntry(entry)}
                              dataCy={`time-entry-edit-${entry.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              tooltip={t("timeTracking.actions.delete")}
                              aria-label={t("timeTracking.actions.delete")}
                              onClick={() => setDeleteEntryTarget(entry)}
                              dataCy={`time-entry-delete-${entry.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {selectableEntries.length > 0 && (
        <div className="border-t p-4 flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm text-muted-foreground" data-cy="time-entry-selection-summary">
            {t("timeTracking.entries.selectionSummary", { count: selectedEntries.length })}
          </span>
          {/* `secondary`, not the default filled button — this panel's one primary is "Add" in the
              header (creating a new time entry, the same "New <type>" role document-list.tsx keeps
              as the page's sole default), and this bar can be on screen at the same time as it. */}
          <Button
            variant="secondary"
            onClick={() => setGenerateOpen(true)}
            disabled={selectedEntries.length === 0}
            dataCy="generate-invoice-button"
          >
            <Receipt className="h-4 w-4 mr-2" />
            {t("timeTracking.generateInvoice.trigger")}
          </Button>
        </div>
      )}

      <TimeEntryUpsert
        projectId={project.id}
        projectName={project.name}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <TimeEntryUpsert
        projectId={project.id}
        projectName={project.name}
        entry={editEntry}
        open={!!editEntry}
        onOpenChange={(open) => {
          if (!open) setEditEntry(null)
        }}
      />

      <Dialog open={!!deleteEntryTarget} onOpenChange={(open) => !open && setDeleteEntryTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("timeTracking.entries.delete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("timeTracking.entries.delete.description")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteEntryTarget(null)}>
              {t("timeTracking.actions.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} dataCy="time-entry-delete-confirm">
              {t("timeTracking.actions.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <GenerateInvoiceDialog
        clientId={project.clientId}
        entries={selectedEntries}
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onGenerated={handleGenerated}
      />
    </Card>
  )
}

export default TimeEntryList
