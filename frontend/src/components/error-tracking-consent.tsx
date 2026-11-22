import { Bug } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { SettingsSection } from "@/components/settings-section"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useDecideErrorTrackingConsent, useErrorTrackingConsent } from "@/hooks/queries"
import { startErrorTracking, stopErrorTracking } from "@/lib/error-tracking"

/**
 * Starts or stops browser error reporting from the signed-in user's stored decision, and asks for one
 * when none is current (never asked, older than six months, or made on an older text). Mounted once,
 * in the signed-in layout (`(app)/_layout.tsx`), so nothing about error reporting runs before sign-in
 * or on the portal, signature, sign-in and legal pages, which have their own layouts.
 *
 * Off by default: the SDK starts only on a `granted` answer from the server, which is also the only
 * way the browser learns where to send reports. Any other answer, an error, or leaving the layout
 * (signing out) stops it at once.
 */
export function ErrorTrackingConsentController() {
  const { data } = useErrorTrackingConsent()
  const browser = data?.granted ? data.browser : null
  const dsn = browser?.dsn ?? null

  // Keyed on the DSN only: the config object changes identity on every refetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `browser` is read through `dsn`.
  useEffect(() => {
    if (browser) void startErrorTracking(browser)
    else void stopErrorTracking()
  }, [dsn])

  useEffect(() => {
    return () => {
      void stopErrorTracking()
    }
  }, [])

  if (!data?.available || !data.decisionRequired) return null
  return <ErrorTrackingConsentBanner />
}

/**
 * The question itself. "Allow" and "Don't allow" are the same size, the same style and side by side:
 * refusing has to be exactly as easy as accepting. Either answer is stored with channel `banner`.
 */
function ErrorTrackingConsentBanner() {
  const { t } = useTranslation()
  const decide = useDecideErrorTrackingConsent()

  const answer = (granted: boolean) =>
    decide.mutate(
      { granted, channel: "banner" },
      { onError: () => toast.error(t("errorTracking.consent.saveError")) },
    )

  return (
    <section
      aria-label={t("errorTracking.consent.banner.title")}
      className="flex flex-col gap-2 border-b bg-muted/60 px-4 py-2 text-[13px] sm:flex-row sm:items-center md:px-6"
      data-cy="error-tracking-consent-banner"
    >
      <Bug className="hidden size-3.5 shrink-0 sm:block" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{t("errorTracking.consent.banner.title")}</span>{" "}
        <span>{t("errorTracking.consent.description")}</span>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={decide.isPending}
          onClick={() => answer(false)}
          data-cy="error-tracking-consent-refuse"
        >
          {t("errorTracking.consent.banner.refuse")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={decide.isPending}
          onClick={() => answer(true)}
          data-cy="error-tracking-consent-accept"
        >
          {t("errorTracking.consent.banner.accept")}
        </Button>
      </div>
    </section>
  )
}

/**
 * The account setting (`Account > Preferences`): the same decision, changeable at any time, stored with
 * channel `settings`. Off unless a grant is current. Hidden on an instance that collects nothing.
 */
export function ErrorTrackingConsentSetting() {
  const { t } = useTranslation()
  const { data } = useErrorTrackingConsent()
  const decide = useDecideErrorTrackingConsent()

  if (!data?.available) return null

  return (
    <SettingsSection
      title={t("errorTracking.consent.setting.title")}
      help={t("errorTracking.consent.description")}
      dataCy="account-preferences-error-tracking-card"
    >
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={data.granted}
          disabled={decide.isPending}
          onCheckedChange={(granted) =>
            decide.mutate(
              { granted, channel: "settings" },
              { onError: () => toast.error(t("errorTracking.consent.saveError")) },
            )
          }
          data-cy="error-tracking-consent-switch"
        />
        {t("errorTracking.consent.setting.label")}
      </label>
    </SettingsSection>
  )
}
