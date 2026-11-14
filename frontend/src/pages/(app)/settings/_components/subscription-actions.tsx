import { useQueryClient } from "@tanstack/react-query"
import { CreditCard, ExternalLink, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type CompanySubscriptionStatus, useSeats } from "@/hooks/queries"
import {
  useCancelSubscription,
  useCompanyStripeSubscription,
  useOpenBillingPortal,
  useStartCheckout,
} from "@/hooks/queries/use-company-subscription"
import { SettingsSection } from "./settings-section"

/** Statuses in which the company already pays through Stripe, so the portal is the way in. */
const PAYING_STATUSES = new Set<CompanySubscriptionStatus>(["ACTIVE", "PAST_DUE"])

interface SubscriptionActionsProps {
  companyId: string
  status: CompanySubscriptionStatus
}

/**
 * Settings > Subscription, the OWNER/ADMIN part: subscribe through Stripe Checkout when the company
 * has no subscription yet, otherwise open the Stripe Customer Portal (payment method, invoices,
 * seat quantity) or its cancellation page. Members never see it (`billing.settings.tsx`), and the
 * backend refuses them anyway (`authorizeReference`).
 */
export function SubscriptionActions({ companyId, status }: SubscriptionActionsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: subscription, isPending } = useCompanyStripeSubscription(companyId, true)
  const { data: seatsView } = useSeats(true)
  const checkout = useStartCheckout()
  const portal = useOpenBillingPortal()
  const cancel = useCancelSubscription()

  const memberCount = seatsView ? seatsView.members.length + seatsView.waiting.length : 1
  const [annual, setAnnual] = useState(false)
  const [seats, setSeats] = useState<number | null>(null)
  const seatQuantity = seats ?? Math.max(1, memberCount)

  // Back from Stripe: say what happened once, refresh what the backend now knows, drop the flag.
  useEffect(() => {
    const outcome = searchParams.get("checkout") ?? searchParams.get("cancel")
    if (!outcome) return
    if (searchParams.get("checkout") === "success") {
      toast.success(t("settings.billing.actions.checkoutSuccess"))
    }
    queryClient.invalidateQueries({ queryKey: ["billing"] })
    const next = new URLSearchParams(searchParams)
    next.delete("checkout")
    next.delete("cancel")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, queryClient, t])

  const onError = (error: Error) => toast.error(error.message || t("settings.billing.actions.error"))

  if (isPending) return null

  const hasSubscription = !!subscription || PAYING_STATUSES.has(status)
  const busy = checkout.isPending || portal.isPending || cancel.isPending

  if (!hasSubscription) {
    return (
      <SettingsSection
        dataCy="billing-subscribe"
        title={t("settings.billing.actions.subscribeTitle")}
        description={t("settings.billing.actions.subscribeDescription", { count: memberCount })}
      >
        <form
          className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            checkout.mutate({ companyId, annual, seats: seatQuantity }, { onError })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="billing-interval">{t("settings.billing.actions.interval")}</Label>
            <Select value={annual ? "YEAR" : "MONTH"} onValueChange={(value) => setAnnual(value === "YEAR")}>
              <SelectTrigger id="billing-interval" data-cy="billing-interval-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTH">{t("settings.billing.interval.MONTH")}</SelectItem>
                <SelectItem value="YEAR">{t("settings.billing.interval.YEAR")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="billing-seats">{t("settings.billing.actions.seatQuantity")}</Label>
            <Input
              id="billing-seats"
              data-cy="billing-seats-input"
              type="number"
              min={1}
              step={1}
              value={seatQuantity}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10)
                setSeats(Number.isFinite(value) && value > 0 ? value : 1)
              }}
            />
          </div>
          <Button type="submit" disabled={busy} data-cy="billing-subscribe-btn">
            <CreditCard />
            {t("settings.billing.actions.subscribe")}
          </Button>
        </form>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection
      dataCy="billing-manage"
      title={t("settings.billing.actions.manageTitle")}
      description={t("settings.billing.actions.manageDescription")}
    >
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy}
          data-cy="billing-portal-btn"
          onClick={() => portal.mutate({ companyId }, { onError })}
        >
          <ExternalLink />
          {t("settings.billing.actions.openPortal")}
        </Button>
        {subscription && !subscription.cancelAtPeriodEnd && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            data-cy="billing-cancel-btn"
            onClick={() => cancel.mutate({ companyId }, { onError })}
          >
            <XCircle />
            {t("settings.billing.actions.cancel")}
          </Button>
        )}
      </div>
      {subscription?.cancelAtPeriodEnd && subscription.periodEnd && (
        <p className="text-sm text-muted-foreground" data-cy="billing-cancel-scheduled">
          {t("settings.billing.actions.cancelScheduled", {
            date: new Date(subscription.periodEnd).toLocaleDateString(),
          })}
        </p>
      )}
    </SettingsSection>
  )
}
