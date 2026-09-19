import { Armchair, LogOutIcon } from "lucide-react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { authClient } from "@/lib/auth"

/**
 * The full-app takeover for a member who is currently WAITING for a seat (an over-capacity company —
 * the OWNER lowered the bought seat quantity below the current headcount, `seat-holders.ts` on the
 * backend). Mirrors `(app)/_layout.tsx`'s own legal-reacceptance gate: blocks the WHOLE app shell, no
 * sidebar, no `<Outlet/>` — the resolution is on the OWNER (free a seat, or buy more), never something
 * this screen offers a self-serve fix for.
 */
export function WaitingForSeatScreen({ ownerName }: { ownerName: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await authClient.signOut()
    navigate("/auth/sign-in")
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center"
      data-cy="waiting-for-seat-screen"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-warning text-warning-foreground">
        <Armchair className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </div>

      <Card className="max-w-md text-left">
        <CardHeader>
          <CardTitle className="text-balance">{t("seatGate.title", "Waiting for a seat")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-pretty text-sm text-muted-foreground">
            {ownerName
              ? t(
                  "seatGate.descriptionWithOwner",
                  "There's no free seat for you right now. Ask {{ownerName}} to free one, or buy more seats in the Polar portal — you'll get one back automatically.",
                  { ownerName },
                )
              : t(
                  "seatGate.description",
                  "There's no free seat for you right now. Ask your company's owner to free one, or buy more seats in the Polar portal — you'll get one back automatically.",
                )}
          </p>
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={handleSignOut}
            data-cy="waiting-for-seat-sign-out"
          >
            <LogOutIcon />
            {t("seatGate.signOut", "Sign out")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
