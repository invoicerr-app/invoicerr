import { ExternalLink, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useBillingStatus, useOpenCustomerPortal, useStartCheckout } from "@/hooks/queries"
import { useCompanies } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"

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

  // `mutate*.isPending` falls back to false as soon as the mutation's own promise resolves — i.e. as
  // soon as `onSuccess` runs — but `window.location.*` navigation still takes a beat (up to a few
  // seconds) before the browser actually leaves this page. Without this, the button re-enables and
  // the spinner stops while the user is still staring at this screen waiting for Polar to load. These
  // stay `true` all the way through navigation and are only cleared on `onError` (the promise
  // rejected, so we never leave) or by the `pageshow` guard below (bfcache back-navigation).
  const [navigatingPortal, setNavigatingPortal] = useState(false)
  const [navigatingCheckoutSlug, setNavigatingCheckoutSlug] = useState<"monthly" | "yearly" | null>(null)

  // Coming back to this page via the browser's back button can restore it from the bfcache instead of
  // re-rendering it fresh — `event.persisted === true` — which would otherwise leave a spinner stuck
  // forever on a button whose navigation never actually completed from this page's point of view.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      setNavigatingPortal(false)
      setNavigatingCheckoutSlug(null)
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])

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
        // Polar Checkout stays a same-tab redirect (unlike the portal below) — the user comes back
        // via `successUrl` on THIS route, so there is no separate tab to manage and no focus/
        // visibilitychange dance needed here.
        onSuccess: (data) => {
          setNavigatingCheckoutSlug(interval)
          window.location.href = data.url
        },
        onError: (error) => {
          setNavigatingCheckoutSlug(null)
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("settings.billing.messages.checkoutError", "Failed to start checkout"),
          )
        },
      },
    )
  }

  const manageSubscription = () => {
    // Same-tab navigation to the Polar customer portal — no popup, no iframe (Polar's portal refuses
    // to be framed anyway). The button stays disabled + spinning from `openPortal.isPending` (the
    // request itself) through `navigatingPortal` (the redirect that follows) so there's no window for
    // a double click to fire a second portal-session request, and no gap where the button looks idle
    // while Polar is still loading.
    openPortal.mutate(undefined, {
      onSuccess: (data) => {
        setNavigatingPortal(true)
        window.location.assign(data.url)
      },
      onError: (error) => {
        setNavigatingPortal(false)
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.billing.messages.portalError", "Failed to open the subscription portal"),
        )
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
                disabled={startCheckout.isPending || navigatingCheckoutSlug !== null}
                data-cy="billing-subscribe-monthly"
              >
                {(startCheckout.isPending && startCheckout.variables?.slug === "monthly") ||
                navigatingCheckoutSlug === "monthly" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                {t("settings.billing.subscribeMonthly", "Subscribe monthly")}
              </Button>
              <Button
                variant="outline"
                onClick={() => subscribe("yearly")}
                disabled={startCheckout.isPending || navigatingCheckoutSlug !== null}
                data-cy="billing-subscribe-yearly"
              >
                {(startCheckout.isPending && startCheckout.variables?.slug === "yearly") ||
                navigatingCheckoutSlug === "yearly" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                {t("settings.billing.subscribeYearly", "Subscribe yearly")}
              </Button>
            </div>
          )}

          <Button
            variant="secondary"
            onClick={manageSubscription}
            disabled={openPortal.isPending || navigatingPortal}
            data-cy="billing-manage-portal"
          >
            {openPortal.isPending || navigatingPortal ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            {t("settings.billing.managePortal", "Manage subscription")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
