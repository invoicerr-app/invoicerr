import { useTranslation } from "react-i18next"

import { usePaymentMethods } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { Skeleton } from "@/components/ui/skeleton"

import { PaymentMethodCard } from "./_components/payment-method-card"

/**
 * A company's own accepted payment methods — a first-class top-level screen (next to Clients/
 * Articles, see sidebar.tsx's own "Data" group), never a settings tab. Always the FULL registered
 * list (`GET /api/payment-methods`) — a method a company has never touched still gets its own card,
 * `enabled: false`, ready to be turned on. Adding a SIXTH method (backend: payment-methods/built-in.ts)
 * needs no change here at all: this page only ever iterates whatever the endpoint returns.
 */
export default function PaymentMethodsPage() {
  const { t } = useTranslation()
  const { data: methods, isLoading } = usePaymentMethods()

  usePageHeader(t("sidebar.navigation.paymentMethods"))

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <p className="text-sm text-muted-foreground">{t("paymentMethods.description")}</p>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2" data-cy="payment-methods-loading">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" data-cy="payment-methods-list">
          {(methods ?? []).map((method) => (
            <PaymentMethodCard key={method.id} method={method} />
          ))}
        </div>
      )}
    </div>
  )
}
