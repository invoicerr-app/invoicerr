import { TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useBillingStatus, useCompanies, useSeats } from "@/hooks/queries"

/**
 * Shown on the Members and Invitations settings screens when the company already has as many
 * members as it has bought seats for — the exact situation `invitations.service.ts`/`lib/auth.ts`
 * refuse the NEXT invitation acceptance for (`NO_FREE_SEAT`). Lets an OWNER/ADMIN see this BEFORE
 * minting an invitation nobody will be able to accept, rather than only after someone tries. `null`
 * outside SaaS mode (`useBillingStatus().isSuccess`) or for a plain MEMBER (nothing they can act on).
 */
export function NoFreeSeatNotice({ dataCy }: { dataCy?: string }) {
  const { t } = useTranslation()
  const { activeRole } = useCompanies()
  const canManage = activeRole === "OWNER" || activeRole === "ADMIN"
  const { isSuccess: billingAvailable } = useBillingStatus()
  const { data: seats } = useSeats(billingAvailable && canManage)

  if (!billingAvailable || !canManage || !seats || seats.members.length < seats.seats) return null

  return (
    <Alert variant="warning" data-cy={dataCy}>
      <TriangleAlertIcon />
      <AlertTitle>
        {t("settings.seats.noFreeSeatNotice.title", "No free seat — add one in the Polar portal")}
      </AlertTitle>
      <AlertDescription>
        <Link to="/settings/seats" className="underline underline-offset-4">
          {t("settings.seats.noFreeSeatNotice.link", "Open Settings > Seats")}
        </Link>
      </AlertDescription>
    </Alert>
  )
}
