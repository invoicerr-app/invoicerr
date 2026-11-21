import { FileQuestion, TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useOnline } from "@/components/offline-banner"
import { ApiError } from "@/hooks/use-api-query"

/** Whether a failed read means the thing does not exist, as opposed to a request that never got an
 *  answer (no network, a server error). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400)
}

interface DocumentLoadStateProps {
  error: unknown
  /** What to say when the server answered that it does not exist. */
  notFoundTitle: string
  notFoundDataCy: string
  onRetry?: () => void
}

/** A document page that could not load what it shows: "not found" only when the server said so,
 *  otherwise a load error with a retry, so a dropped connection never reads as a missing record. */
export function DocumentLoadState({ error, notFoundTitle, notFoundDataCy, onRetry }: DocumentLoadStateProps) {
  const { t } = useTranslation()
  // Offline, a query is paused rather than failed: no error, no data, and nothing to call missing.
  const online = useOnline()
  if (isNotFoundError(error) || (!error && online)) {
    return <EmptyState icon={FileQuestion} title={notFoundTitle} data-cy={notFoundDataCy} />
  }
  return (
    <EmptyState
      icon={TriangleAlert}
      tone="destructive"
      title={t("common.emptyState.loadErrorTitle")}
      description={t("common.emptyState.loadErrorHint")}
      action={
        onRetry && (
          <Button type="button" variant="outline" onClick={onRetry} dataCy="document-load-retry">
            {t("common.emptyState.retry")}
          </Button>
        )
      }
      data-cy="document-load-error"
    />
  )
}
