import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { AlertTriangle, Info } from "lucide-react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

import { useBillingStatus } from "@/hooks/queries"
import { BILLING_BANNER_APPEARANCE } from "@/hooks/queries/billing-status-appearance"

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

  const { destructive: isDestructive, titleKey, descriptionKey } = BILLING_BANNER_APPEARANCE[status.status]

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
