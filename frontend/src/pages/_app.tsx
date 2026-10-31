import { AlertTriangle, RefreshCw } from "lucide-react"
import { isRouteErrorResponse, useRouteError } from "react-router"

import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"

export function Catch() {
  const error = useRouteError()
  const { t } = useTranslation()

  const message = isRouteErrorResponse(error)
    ? error.statusText || error.data
    : error instanceof Error
      ? error.message
      : undefined

  if (import.meta.env.DEV && error) {
    console.error(error)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-6 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-destructive-soft text-destructive-soft-foreground">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl text-foreground">{t("errorBoundary.title")}</h1>
        <p className="text-[15px] text-ink-2">{t("errorBoundary.description")}</p>
      </div>
      <Button onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden="true" />
        {t("errorBoundary.reload")}
      </Button>
      {/* The raw message helps a bug report, not the reader: folded away by default. */}
      {message ? (
        <details className="max-w-md text-start text-sm text-muted-foreground">
          <summary className="focus-ring cursor-pointer rounded-sm text-center">
            {t("errorBoundary.details")}
          </summary>
          <p className="mt-2 break-words font-mono text-xs">{String(message)}</p>
        </details>
      ) : null}
    </div>
  )
}
