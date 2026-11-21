import { useQueryClient } from "@tanstack/react-query"
import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import type { BrowserErrorTrackingConfig } from "@/lib/error-tracking"
import { queryKeys } from "@/lib/query-keys"

export type ErrorTrackingConsentChannel = "banner" | "settings"

/** Mirrors backend `error-tracking/consent/consent-policy.ts#ErrorTrackingConsentView`. */
export interface ErrorTrackingConsentView {
  /** False when this instance collects no browser error reports: no banner, no setting. */
  available: boolean
  /** True only for a grant still valid (current text, less than six months old). */
  granted: boolean
  /** No decision yet, an expired one, or one made on an older text: the banner asks. */
  decisionRequired: boolean
  textVersion: string
  decision: "granted" | "refused" | "withdrawn" | null
  decidedAt: string | null
  /** Filled in only when `granted`: what the SDK needs to start. */
  browser: BrowserErrorTrackingConfig | null
}

const URL = "/api/error-tracking/consent"

/** `GET /api/error-tracking/consent`: the signed-in user's own decision. Only used inside the signed-in layout. */
export function useErrorTrackingConsent() {
  return useApiQuery<ErrorTrackingConsentView>(queryKeys.errorTracking.consent(), URL, {
    staleTime: 5 * 60_000,
  })
}

/**
 * `PUT /api/error-tracking/consent`. The reply is the new view, written straight into the cache, so a
 * withdrawal stops the SDK as soon as the server has stored it, without waiting for a refetch.
 */
export function useDecideErrorTrackingConsent() {
  const queryClient = useQueryClient()
  return useApiMutation<{ granted: boolean; channel: ErrorTrackingConsentChannel }, ErrorTrackingConsentView>(
    "PUT",
    URL,
    {
      onSuccess: (view) => {
        queryClient.setQueryData(queryKeys.errorTracking.consent(), view)
      },
    },
  )
}
