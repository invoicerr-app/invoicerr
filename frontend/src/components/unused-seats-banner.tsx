import { AlertTriangle } from "lucide-react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useCompanies, useSeats } from "@/hooks/queries"

/**
 * Red banner at the top of Settings when the company pays for more seats than it has members
 * (product decision 2026-11-13: "1 user in 1 company = 1 seat", each company manages its own
 * subscription). Shown to OWNER/ADMIN only, the roles that can change the subscription; a MEMBER
 * never sees it. Renders nothing when billing is off on this instance (`useSeats` answers `null`),
 * while loading, and whenever every seat is used.
 *
 * The seat count is the quantity bought in Stripe (`CompanySubscription.seats`), never written by
 * Invoicerr, so the fix is in the billing settings: lower the quantity there, or invite someone.
 */
export function UnusedSeatsBanner() {
  const { t } = useTranslation()
  const { activeRole } = useCompanies()
  const isManager = activeRole === "OWNER" || activeRole === "ADMIN"
  const { data: seatsView } = useSeats(isManager)

  if (!isManager || !seatsView) return null
  const unused = seatsView.seats - seatsView.members.length - seatsView.waiting.length
  if (unused <= 0) return null

  return (
    <Alert variant="destructive" className="mb-6" data-cy="unused-seats-banner">
      <AlertTriangle />
      <AlertTitle>{t("settings.seats.unusedBanner.title", { count: unused })}</AlertTitle>
      <AlertDescription>
        <p>
          {t(
            "settings.seats.unusedBanner.description",
            "Your company pays for {{seats}} seats and has {{members}} members. Lower the seat quantity in Billing, or invite someone to use them.",
            { seats: seatsView.seats, members: seatsView.members.length },
          )}{" "}
          <Link to="/settings/billing" className="underline" data-cy="unused-seats-banner-billing-link">
            {t("settings.seats.unusedBanner.manage", "Manage billing")}
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  )
}
