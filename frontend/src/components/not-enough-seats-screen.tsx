import { Armchair, LogOutIcon } from "lucide-react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { signOut } from "@/lib/sign-out"

/**
 * The full-app takeover for a member who has no seat: the company has fewer seats than members, and
 * the most recently arrived members are the ones left out (`seat-holders.ts` on the backend). Such a
 * member can do NOTHING on the company, not even read (product decision 2026-11-13): the backend
 * refuses every company route with `SEAT_REQUIRED` (`billing/seat-gate.ts`), and this screen replaces
 * the WHOLE app shell, no sidebar, no `<Outlet/>`. The fix is on an owner or admin (buy more seats, or
 * free one), never a self-serve action here, so the only button is signing out.
 */
export function NotEnoughSeatsScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()

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
