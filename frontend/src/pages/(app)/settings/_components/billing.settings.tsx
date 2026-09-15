import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useBillingStatus, useOpenCustomerPortal, useStartCheckout } from "@/hooks/queries"
import { useCompanies } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

/**
 * Settings > Subscription — only ever reached when `-[tab].tsx` decided to show the "billing" tab at
 * all, which it does ONLY once `useBillingStatus()` itself has already resolved 200 (see that hook's
 * own header: there is no Vite env mirror of the backend flag, `GET /api/billing/status` answering at
 * all IS the only signal). Still guards its own render on `isSuccess` below regardless — a direct
 * navigation to `/settings/billing` (a stale bookmark, a self-hosted instance where the tab was
 * visible a moment ago but the flag just got unset) must render nothing, not a half-populated screen.
 */
export default function BillingSettings() {
  const { t } = useTranslation()
  const { activeCompanyId } = useCompanies()
  const { data: status, isSuccess } = useBillingStatus()
  const startCheckout = useStartCheckout()
  const openPortal = useOpenCustomerPortal()

  if (!isSuccess || !status) return null

  const returnUrl = `${window.location.origin}/settings/billing`

  const subscribe = (interval: "monthly" | "yearly") => {
    if (!activeCompanyId) return
    startCheckout.mutate(
      {
        slug: interval,
        referenceId: activeCompanyId,
        successUrl: `${returnUrl}?checkout=success`,
        returnUrl,
      },
      {
        onSuccess: (data) => {
          window.location.href = data.url
        },
      },
    )
  }

  const manageSubscription = () => {
    openPortal.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.url
      },
    })
  }

  const statusLabel = t(`settings.billing.status.${status.status}`, status.status)
  const statusVariant =
    status.status === "ACTIVE" ? "default" : status.status === "TRIAL" ? "secondary" : "destructive"

  return (
    <div className="space-y-6" data-cy="billing-settings">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.billing.title", "Subscription")}</h1>
        <p className="text-muted-foreground">
          {t(
            "settings.billing.description",
            "Manage this company's hosted subscription — seats, plan, and payment method.",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("settings.billing.currentPlan", "Current plan")}
            <Badge variant={statusVariant} data-cy="billing-status-badge">
              {statusLabel}
            </Badge>
          </CardTitle>
          <CardDescription>
            {t("settings.billing.seats", "{{count}} seat(s)", { count: status.seats })}
            {status.interval
              ? ` · ${t(`settings.billing.interval.${status.interval}`, status.interval)}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.daysRemaining !== null && (
            <p className="text-sm text-muted-foreground" data-cy="billing-days-remaining">
              {t("settings.billing.daysRemaining", "{{count}} day(s) remaining", {
                count: status.daysRemaining,
              })}
            </p>
          )}

          {status.status !== "ACTIVE" && (
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => subscribe("monthly")}
                disabled={startCheckout.isPending}
                data-cy="billing-subscribe-monthly"
              >
                {t("settings.billing.subscribeMonthly", "Subscribe monthly")}
              </Button>
              <Button
                variant="outline"
                onClick={() => subscribe("yearly")}
                disabled={startCheckout.isPending}
                data-cy="billing-subscribe-yearly"
              >
                {t("settings.billing.subscribeYearly", "Subscribe yearly")}
              </Button>
            </div>
          )}

          <Button
            variant="secondary"
            onClick={manageSubscription}
            disabled={openPortal.isPending}
            data-cy="billing-manage-portal"
          >
            {t("settings.billing.managePortal", "Manage subscription")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
