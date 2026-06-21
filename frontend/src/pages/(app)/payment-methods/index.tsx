import { Banknote, Plus } from "lucide-react"
import { PaymentMethodsList, type PaymentMethodsListHandle } from "@/pages/(app)/payment-methods/_components/payment-method-list"
import { useRef, useState } from "react"
import { useSse } from "@/hooks/use-fetch"
import { Button } from "@/components/ui/button"
import { usePageHeader } from "@/hooks/use-page-header"
import { useTranslation } from "react-i18next"


type ActiveFilter = "active" | "inactive" | undefined

export default function PaymentMethodsPage() {
  const { t } = useTranslation()
  const pmListRef = useRef<PaymentMethodsListHandle>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<ActiveFilter>(undefined)
  const { data: paymentMethods = [] } = useSse<any[]>("/api/payment-methods/sse")

  const filtered = (paymentMethods || []).filter((pm) =>
    ((pm.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (pm.details || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (pm.type || "").toLowerCase().includes(searchTerm.toLowerCase())) &&
    (!statusFilter ||
      (statusFilter === "active" && pm.isActive) ||
      (statusFilter === "inactive" && !pm.isActive)),
  )

  const statusCounts = {
    active: paymentMethods?.filter((pm) => pm.isActive).length || 0,
    inactive: paymentMethods?.filter((pm) => !pm.isActive).length || 0,
  }

  usePageHeader(t("sidebar.navigation.paymentMethods"))

  const emptyState = (
    <div className="text-center py-12">
      <Banknote className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-foreground">{searchTerm ? t("paymentMethods.list.empty") || t("paymentMethods.empty") : t("paymentMethods.list.empty") || t("paymentMethods.empty")}</h3>
      <p className="mt-1 text-sm text-primary">{searchTerm ? "" : t("paymentMethods.description")}</p>
      {!searchTerm && (
        <div className="mt-6">
          <Button onClick={() => pmListRef.current?.handleAddClick()}>
            <Plus className="h-4 w-4 mr-2" />
            {t("paymentMethods.list.add") || t("paymentMethods.add.title") || t("actions.add")}
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">

      <PaymentMethodsList
        ref={pmListRef}
        paymentMethods={filtered}
        loading={false}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        statusCounts={statusCounts}
        emptyState={emptyState}
        showCreateButton={true}
      />
    </div>
  )
}