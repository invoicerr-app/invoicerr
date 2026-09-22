import { FlaskConical } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

/**
 * Shown on the unauthenticated auth screens (mounted once from `AuthShell`, covering sign-in,
 * sign-up, and sign-up's single-sign-on-only variant) when the operator has set
 * `ENABLE_BETA_BANNER` (off by default — see entrypoint.sh's own header for how the raw env var
 * reaches `isBetaBannerEnabled()` here).
 *
 * The wording does one job, and it is not "manage expectations": it stops someone from issuing an
 * invoice here that they then rely on. An invoice is not a draft — once issued it takes a place in a
 * sequence the law expects to be unbroken, and it carries a retention obligation measured in years.
 * Someone running their real billing through a preview alongside their usual tool breaks that
 * numbering without noticing. Billing running in test mode is the second half: nothing is charged,
 * and a visitor should know that before entering card details rather than after.
 *
 * Said once, plainly, above the sign-in and sign-up form rather than buried in a footer link nobody
 * opens.
 */
export function BetaBanner({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <Alert variant="warning" className={cn(className)} data-cy="beta-banner">
      <FlaskConical />
      <AlertTitle>{t("auth.betaBanner.title")}</AlertTitle>
      <AlertDescription>{t("auth.betaBanner.description")}</AlertDescription>
    </Alert>
  )
}
