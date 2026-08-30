import { FileStack, Pencil, Plus, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

// Side-effect only: makes whatever is registered in custom-slots.ts available. This is the exact
// same pattern field-renderers/index.ts uses for field KINDS — the module that actually CONSULTS a
// registry is what pulls its registrations in, so the generic page importing DocumentList never has
// to know that any type-specific extension exists at all. See custom-registrations.ts's own header
// for why it, not this file, is the one place allowed to name a document type.
import "@/components/documents/custom-registrations"

import { ActionParamsDialog } from "@/components/documents/action-params-dialog"
import { getDocumentCustomComponent } from "@/components/documents/custom-slots"
import { DocumentFieldValue } from "@/components/documents/field-value"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { isActionAvailable } from "@/components/documents/types"
import { useDocumentActionRunner } from "@/components/documents/use-document-action-runner"
import BetterPagination from "@/components/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

/**
 * Field kinds shown as their own column in the list table. A field whose kind describes a
 * REPEATING structure ('array', 'rowSelection') cannot fit a single flat cell — that boundary is
 * drawn on the field's KIND, exactly like every other decision in this core, never on which
 * document TYPE declared the field. See field-value.tsx's own 'array'/'rowSelection' cases for the
 * richer rendering they get where there IS room for them (the honest invoice preview).
 */
const TABULAR_KINDS = new Set(["text", "number", "money", "date", "boolean", "select", "reference"])

interface DocumentRowActionsProps {
  descriptor: DocumentTypeDescriptor
  instance: DocumentInstance
  onEdit: (instance: DocumentInstance) => void
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * One row's action cell: an explicit "edit" (opens the create/edit modal, the only way to change
 * FIELD values), every action the descriptor declares for this record's current status — run
 * directly against the SAVED instance, no modal involved — and, last, whatever a custom slot adds
 * for this type alone (see custom-slots.ts). None of this branches on which document type it is.
 */
function DocumentRowActions({ descriptor, instance, onEdit, onActionSuccess }: DocumentRowActionsProps) {
  const { t } = useTranslation()
  const { pendingAction, pendingDefaults, isRunning, handleAction, executeAction, cancelPendingAction } =
    useDocumentActionRunner({
      typeId: descriptor.id,
      documentId: instance.id,
      getData: () => instance.data,
      onActionSuccess,
    })

  const availableActions = descriptor.actions.filter((action) => isActionAvailable(action, instance.status))
  const CustomExtra = getDocumentCustomComponent(descriptor.id, "list-row-extra")
  // A disabled <button> (Button's own `disabled:pointer-events-none`, see ui/button.tsx) never
  // receives a REAL hover at all — the `tooltip` prop below still opens it for a keyboard/
  // screen-reader user, but a mouse user hovering a grayed-out button here would see nothing move.
  // document-form.tsx already learned this: it pairs the same tooltip with an always-visible
  // caption rather than trusting hover alone. One line is enough here (the reason is the country's
  // policy, the same for every blocked action on this record), shown once below the buttons rather
  // than once per button.
  const blockedReason = availableActions.find((action) => action.policyBlockedReason)?.policyBlockedReason

  return (
    // Stops a click on any action here from also bubbling up to the row's own onClick (which opens
    // the edit modal) — an action button and "open this record" are two different intents.
    <div
      className="flex flex-col items-end gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tooltip={t("documents.list.tooltips.edit")}
          onClick={() => onEdit(instance)}
          dataCy={`document-edit-button-${instance.id}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>

        {CustomExtra && <CustomExtra descriptor={descriptor} instance={instance} />}

        {availableActions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            size="sm"
            disabled={!!action.policyBlockedReason}
            tooltip={
              action.policyBlockedReason
                ? t("documents.form.actionBlockedByPolicy", { reason: action.policyBlockedReason })
                : undefined
            }
            loading={isRunning && pendingAction === undefined}
            onClick={() => handleAction(action)}
            dataCy={`document-row-action-${action.id}-${instance.id}`}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {blockedReason && (
        <p
          className="line-clamp-2 max-w-[220px] whitespace-normal text-right text-xs text-muted-foreground"
          // The full text is a click away from being cut off — `title` is a native browser tooltip,
          // unaffected by the disabled buttons' own `pointer-events-none` (see the comment above)
          // since it lives on this plain, never-disabled paragraph instead.
          title={t("documents.form.actionBlockedByPolicy", { reason: blockedReason })}
          data-cy={`document-row-blocked-reason-${instance.id}`}
        >
          {t("documents.form.actionBlockedByPolicy", { reason: blockedReason })}
        </p>
      )}

      {pendingAction && (
        <ActionParamsDialog
          action={pendingAction}
          defaultValues={pendingDefaults}
          submitting={isRunning}
          onCancel={cancelPendingAction}
          onConfirm={(params) => executeAction(pendingAction.id, params)}
        />
      )}
    </div>
  )
}

interface DocumentListProps {
  descriptor: DocumentTypeDescriptor
  instances: DocumentInstance[]
  isLoading: boolean
  onCreate: () => void
  onEdit: (instance: DocumentInstance) => void
  onActionSuccess: (result: DocumentInstance, actionId: string) => void
}

/**
 * The one generic list: a table whose COLUMNS are deduced from the descriptor's own fields (see
 * TABULAR_KINDS above), a status column driven by DocumentStatusBadge's generic tone heuristic, and
 * an actions column driven entirely by DocumentRowActions above. A new document type needs no list
 * screen of its own — this is it, for every type there is.
 */
export function DocumentList({
  descriptor,
  instances,
  isLoading,
  onCreate,
  onEdit,
  onActionSuccess,
}: DocumentListProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)

  const tabularFields = useMemo(
    () => descriptor.fields.filter((field) => TABULAR_KINDS.has(field.kind)),
    [descriptor.fields],
  )

  // Status categories are DERIVED from the loaded data, never a fixed enum — the same discipline
  // DocumentStatusBadge holds for color: a status this core has never seen still gets a filter chip.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const instance of instances) counts.set(instance.status, (counts.get(instance.status) ?? 0) + 1)
    return counts
  }, [instances])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return instances.filter((instance) => {
      if (statusFilter && instance.status !== statusFilter) return false
      if (!term) return true
      // A generic full-text filter: match against the document's own data verbatim rather than
      // guessing which fields are "searchable" per type.
      return JSON.stringify(instance.data).toLowerCase().includes(term)
    })
  }, [instances, search, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const setSearchAndResetPage = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const toggleStatusFilter = (status: string) => {
    setStatusFilter((current) => (current === status ? undefined : status))
    setPage(1)
  }

  return (
    <Card className="gap-0" data-cy="document-list-card">
      <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
        <div className="relative w-full sm:w-fit sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("documents.list.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearchAndResetPage(event.target.value)}
            className="pl-9 w-full"
            data-cy="document-list-search"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {[...statusCounts.entries()].map(([status, count]) => (
            <Badge
              key={status}
              variant="outline"
              onClick={() => toggleStatusFilter(status)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-sm border-transparent transition-all",
                statusFilter === status
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
              data-cy={`document-status-filter-${status}`}
            >
              {status} ({count})
            </Badge>
          ))}

          <Button onClick={onCreate} dataCy="document-create-button">
            <Plus className="h-4 w-4 mr-0 md:mr-2" />
            <span className="hidden md:inline-flex">
              {t("documents.list.actions.create", { label: descriptor.label })}
            </span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12" data-cy="document-list-empty">
            <FileStack className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
              {search || statusFilter ? t("documents.list.emptyState.noResults") : t("documents.list.empty")}
            </h3>
            {!search && !statusFilter && (
              <div className="mt-6">
                <Button onClick={onCreate} dataCy="document-create-button-empty">
                  <Plus className="h-4 w-4 mr-2" />
                  {t("documents.list.actions.create", { label: descriptor.label })}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Table data-cy="document-list-table">
            <TableHeader>
              <TableRow>
                {tabularFields.map((field) => (
                  <TableHead key={field.key}>{field.label}</TableHead>
                ))}
                <TableHead>{t("documents.list.columns.status")}</TableHead>
                <TableHead>{t("documents.list.columns.updatedAt")}</TableHead>
                <TableHead className="text-right">{t("documents.list.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((instance) => (
                <TableRow
                  key={instance.id}
                  className="cursor-pointer"
                  onClick={() => onEdit(instance)}
                  data-cy={`document-list-row-${instance.id}`}
                >
                  {tabularFields.map((field) => (
                    <TableCell key={field.key}>
                      <DocumentFieldValue
                        field={field}
                        value={instance.data[field.key]}
                        data={instance.data}
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <DocumentStatusBadge status={instance.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(instance.updatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <DocumentRowActions
                      descriptor={descriptor}
                      instance={instance}
                      onEdit={onEdit}
                      onActionSuccess={onActionSuccess}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {!isLoading && filtered.length > 0 && pageCount > 1 && (
        <div className="border-t p-4">
          <BetterPagination pageCount={pageCount} page={currentPage} setPage={setPage} />
        </div>
      )}
    </Card>
  )
}
