import { ArrowLeftRight, Armchair, LogOutIcon } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useCompanies } from "@/hooks/queries"
import { useSwitchCompany } from "@/hooks/use-switch-company"
import { signOut } from "@/lib/sign-out"

/**
 * The full-app takeover for a member who has no seat: the company has fewer seats than members, and
 * the most recently arrived members are the ones left out (`seat-holders.ts` on the backend). Such a
 * member can do NOTHING on the company, not even read (product decision 2026-11-13): the backend
 * refuses every company route with `SEAT_REQUIRED` (`billing/seat-gate.ts`), and this screen replaces
 * the WHOLE app shell, no sidebar, no `<Outlet/>`. The fix is on an owner or admin (buy more seats, or
 * free one), never a self-serve action here. What the member CAN do is leave this company for another
 * one they belong to: the list comes from the session itself (`useCompanies()`, `/api/auth/*`, never
 * seat-gated) and the switch goes through the same `POST /api/companies/switch` as the sidebar, exempt
 * from the seat check because it reads nothing of the blocked company. With a single company the list is
 * absent and signing out is the only action.
 */
export function NotEnoughSeatsScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { companies, activeCompanyId } = useCompanies()
  const { switchCompany, switching } = useSwitchCompany()
  const [switchFailed, setSwitchFailed] = useState(false)
  const otherCompanies = companies.filter((company) => company.id !== activeCompanyId)

  const handleSwitch = async (companyId: string) => {
    setSwitchFailed(false)
    if (!(await switchCompany(companyId))) setSwitchFailed(true)
  }

  const handleSignOut = async () => {
    await signOut()
    void navigate("/auth/sign-in")
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center"
      data-cy="not-enough-seats-screen"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <Armchair className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </div>

      <Card className="max-w-md text-start">
        <CardHeader>
          <CardTitle className="text-balance">
            {t("seatGate.notEnoughSeats.title", "Your company doesn't have enough seats")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-pretty text-sm text-muted-foreground">
            {t(
              "seatGate.notEnoughSeats.description",
              "Every member needs a seat, and your company has more members than seats right now. Ask an owner or admin to buy more seats or to free one. You'll get access back automatically.",
            )}
          </p>
          {otherCompanies.length > 0 && (
            <div className="grid gap-2" data-cy="not-enough-seats-switch">
              <p className="text-sm font-medium">
                {t("seatGate.notEnoughSeats.switchLabel", "Switch to another company")}
              </p>
              <ul className="grid gap-2">
                {otherCompanies.map((company) => (
                  <li key={company.id}>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full justify-start"
                      disabled={switching}
                      onClick={() => handleSwitch(company.id)}
                      data-cy="not-enough-seats-switch-item"
                    >
                      <ArrowLeftRight />
                      <span className="flex-1 truncate text-start">{company.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {company.role}
                      </Badge>
                    </Button>
                  </li>
                ))}
              </ul>
              {switchFailed && (
                <p className="text-sm text-destructive" role="alert" data-cy="not-enough-seats-switch-error">
                  {t(
                    "seatGate.notEnoughSeats.switchError",
                    "Couldn't switch company. Try again in a moment.",
                  )}
                </p>
              )}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={handleSignOut}
            data-cy="not-enough-seats-sign-out"
          >
            <LogOutIcon />
            {t("seatGate.signOut", "Sign out")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
