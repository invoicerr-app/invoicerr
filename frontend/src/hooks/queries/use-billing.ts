import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

export type CompanySubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "BLOCKED" | "ZIPPED" | "DELETED"

/** Mirrors the backend's own `billing-status-view.ts#BillingStatusView`. */
export interface BillingStatusView {
  status: CompanySubscriptionStatus
  seats: number
  interval: "MONTH" | "YEAR" | null
  trialEndsAt: string
  daysRemaining: number | null
  /** The price grid a checkout uses: `founder` while the company holds the founder grid. */
  priceGrid: "standard" | "founder"
}

/**
 * `GET /api/billing/status` - the ONLY signal the frontend has for whether hosted billing exists at
 * all on this instance (backend/src/modules/billing/billing.module.ts's own header: no Vite env var
 * mirrors the server-side flag on purpose). A self-hosted instance (the flag unset) answers 404 for
 * this route entirely - `retry: false` so that 404 surfaces immediately as `isError` rather than
 * react-query retrying a request that can never succeed; every consumer (the banner, the Settings tab
 * list) treats "not `isSuccess`" as "billing does not exist here", never as a loading/error state to
 * show the user anything about.
 */
export function useBillingStatus() {
  return useApiQuery<BillingStatusView>(queryKeys.billing.status(), "/api/billing/status", {
    retry: false,
    staleTime: 60_000,
  })
}
