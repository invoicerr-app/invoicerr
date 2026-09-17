import { FileText, Pencil, Plus, SearchX, Trash2, UserRoundCheck, Users } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"

import BetterPagination from "@/components/pagination"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { useClient, useClients } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import type { Client } from "@/types"

import {
  FilterChip,
  FilterChipGroup,
  FilterChipSkeleton,
  ListRow,
  ListRowMenu,
  ListSearch,
  ListSkeleton,
} from "../_shared/data-list"
import { ClientBadges } from "./_components/client-badges"
import { ClientDeleteDialog } from "./_components/client-delete"
import { clientDisplayName } from "./_components/client-display"
import { ClientPortalAccessDialog } from "./_components/client-portal-access"
import { ClientStatementDialog } from "./_components/client-statement"
import { ClientUpsert } from "./_components/client-upsert"
import { ClientViewDialog } from "./_components/client-view"

type ActiveFilter = "active" | "inactive" | undefined
// The ONE role this filter recognizes today is "supplier" (Client.isSupplier) — a toggle, not a
// full role enum, since that is the only role that exists; a future role extends this the same way.
type RoleFilter = "supplier" | undefined

interface ClientRowProps {
  client: Client
  onView: (client: Client) => void
  onEdit: (client: Client) => void
  onStatement: (client: Client) => void
  onPortalAccess: (client: Client) => void
  onDelete: (client: Client) => void
}

/**
 * One client as a row: name + badges, then e-mail · phone · city. "Edit" is the one contextual
 * button (the most frequent action on a client record); everything else — statement, portal
 * access, delete — sits in the "more" menu, delete last and in the destructive tone. The old row
 * showed five icon buttons at equal weight, delete included, with hover colours invented per icon.
 */
function ClientRow({ client, onView, onEdit, onStatement, onPortalAccess, onDelete }: ClientRowProps) {
  const { t } = useTranslation()
  const email = client.contactEmail
  // `data-cy` selectors below key off the email for readability in specs — but the email is optional
  // now, so a client without one falls back to its own id rather than every email-less row rendering
  // the literal string "undefined" (and colliding with every OTHER email-less row on the same page).
  const rowKey = email?.trim() || client.id
  const meta = [
    client.contactEmail,
    client.contactPhone,
    [client.city, client.countryCode].filter(Boolean).join(", "),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)

  return (
    <ListRow
      dataCy={`client-row-${rowKey}`}
      onOpen={() => onView(client)}
      identity={
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 break-words font-medium text-foreground">
              {/* A real button, the one control a keyboard or screen-reader user can reach to open
                  the record (the row's own onClick is invisible to both). */}
              <button
                type="button"
                className="rounded-sm text-left outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={(event) => {
                  event.stopPropagation()
                  onView(client)
                }}
                data-cy={`view-client-button-${rowKey}`}
              >
                {clientDisplayName(client)}
              </button>
            </h3>
            <ClientBadges client={client} />
          </div>
          {meta.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:text-sm">
              {meta.map((value) => (
                <span key={value} className="truncate">
                  {value}
                </span>
              ))}
            </div>
          )}
        </>
      }
      primary={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => onEdit(client)}
          dataCy={`edit-client-button-${rowKey}`}
        >
          <Pencil aria-hidden="true" />
          {t("clients.list.tooltips.edit")}
        </Button>
      }
      menu={
        <ListRowMenu
          label={t("clients.list.rowMenu")}
          dataCy={`client-row-menu-${rowKey}`}
          contentDataCy={`client-row-menu-content-${rowKey}`}
        >
          <DropdownMenuItem
            onSelect={() => onStatement(client)}
            data-cy={`statement-client-button-${rowKey}`}
          >
            <FileText aria-hidden="true" />
            {t("clients.list.tooltips.statement")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onPortalAccess(client)}
            data-cy={`portal-access-client-button-${rowKey}`}
          >
            <UserRoundCheck aria-hidden="true" />
            {t("clients.list.tooltips.portalAccess")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete(client)}
            data-cy={`delete-client-button-${rowKey}`}
          >
            <Trash2 aria-hidden="true" />
            {t("clients.list.tooltips.delete")}
          </DropdownMenuItem>
        </ListRowMenu>
      }
    />
  )
}

export default function Clients() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const { data: clients, isLoading } = useClients(page)
  const [searchParams, setSearchParams] = useSearchParams()

  const [createClientDialog, setCreateClientDialog] = useState<boolean>(false)
  const [editClientDialog, setEditClientDialog] = useState<Client | null>(null)
  const [viewClientDialog, setViewClientDialog] = useState<Client | null>(null)
  const [deleteClientDialog, setDeleteClientDialog] = useState<Client | null>(null)
  const [statementClientDialog, setStatementClientDialog] = useState<Client | null>(null)
  const [portalAccessClientDialog, setPortalAccessClientDialog] = useState<Client | null>(null)

  // "?view=<id>" — the duplicate-detection wizard's own "view existing client" link
  // (client-upsert.tsx's DuplicateWarning), opened in a fresh tab that has no local state to hand the
  // dialog directly. Fetched by id (never assumed to be on THIS page's own paginated slice — the
  // match could be on any page), and the param is cleared once consumed so closing/reopening the
  // dialog later never re-triggers this.
  const viewParamId = searchParams.get("view") || undefined
  const { data: viewParamClient } = useClient(viewParamId)
  useEffect(() => {
    if (!viewParamId || !viewParamClient) return
    setViewClientDialog(viewParamClient)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("view")
        return next
      },
      { replace: true },
    )
  }, [viewParamId, viewParamClient, setSearchParams])

  const [searchTerm, setSearchTerm] = useState("")
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(undefined)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(undefined)

  const allClients = useMemo(() => clients?.clients ?? [], [clients])

  const filteredClients = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return allClients.filter(
      (client) =>
        (!term ||
          client.name.toLowerCase().includes(term) ||
          client.contactFirstname?.toLowerCase().includes(term) ||
          client.contactLastname?.toLowerCase().includes(term) ||
          client.contactEmail?.toLowerCase().includes(term)) &&
        (!activeFilter ||
          (activeFilter === "active" && client.isActive) ||
          (activeFilter === "inactive" && !client.isActive)) &&
        (!roleFilter || (roleFilter === "supplier" && client.isSupplier)),
    )
  }, [allClients, searchTerm, activeFilter, roleFilter])

  const counts = {
    active: allClients.filter((c) => c.isActive).length,
    inactive: allClients.filter((c) => !c.isActive).length,
    suppliers: allClients.filter((c) => c.isSupplier).length,
  }
  const hasActiveFilter = !!searchTerm || !!activeFilter || !!roleFilter

  const clearFilters = () => {
    setSearchTerm("")
    setActiveFilter(undefined)
    setRoleFilter(undefined)
  }

  usePageHeader(t("sidebar.navigation.clients"))

  // The view dialog's own "Edit" hands off to the edit dialog — the view closes first so the two
  // never stack.
  const editFromView = (client: Client) => {
    setViewClientDialog(null)
    setEditClientDialog(client)
  }
  const statementFromView = (client: Client) => {
    setViewClientDialog(null)
    setStatementClientDialog(client)
  }

  let body: ReactNode
  if (isLoading) {
    body = <ListSkeleton dataCy="clients-skeleton" />
  } else if (filteredClients.length === 0) {
    // `secondary` on the empty-state CTA: the header's "Add client" stays the page's one filled button.
    body = hasActiveFilter ? (
      <EmptyState
        icon={SearchX}
        title={t("clients.emptyState.noResults")}
        description={t("clients.emptyState.tryDifferentSearch")}
        action={
          <Button variant="outline" onClick={clearFilters}>
            {t("common.emptyState.clearFilters")}
          </Button>
        }
        data-cy="clients-empty"
      />
    ) : (
      <EmptyState
        icon={Users}
        title={t("clients.emptyState.noClients")}
        description={t("clients.emptyState.startAdding")}
        action={
          <Button variant="secondary" onClick={() => setCreateClientDialog(true)}>
            <Plus aria-hidden="true" />
            {t("clients.actions.addNew")}
          </Button>
        }
        data-cy="clients-empty"
      />
    )
  } else {
    body = (
      <div className="divide-y" data-cy="clients-list">
        {filteredClients.map((client) => (
          <ClientRow
            key={client.id}
            client={client}
            onView={setViewClientDialog}
            onEdit={setEditClientDialog}
            onStatement={setStatementClientDialog}
            onPortalAccess={setPortalAccessClientDialog}
            onDelete={setDeleteClientDialog}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <Card className="gap-0">
        <CardHeader className="gap-3 border-b">
          <div className="flex items-center gap-2">
            <ListSearch
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={t("clients.search.placeholder")}
              dataCy="clients-search"
              className="flex-1 sm:max-w-xs"
            />
            <Button
              onClick={() => setCreateClientDialog(true)}
              aria-label={t("clients.actions.addNew")}
              className="ml-auto"
              dataCy="client-add-button"
            >
              <Plus aria-hidden="true" />
              <span className="hidden md:inline">{t("clients.actions.addNew")}</span>
            </Button>
          </div>

          {isLoading && <FilterChipSkeleton />}

          {allClients.length > 0 && (
            <FilterChipGroup label={t("clients.list.filters.ariaLabel")} dataCy="clients-filters">
              <FilterChip
                label={t("clients.list.filters.all")}
                count={allClients.length}
                active={!activeFilter && !roleFilter}
                onClick={() => {
                  setActiveFilter(undefined)
                  setRoleFilter(undefined)
                }}
                dataCy="clients-filter-all"
              />
              {/* Active/Inactive are a STATE (dot), Suppliers a category (no dot) — see FilterChip. */}
              <FilterChip
                label={t("clients.stats.active")}
                count={counts.active}
                tone="success"
                active={activeFilter === "active"}
                onClick={() => setActiveFilter(activeFilter === "active" ? undefined : "active")}
                dataCy="clients-filter-active"
              />
              <FilterChip
                label={t("clients.stats.inactive")}
                count={counts.inactive}
                tone="muted"
                active={activeFilter === "inactive"}
                onClick={() => setActiveFilter(activeFilter === "inactive" ? undefined : "inactive")}
                dataCy="clients-filter-inactive"
              />
              <FilterChip
                label={t("clients.stats.suppliers")}
                count={counts.suppliers}
                active={roleFilter === "supplier"}
                onClick={() => setRoleFilter(roleFilter === "supplier" ? undefined : "supplier")}
                dataCy="clients-filter-supplier"
              />
            </FilterChipGroup>
          )}
        </CardHeader>

        <CardContent className="p-0">{body}</CardContent>

        {!isLoading && filteredClients.length > 0 && (clients?.pageCount ?? 1) > 1 && (
          <div className="border-t p-4">
            <BetterPagination pageCount={clients?.pageCount || 1} page={page} setPage={setPage} />
          </div>
        )}
      </Card>

      <ClientUpsert open={createClientDialog} onOpenChange={setCreateClientDialog} />

      <ClientUpsert
        open={!!editClientDialog}
        client={editClientDialog}
        onOpenChange={(open) => {
          if (!open) setEditClientDialog(null)
        }}
      />

      <ClientViewDialog
        client={viewClientDialog}
        onOpenChange={(open) => {
          if (!open) setViewClientDialog(null)
        }}
        onEdit={editFromView}
        onStatement={statementFromView}
      />

      <ClientDeleteDialog
        client={deleteClientDialog}
        onOpenChange={(open) => {
          if (!open) setDeleteClientDialog(null)
        }}
      />

      <ClientStatementDialog
        client={statementClientDialog}
        onOpenChange={(open) => {
          if (!open) setStatementClientDialog(null)
        }}
      />

      <ClientPortalAccessDialog
        client={portalAccessClientDialog}
        onOpenChange={(open) => {
          if (!open) setPortalAccessClientDialog(null)
        }}
      />
    </div>
  )
}
