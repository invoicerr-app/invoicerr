import { useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Loader2 } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useBillingStatus, useOpenCustomerPortal, useStartCheckout } from "@/hooks/queries"
import { useCompanies } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

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
  const queryClient = useQueryClient()

  // Both Polar checkout and the Polar customer portal (see `manageSubscription` below) send the
  // company owner away from this tab to make a real change — plan, seats, payment method. This tab's
  // cached `billing status` has no way to know that happened on its own (Polar's webhook updates the
  // DB, but nothing pushes that to an already-open query), so re-checking it the moment this tab gets
  // focus back is what keeps the screen from showing a stale plan until the 60s staleTime lapses.
  useEffect(() => {
    const invalidateOnReturn = () => {
      if (document.visibilityState === "hidden") return
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.status() })
    }
    window.addEventListener("focus", invalidateOnReturn)
    document.addEventListener("visibilitychange", invalidateOnReturn)
    return () => {
      window.removeEventListener("focus", invalidateOnReturn)
      document.removeEventListener("visibilitychange", invalidateOnReturn)
    }
  }, [queryClient])

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
          window.location.href = data.url
        },
        onError: (error) => {
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
    // Polar's customer portal refuses to be framed (checked live against the sandbox portal URL
    // `createCustomerPortalSession` itself builds: `x-frame-options: DENY` and
    // `content-security-policy: frame-ancestors 'none'` on both the redirect and its destination) —
    // so this opens a new tab rather than an in-app iframe.
    //
    // `window.open` MUST run synchronously inside this click handler: every major browser's popup
    // blocker only allows a popup opened directly from a user gesture, and `POST /api/billing/portal`
    // resolving is asynchronous. Opening a blank tab now and pointing it at the real URL once the
    // portal session comes back is the only sequencing that survives that — a `target="_blank"` link
    // built after the fetch resolves would already be too late.
    const portalWindow = window.open("about:blank", "_blank", "noopener")

    openPortal.mutate(undefined, {
      onSuccess: (data) => {
        if (portalWindow) {
          portalWindow.location.href = data.url
        } else {
          // The blank tab itself got blocked (no window handle at all) — fall back to navigating
          // this tab rather than leaving the user with a button that silently did nothing.
          window.location.href = data.url
        }
      },
      onError: (error) => {
        // Nothing to show in the tab we opened — close it rather than stranding the owner on an
        // empty about:blank tab they didn't ask for.
        portalWindow?.close()
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
                disabled={startCheckout.isPending}
                data-cy="billing-subscribe-monthly"
              >
                {startCheckout.isPending && startCheckout.variables?.slug === "monthly" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                {t("settings.billing.subscribeMonthly", "Subscribe monthly")}
              </Button>
              <Button
                variant="outline"
                onClick={() => subscribe("yearly")}
                disabled={startCheckout.isPending}
                data-cy="billing-subscribe-yearly"
              >
                {startCheckout.isPending && startCheckout.variables?.slug === "yearly" ? (
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
            disabled={openPortal.isPending}
            data-cy="billing-manage-portal"
          >
            {openPortal.isPending ? (
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
