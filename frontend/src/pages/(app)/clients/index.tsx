import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Edit, Eye, Mail, MapPin, Phone, Plus, Search, Trash2, User, Users } from "lucide-react"

import BetterPagination from "@/components/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Client } from "@/types"
import { ClientDeleteDialog } from "./_components/client-delete"
import { ClientUpsert } from "./_components/client-upsert"
import { ClientViewDialog } from "./_components/client-view"
import { Input } from "@/components/ui/input"
import { useClients } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type ActiveFilter = "active" | "inactive" | undefined

export default function Clients() {
    const { t } = useTranslation()
    const [page, setPage] = useState(1)
    const { data: clients } = useClients(page)

    const [createClientDialog, setCreateClientDialog] = useState<boolean>(false)
    const [editClientDialog, setEditClientDialog] = useState<Client | null>(null)
    const [viewClientDialog, setViewClientDialog] = useState<Client | null>(null)
    const [deleteClientDialog, setDeleteClientDialog] = useState<Client | null>(null)

    const [searchTerm, setSearchTerm] = useState("")
    const [activeFilter, setActiveFilter] = useState<ActiveFilter>(undefined)

    const filteredClients =
        clients?.clients.filter(
            (client) =>
                (client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    client.contactFirstname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    client.contactLastname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    client.contactEmail.toLowerCase().includes(searchTerm.toLowerCase())) &&
                (!activeFilter ||
                    (activeFilter === "active" && client.isActive) ||
                    (activeFilter === "inactive" && !client.isActive)),
        ) || []

    const activeCounts = {
        active: clients?.clients.filter((c) => c.isActive).length || 0,
        inactive: clients?.clients.filter((c) => !c.isActive).length || 0,
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

    usePageHeader(t("sidebar.navigation.clients"))

    const emptyState = (
        <div className="text-center py-12">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
                {searchTerm ? t("clients.emptyState.noResults") : t("clients.emptyState.noClients")}
            </h3>
            <p className="mt-1 text-sm text-primary">
                {searchTerm ? t("clients.emptyState.tryDifferentSearch") : t("clients.emptyState.startAdding")}
            </p>
            {!searchTerm && (
                <div className="mt-6">
                    <Button onClick={handleAddClick}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t("clients.actions.addNew")}
                    </Button>
                </div>
            )}
        </div>
    )

    return (
        <div className="max-w-7xl mx-auto space-y-6 p-6">

            <Card className="gap-0">
                <CardHeader className="border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
                    <div className="relative w-full sm:w-fit sm:flex-1 sm:max-w-sm">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
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
                                className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${activeFilter === "active"
                                    ? "bg-green-600 text-white font-semibold shadow-sm scale-105"
                                    : "bg-green-50 text-green-700/70 hover:bg-green-100"
                                    }`}
                            >
                                {t("clients.stats.active")} ({activeCounts.active})
                            </Badge>
                            <Badge
                                onClick={() => setActiveFilter(activeFilter === "inactive" ? undefined : "inactive")}
                                variant="outline"
                                className={`cursor-pointer text-sm px-3 py-1 rounded-full transition-all border-transparent ${activeFilter === "inactive"
                                    ? "bg-gray-500 text-white font-semibold shadow-sm scale-105"
                                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                    }`}
                            >
                                {t("clients.stats.inactive")} ({activeCounts.inactive})
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
                                            <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                                                <User className="h-5 w-5 text-blue-600" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="font-medium text-foreground break-words">{client.name || client.contactFirstname + " " + client.contactLastname}</h3>
                                                    <span
                                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${client.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                                                            } w-fit`}
                                                        data-cy={client.isActive ? `client-status-active-${client.contactEmail}` : `client-status-inactive-${client.contactEmail}`}
                                                    >
                                                        {client.isActive ? t("clients.list.status.active") : t("clients.list.status.inactive")}
                                                    </span>
                                                    <span
                                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${client.type === 'INDIVIDUAL' ? "bg-blue-100 text-blue-800" : "bg-yellow-100 text-yellow-800"
                                                            } w-fit ml-2`}
                                                    >
                                                        {client.type === 'INDIVIDUAL' ? t("clients.upsert.fields.type.individual") : t("clients.upsert.fields.type.company")}
                                                    </span>
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
                                                className="text-gray-600 hover:text-blue-600 mr-2"
                                                dataCy={`view-client-button-${client.contactEmail}`}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                tooltip={t("clients.list.tooltips.edit")}
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleEdit(client)}
                                                className="text-gray-600 hover:text-green-600 mr-2"
                                                dataCy={`edit-client-button-${client.contactEmail}`}
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                tooltip={t("clients.list.tooltips.delete")}
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(client)}
                                                className="text-gray-600 hover:text-red-600 mr-2"
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
        </div>
    )
}
