import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { AlertTriangle, Info } from "lucide-react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

import { useBillingStatus } from "@/hooks/queries"

/**
 * Trial/blocked banner — mounted once, for the whole authenticated app (`(app)/_layout.tsx`), the
 * same "always mounted, decides for itself whether to render anything" shape
 * `ServerUnavailableBanner` uses. Renders NOTHING unless `GET /api/billing/status` actually answers
 * 200 (`isSuccess`) — the only signal this frontend has that hosted billing exists on this instance at
 * all (see `use-billing.ts`'s own header) — and even then only for the statuses that need the user's
 * attention (never for ACTIVE).
 */
export function BillingBanner() {
  const { t } = useTranslation()
  const { data: status, isSuccess } = useBillingStatus()

  if (!isSuccess || !status || status.status === "ACTIVE") return null

  const isDestructive = status.status === "BLOCKED" || status.status === "ZIPPED"

  // A seat-specific card decline (`seat-sync.ts`'s own header, `billing-status-view.ts`'s
  // `seatPaymentFailureExplainsStatus`) gets its OWN wording — "the payment for the seat you just
  // added failed" is a more actionable, honest explanation than the generic "your last payment
  // failed" when that really is the reason, and never shown once it is no longer the most likely one.
  const isSeatPaymentFailure = status.status === "PAST_DUE" && status.seatPaymentFailureExplainsStatus

  const titleKey = isSeatPaymentFailure
    ? "billing.banner.pastDue.seatPaymentFailed.title"
    : status.status === "TRIAL"
      ? "billing.banner.trial.title"
      : status.status === "BLOCKED"
        ? "billing.banner.blocked.title"
        : status.status === "ZIPPED"
          ? "billing.banner.zipped.title"
          : "billing.banner.pastDue.title"

  const descriptionKey = isSeatPaymentFailure
    ? "billing.banner.pastDue.seatPaymentFailed.description"
    : status.status === "TRIAL"
      ? "billing.banner.trial.description"
      : status.status === "BLOCKED"
        ? "billing.banner.blocked.description"
        : status.status === "ZIPPED"
          ? "billing.banner.zipped.description"
          : "billing.banner.pastDue.description"

  return (
    <Alert
      variant={isDestructive ? "destructive" : "default"}
      className="mb-0 rounded-none border-x-0"
      data-cy="billing-banner"
    >
      {isDestructive ? <AlertTriangle /> : <Info />}
      <AlertTitle>
        {t(titleKey, { count: status.daysRemaining ?? 0, defaultValue: "Your subscription needs attention" })}
      </AlertTitle>
      <AlertDescription>
        {t(descriptionKey, { defaultValue: "See Settings > Subscription for details." })}{" "}
        <Link to="/settings/billing" className="underline">
          {t("billing.banner.cta", "Manage subscription")}
        </Link>
      </AlertDescription>
    </Alert>
  )
}
