import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { type CompanySubscriptionStatus, useBillingStatus, useCompanies } from "@/hooks/queries"
import { SettingsPage, SettingsSection } from "./settings-section"

/** Chip tone per subscription status - a lifecycle, not a binary "good/bad": `success` while paying,
 *  `info` for a trial (informational, not yet an ask), `warning` once payment itself needs attention,
 *  `destructive` once the company stopped functioning, `secondary` (muted) once it's gone and there's
 *  nothing left to act on. */
const STATUS_VARIANT: Record<
  CompanySubscriptionStatus,
  "success" | "info" | "warning" | "destructive" | "secondary"
> = {
  ACTIVE: "success",
  TRIAL: "info",
  PAST_DUE: "warning",
  BLOCKED: "destructive",
  ZIPPED: "destructive",
  DELETED: "secondary",
}

/**
 * Settings > Subscription - only ever reached when `-[tab].tsx` decided to show the "billing" tab at
 * all, which it does ONLY once `useBillingStatus()` itself has already resolved 200 (see that hook's
 * own header: there is no Vite env mirror of the backend flag, `GET /api/billing/status` answering at
 * all IS the only signal). Still guards its own render on `isSuccess` below regardless - a direct
 * navigation to `/settings/billing` (a stale bookmark, a self-hosted instance where the tab was
 * visible a moment ago but the flag just got unset) must render nothing, not a half-populated screen.
 *
 * Read-only for now: it shows the current plan and what is counting down. Subscribing and managing the
 * subscription go through the Stripe plugin's checkout and customer portal, wired in a later step of
 * the Stripe billing work.
 */
export default function BillingSettings() {
  const { t } = useTranslation()
  const { activeRole } = useCompanies()
  const canManageBilling = activeRole === "OWNER" || activeRole === "ADMIN"
  const { data: status, isSuccess } = useBillingStatus()

  if (!isSuccess || !status) return null

  return (
    <SettingsPage
      title={t("settings.billing.title", "Subscription")}
      description={t("settings.billing.description")}
    >
      <SettingsSection
        dataCy="billing-settings"
        title={
          <>
            {t("settings.billing.currentPlan", "Current plan")}
            <Badge variant={STATUS_VARIANT[status.status]} data-cy="billing-status-badge">
              {t(`settings.billing.status.${status.status}`, status.status)}
            </Badge>
          </>
        }
        description={
          <>
            {t("settings.billing.seats", "{{count}} seat(s)", { count: status.seats })}
            {status.interval
              ? ` · ${t(`settings.billing.interval.${status.interval}`, status.interval)}`
              : ""}
          </>
        }
      >
        {status.daysRemaining !== null && (
          <p className="text-sm text-muted-foreground" data-cy="billing-days-remaining">
            {t("settings.billing.daysRemaining", "{{count}} day(s) remaining", {
              count: status.daysRemaining,
            })}
          </p>
        )}
        {!canManageBilling && (
          <p className="text-sm text-muted-foreground" data-cy="billing-member-notice">
            {t(
              "settings.billing.memberNotice",
              "Only the company's owner or an admin can manage the subscription.",
            )}
          </p>
        )}
      </SettingsSection>
    </SettingsPage>
  )
}
