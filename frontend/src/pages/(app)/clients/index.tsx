import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import {
  Edit,
  Eye,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  SearchX,
  Search,
  Trash2,
  User,
  UserRoundCheck,
  Users,
} from "lucide-react"

import BetterPagination from "@/components/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { Client } from "@/types"
import { ClientDeleteDialog } from "./_components/client-delete"
import { ClientPortalAccessDialog } from "./_components/client-portal-access"
import { ClientStatementDialog } from "./_components/client-statement"
import { ClientUpsert } from "./_components/client-upsert"
import { ClientViewDialog } from "./_components/client-view"
import { Input } from "@/components/ui/input"
import { useClients } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type ActiveFilter = "active" | "inactive" | undefined
// "the clients screen can filter by role": the ONE role this filter
// recognizes today is "supplier" (Client.isSupplier) — a toggle, not a full role enum, since that is
// the only role that exists today; a future role would extend this the same way.
type RoleFilter = "supplier" | undefined

export default function Clients() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const { data: clients } = useClients(page)

  const [createClientDialog, setCreateClientDialog] = useState<boolean>(false)
  const [editClientDialog, setEditClientDialog] = useState<Client | null>(null)
  const [viewClientDialog, setViewClientDialog] = useState<Client | null>(null)
  const [deleteClientDialog, setDeleteClientDialog] = useState<Client | null>(null)
  const [statementClientDialog, setStatementClientDialog] = useState<Client | null>(null)
  const [portalAccessClientDialog, setPortalAccessClientDialog] = useState<Client | null>(null)

  const [searchTerm, setSearchTerm] = useState("")
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(undefined)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(undefined)

  const filteredClients =
    clients?.clients.filter(
      (client) =>
        (client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          client.contactFirstname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          client.contactLastname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          client.contactEmail.toLowerCase().includes(searchTerm.toLowerCase())) &&
        (!activeFilter ||
          (activeFilter === "active" && client.isActive) ||
          (activeFilter === "inactive" && !client.isActive)) &&
        (!roleFilter || (roleFilter === "supplier" && client.isSupplier)),
    ) || []

  const activeCounts = {
    active: clients?.clients.filter((c) => c.isActive).length || 0,
    inactive: clients?.clients.filter((c) => !c.isActive).length || 0,
    suppliers: clients?.clients.filter((c) => c.isSupplier).length || 0,
  }

  function handleAddClick() {
    setCreateClientDialog(true)
  }

  function handleEdit(client: Client) {
    setEditClientDialog(client)
  }

  function handleView(client: Client) {
    setViewClientDialog(client)
  }

  function handleDelete(client: Client) {
    setDeleteClientDialog(client)
  }

  function handleStatement(client: Client) {
    setStatementClientDialog(client)
  }

  function handlePortalAccess(client: Client) {
    setPortalAccessClientDialog(client)
  }

  usePageHeader(t("sidebar.navigation.clients"))

  // `secondary` on the empty-state CTA: the header's "Add client" stays the page's one filled button.
  const emptyState = searchTerm ? (
    <EmptyState
      icon={SearchX}
      title={t("clients.emptyState.noResults")}
      description={t("clients.emptyState.tryDifferentSearch")}
      action={
        <Button variant="outline" onClick={() => setSearchTerm("")}>
          {t("common.emptyState.clearSearch")}
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
        <Button variant="secondary" onClick={handleAddClick}>
          <Plus aria-hidden="true" />
          {t("clients.actions.addNew")}
        </Button>
      }
      data-cy="clients-empty"
    />
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <Card className="gap-0">
        <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
          <div className="relative w-full sm:w-fit sm:flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("clients.search.placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-full"
            />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <div className="flex items-center gap-2">
              <Badge
                onClick={() => setActiveFilter(activeFilter === "active" ? undefined : "active")}
                variant="outline"
                className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${
                  activeFilter === "active"
                    ? "bg-success text-success-foreground font-semibold shadow-sm scale-105"
                    : "bg-success/40 text-success-foreground hover:bg-success/70"
                }`}
              >
                {t("clients.stats.active")} ({activeCounts.active})
              </Badge>
              <Badge
                onClick={() => setActiveFilter(activeFilter === "inactive" ? undefined : "inactive")}
                variant="outline"
                className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${
                  activeFilter === "inactive"
                    ? "bg-muted-foreground text-background font-semibold shadow-sm scale-105"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {t("clients.stats.inactive")} ({activeCounts.inactive})
              </Badge>
              {/* Filter by role: the only role that exists today. */}
              <Badge
                onClick={() => setRoleFilter(roleFilter === "supplier" ? undefined : "supplier")}
                variant="outline"
                className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${
                  roleFilter === "supplier"
                    ? "bg-accent-foreground text-accent font-semibold shadow-sm scale-105"
                    : "bg-accent text-accent-foreground hover:bg-accent/70"
                }`}
                data-cy="clients-filter-supplier"
              >
                {t("clients.stats.suppliers")} ({activeCounts.suppliers})
              </Badge>
            </div>
            <Button onClick={handleAddClick}>
              <Plus className="h-4 w-4 mr-0 md:mr-2" />
              <span className="hidden md:inline-flex">{t("clients.actions.addNew")}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredClients.length === 0 ? (
            emptyState
          ) : (
            <div className="divide-y">
              {filteredClients.map((client, index) => (
                <div key={index} className="p-4 sm:p-6">
                  <div className="flex flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex flex-row items-center gap-4 w-full">
                      <div className="p-2 bg-primary/10 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-foreground break-words">
                            {client.name || `${client.contactFirstname} ${client.contactLastname}`}
                          </h3>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              client.isActive
                                ? "bg-success text-success-foreground"
                                : "bg-secondary text-secondary-foreground"
                            } w-fit`}
                            data-cy={
                              client.isActive
                                ? `client-status-active-${client.contactEmail}`
                                : `client-status-inactive-${client.contactEmail}`
                            }
                          >
                            {client.isActive
                              ? t("clients.list.status.active")
                              : t("clients.list.status.inactive")}
                          </span>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              client.type === "INDIVIDUAL"
                                ? "bg-secondary text-secondary-foreground"
                                : "bg-muted text-muted-foreground"
                            } w-fit ml-2`}
                          >
                            {client.type === "INDIVIDUAL"
                              ? t("clients.upsert.fields.type.individual")
                              : t("clients.upsert.fields.type.company")}
                          </span>
                          {/* The "supplier" role, visible without opening the record. */}
                          {client.isSupplier && (
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent text-accent-foreground w-fit ml-2"
                              data-cy={`client-role-supplier-${client.contactEmail}`}
                            >
                              {t("clients.list.role.supplier")}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-col lg:flex-row flex-wrap gap-2 text-sm text-primary">
                          <div className="flex items-center space-x-1">
                            <Mail className="h-4 w-4" />
                            <span>{client.contactEmail || "-"}</span>
                          </div>
                          {client.contactPhone && (
                            <div className="flex items-center space-x-1">
                              <Phone className="h-4 w-4" />
                              <span>{client.contactPhone || "-"}</span>
                            </div>
                          )}
                          {client.city && (
                            <div className="flex items-center space-x-1">
                              <MapPin className="h-4 w-4" />
                              <span>{client.city}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-0 w-fit flex flex-col lg:flex-row space-x-2 justify-center items-center lg:justify-end">
                      <Button
                        tooltip={t("clients.list.tooltips.view")}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleView(client)}
                        className="text-muted-foreground hover:text-primary mr-2"
                        dataCy={`view-client-button-${client.contactEmail}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        tooltip={t("clients.list.tooltips.edit")}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(client)}
                        className="text-muted-foreground hover:text-primary mr-2"
                        dataCy={`edit-client-button-${client.contactEmail}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        tooltip={t("clients.list.tooltips.statement")}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStatement(client)}
                        className="text-muted-foreground hover:text-primary mr-2"
                        dataCy={`statement-client-button-${client.contactEmail}`}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        tooltip={t("clients.list.tooltips.portalAccess")}
                        variant="ghost"
                        size="icon"
                        onClick={() => handlePortalAccess(client)}
                        className="text-muted-foreground hover:text-primary mr-2"
                        dataCy={`portal-access-client-button-${client.contactEmail}`}
                      >
                        <UserRoundCheck className="h-4 w-4" />
                      </Button>
                      <Button
                        tooltip={t("clients.list.tooltips.delete")}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(client)}
                        className="text-muted-foreground hover:text-destructive mr-2"
                        dataCy={`delete-client-button-${client.contactEmail}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter>
          {filteredClients.length > 0 && (
            <BetterPagination pageCount={clients?.pageCount || 1} page={page} setPage={setPage} />
          )}
        </CardFooter>
      </Card>

      <ClientUpsert
        open={createClientDialog}
        onOpenChange={(open) => {
          setCreateClientDialog(open)
        }}
      />

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
