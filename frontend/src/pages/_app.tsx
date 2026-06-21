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
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="rounded-full bg-red-100 p-3">
                <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
            <div className="space-y-1">
                <h1 className="text-xl font-semibold text-foreground">{t("errorBoundary.title")}</h1>
                <p className="max-w-md text-sm text-muted-foreground">{t("errorBoundary.description")}</p>
                {message ? <p className="max-w-md text-xs text-muted-foreground/70">{message}</p> : null}
            </div>
            <Button onClick={() => window.location.reload()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("errorBoundary.reload")}
            </Button>
        </div>
    )
}
