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
 */
export function DemoBanner() {
  const { t } = useTranslation()
  const { demoMode } = useDemoMode()

  if (!demoMode) return null

  return (
    <Alert variant="warning" className="mb-0 rounded-none border-x-0" data-cy="demo-banner">
      <Info />
      <AlertTitle>{t("demo.banner.title", "Demo: data resets every 4 hours")}</AlertTitle>
      <AlertDescription>
        {t("demo.banner.description", "Nothing you enter is kept or sent.")}
      </AlertDescription>
    </Alert>
  )
}
