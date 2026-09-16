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
  /** `true` when this company's subscription still points at the pre-2026-09-16 per-USER Polar
   *  customer (backend's own `legacy-customer.ts`) — there is no automatic migration, the settings
   *  screen shows a plain re-subscribe notice instead. */
  legacySubscription: boolean
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
  /** Matches one of the two `POLAR_PRODUCT_ID_MONTHLY`/`YEARLY` products (backend's own
   *  `checkout-session.ts#resolveCheckoutProductId`). */
  slug: "monthly" | "yearly"
  successUrl: string
  returnUrl: string
}

/**
 * `POST /api/billing/checkout` — this app's OWN route (option A, product decision 2026-09-16: one
 * Polar customer PER COMPANY, never per user — see backend's `checkout-session.ts` header). The
 * ACTIVE COMPANY is resolved server-side (`@ActiveCompany()`); no company id is ever passed in the
 * body. The caller navigates the browser itself (`window.location.href = data.url`) — this hook only
 * performs the POST. Can reject with a `BILLING_EMAIL_TAKEN` code (see `ApiError.body`) when another
 * Polar customer already uses this company's resolved billing email.
 */
export function useStartCheckout() {
  return useApiMutation<StartCheckoutBody, PolarRouteResponse>("POST", "/api/billing/checkout")
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

export interface BillingEmailView {
  /** The raw override, or `null` when the company has never set one. */
  billingEmail: string | null
  /** The company's own contact email — what checkout falls back to when `billingEmail` is `null`. */
  companyEmail: string
}

/** `GET /api/billing/billing-email` — the value pre-filled into Settings > Billing's own billing-email
 *  field (backend's own `billing-email.ts`). */
export function useBillingEmail() {
  return useApiQuery<BillingEmailView>(queryKeys.billing.email(), "/api/billing/billing-email", {
    retry: false,
    staleTime: 60_000,
  })
}

/** `PUT /api/billing/billing-email` — sets (or, given `null`, clears) this company's billing-email
 *  override. Never talks to Polar itself; a duplicate-email refusal can only surface from
 *  `useStartCheckout` above, at actual checkout time. */
export function useSetBillingEmail() {
  return useApiMutation<{ billingEmail: string | null }, BillingEmailView>(
    "PUT",
    "/api/billing/billing-email",
    { invalidateKeys: [queryKeys.billing.email()] },
  )
}
