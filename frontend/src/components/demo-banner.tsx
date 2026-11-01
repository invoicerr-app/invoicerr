import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useDemoMode } from "@/hooks/queries"

/**
 * A one-line strip on every authenticated page while `DEMO_MODE` is on, mirroring
 * `BillingBanner`'s own "always mounted, decides for itself whether to render anything" shape and
 * mount point (`(app)/_layout.tsx`, right above the header). Purely informational: every action this
 * banner does NOT need to explain is already refused server-side regardless of whether a visitor
 * reads it.
 */
export function DemoBanner() {
  const { t } = useTranslation()
  const { demo } = useDemoMode()

  if (!demo) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-warning-foreground/15 bg-warning/70 px-4 py-1.5 text-[13px] text-warning-foreground md:px-6"
      data-cy="demo-banner"
    >
      <Info className="size-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 truncate">
        <span className="font-semibold">{t("demo.banner.title", { count: demo.resetIntervalHours })}</span>{" "}
        <span>{t("demo.banner.description", "Nothing you enter is kept or sent.")}</span>
      </p>
    </div>
  )
}
