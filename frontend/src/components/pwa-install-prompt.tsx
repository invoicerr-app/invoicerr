import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Download, Share, X } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

const DISMISSED_STORAGE_KEY = "pwa-install-dismissed-at"
const DISMISS_SNOOZE_DAYS = 30

/**
 * Chrome/Edge fire this on any page that meets their own installability criteria; there is no
 * standard lib.dom type for it. iOS Safari never fires it — see the header below.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * Pure detection helpers — deliberately free of `window`/`navigator`/`localStorage` so the vitest
 * spec can cover them without mocking the DOM. The component below is the only caller.
 */
export function isIosUserAgent(userAgent: string): boolean {
  return /iPhone|iPad|iPod/.test(userAgent)
}

export function isStandaloneDisplay(matchesStandaloneMedia: boolean, navigatorStandalone?: boolean): boolean {
  return matchesStandaloneMedia || navigatorStandalone === true
}

export function isDismissalActive(
  dismissedAtRaw: string | null,
  now: number,
  snoozeDays = DISMISS_SNOOZE_DAYS,
): boolean {
  if (!dismissedAtRaw) return false
  const dismissedAt = Number(dismissedAtRaw)
  if (!Number.isFinite(dismissedAt)) return false
  const elapsedDays = (now - dismissedAt) / (1000 * 60 * 60 * 24)
  return elapsedDays < snoozeDays
}

function readDismissedAt(): string | null {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, quota, disabled) — treat as "never dismissed".
    return null
  }
}

function writeDismissedAt(): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, String(Date.now()))
  } catch {
    // Same as above: worst case the banner reappears next visit instead of staying snoozed.
  }
}

type Platform = "android" | "ios" | null

/**
 * Install prompt banner — mounted once for the whole authenticated app ((app)/_layout.tsx), the
 * same "always mounted, decides for itself whether to render anything" shape as BillingBanner /
 * ServerUnavailableBanner.
 *
 * Two platforms, two different mechanisms, because the web has no unified install API:
 * - Android/desktop Chrome & Edge fire `beforeinstallprompt` when THEY decide the page is
 *   installable. We capture and preventDefault() it (so the browser's own mini-infobar doesn't
 *   also show) and replay it later from our own Install button.
 * - iOS Safari never fires that event at all — there is no programmatic install API on iOS, full
 *   stop. The only thing a web app can do there is tell the user the manual path (Share menu →
 *   Add to Home Screen). Detected by user-agent since feature-detecting "can't do this" isn't
 *   possible any other way.
 */
export function PwaInstallPrompt() {
  const { t } = useTranslation()
  const [platform, setPlatform] = useState<Platform>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    // Guards the whole effect, not just the render: under Cypress this never registers listeners
    // and `platform` never leaves `null`, so the component renders nothing (see main.tsx's own
    // service-worker guard for why a stray PWA affordance under Cypress is a real hazard class).
    if ("Cypress" in window) return

    const standalone = isStandaloneDisplay(
      window.matchMedia("(display-mode: standalone)").matches,
      (navigator as Navigator & { standalone?: boolean }).standalone,
    )
    if (standalone) return

    if (isDismissalActive(readDismissedAt(), Date.now())) return

    if (isIosUserAgent(navigator.userAgent)) {
      setPlatform("ios")
      return
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
      setPlatform("android")
    }
    const onAppInstalled = () => {
      setDeferredPrompt(null)
      setPlatform(null)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onAppInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onAppInstalled)
    }
  }, [])

  if (!platform) return null

  const handleDismiss = () => {
    writeDismissedAt()
    setPlatform(null)
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    // The `beforeinstallprompt` event is single-use regardless of the user's choice — a fresh one
    // only ever fires again after a future page load, never on demand.
    setDeferredPrompt(null)
    setPlatform(null)
  }

  return (
    <Alert
      className="mb-0 rounded-none border-x-0 fixed inset-x-0 bottom-0 z-50 border-b-0"
      data-cy="pwa-install-prompt"
    >
      {platform === "ios" ? <Share /> : <Download />}
      <AlertTitle>{t(`pwaInstall.${platform}.title`)}</AlertTitle>
      <AlertDescription>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {t(`pwaInstall.${platform}.description`)}
          {platform === "android" && (
            <Button size="sm" onClick={handleInstall} data-cy="pwa-install-button">
              {t("pwaInstall.android.install")}
            </Button>
          )}
        </span>
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDismiss}
        aria-label={t("pwaInstall.dismiss")}
        className="absolute top-2 right-2"
        data-cy="pwa-install-dismiss"
      >
        <X />
      </Button>
    </Alert>
  )
}
