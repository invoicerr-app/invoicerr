import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useDemoMode } from "@/hooks/queries"

/**
 * Issue #533: a sticky top strip on every authenticated page while `DEMO_MODE` is on, mirroring
 * `BillingBanner`'s own "always mounted, decides for itself whether to render anything" shape and
 * mount point (`(app)/_layout.tsx`, right above the header). Purely informational: every action this
 * banner does NOT need to explain is already refused server-side regardless of whether a visitor
 * reads it.
 *
 * Issue #592: the copy names the outbound actions a visitor can no longer mistake for live (sending,
 * e-invoicing declarations, payments), and the Send button already shows its own disabled state.
 */
export function DemoBanner() {
  const { t } = useTranslation()
  const { demo } = useDemoMode()

  if (!demo) return null

  return (
    <Alert variant="warning" className="mb-0 rounded-none border-x-0" data-cy="demo-banner">
      <Info />
      <AlertTitle>{t("demo.banner.title", { count: demo.resetIntervalHours })}</AlertTitle>
      <AlertDescription>
        {t(
          "demo.banner.description",
          "Nothing you enter is kept or sent. Sending documents, e-invoicing declarations and payments are disabled in this demo.",
        )}
      </AlertDescription>
    </Alert>
  )
}
