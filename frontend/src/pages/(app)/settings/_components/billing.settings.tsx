import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { useBillingStatus, useCompanies } from "@/hooks/queries"
import { STATUS_BADGE_VARIANT } from "@/hooks/queries/billing-status-appearance"
import { isCompanyAdmin } from "@/hooks/queries/use-companies"
import { SettingsPage, SettingsSection } from "@/components/settings-section"
import { SubscriptionActions } from "./subscription-actions"

/**
 * Settings > Subscription - only ever reached when `-[tab].tsx` decided to show the "billing" tab at
 * all, which it does ONLY once `useBillingStatus()` itself has already resolved 200 (see that hook's
 * own header: there is no Vite env mirror of the backend flag, `GET /api/billing/status` answering at
 * all IS the only signal). Still guards its own render on `isSuccess` below regardless - a direct
 * navigation to `/settings/billing` (a stale bookmark, a self-hosted instance where the tab was
 * visible a moment ago but the flag just got unset) must render nothing, not a half-populated screen.
 *
 * Everyone sees the current plan and what is counting down. An OWNER or ADMIN also gets
 * `SubscriptionActions`: Stripe Checkout when the company has no subscription, the Stripe Customer
 * Portal and its cancellation page once it has one.
 */
export default function BillingSettings() {
  const { t } = useTranslation()
  const { activeRole, activeCompanyId } = useCompanies()
  const canManageBilling = isCompanyAdmin(activeRole)
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
            <Badge variant={STATUS_BADGE_VARIANT[status.status]} data-cy="billing-status-badge">
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
      {canManageBilling && activeCompanyId && (
        <SubscriptionActions
          companyId={activeCompanyId}
          status={status.status}
          priceGrid={status.priceGrid}
        />
      )}
    </SettingsPage>
  )
}
