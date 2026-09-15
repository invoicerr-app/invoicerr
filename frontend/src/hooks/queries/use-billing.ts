import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

export type CompanySubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "BLOCKED" | "ZIPPED" | "DELETED"

export interface BillingStatusView {
  status: CompanySubscriptionStatus
  seats: number
  interval: "MONTH" | "YEAR" | null
  trialEndsAt: string
  daysRemaining: number | null
  checkoutUrl: string
  portalUrl: string
}

/**
 * `GET /api/billing/status` — the ONLY signal the frontend has for whether hosted billing exists at
 * all on this instance (backend/src/modules/billing/billing.module.ts's own header: no Vite env var
 * mirrors the server-side flag on purpose). A self-hosted instance (the flag unset) answers 404 for
 * this route entirely — `retry: false` so that 404 surfaces immediately as `isError` rather than
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

interface PolarRouteResponse {
  url: string
  redirect: boolean
}

export interface StartCheckoutBody {
  /** Matches one of the two `checkout({ products: [...] })` entries `polar-plugin.ts` registers. */
  slug: "monthly" | "yearly"
  /** The ACTIVE COMPANY's id — this product bills per company, never per user (see
   *  `polar-plugin.ts`'s own header on why `referenceId` is what ties the resulting Polar
   *  checkout/subscription back to a company at all). */
  referenceId: string
  successUrl: string
  returnUrl: string
}

/**
 * Posts straight to better-auth's own `/api/auth/checkout` route (mounted by the `polar()` plugin,
 * never one of this app's own `/api/*` controller routes — see `polar-plugin.ts`'s header for why it
 * never goes through `@ActiveCompany()`, which is exactly why `referenceId` has to be supplied
 * explicitly in the body here). The caller navigates the browser itself
 * (`window.location.href = data.url`) — this hook only performs the POST.
 */
export function useStartCheckout() {
  return useApiMutation<StartCheckoutBody, PolarRouteResponse>("POST", "/api/auth/checkout")
}

/**
 * `POST /api/billing/portal` — this app's OWN route, not better-auth's `/api/auth/customer/portal`:
 * that better-auth route cannot open a session for this product's seat-based TEAM customers (Polar
 * requires a `memberId` it has no way to supply — see backend's `portal-session.ts` header). Redirects
 * the browser to Polar's own customer portal (manage payment method, cancel, see invoices). No body
 * needed.
 */
export function useOpenCustomerPortal() {
  return useApiMutation<undefined, PolarRouteResponse>("POST", "/api/billing/portal")
}
