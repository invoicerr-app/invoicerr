import { WifiOff } from "lucide-react"
import { useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

/** Whether the browser reports a network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/** A one-line strip above every signed-in page while the device has no network. */
export function OfflineBanner() {
  const { t } = useTranslation()
  const online = useOnline()
  if (online) return null
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b bg-sunken px-4 py-1.5 text-[13px] text-ink-2 md:px-6"
      data-cy="offline-banner"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0">
        <span className="font-semibold text-foreground">{t("offline.title")}</span>{" "}
        <span>{t("offline.description")}</span>
      </p>
    </div>
  )
}
