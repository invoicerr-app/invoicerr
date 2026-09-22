import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

export type CompanySubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "BLOCKED" | "ZIPPED" | "DELETED"

export interface BillingStatusView {
  /** The company-scoped subscription's own status — `ACTIVE` here is what actually gates "Manage
   *  subscription" in `billing.settings.tsx` (2026-09-15 incident): `hasCompanyCustomer` below alone
   *  only means a Polar customer OBJECT exists, never that it has a live subscription to manage — a
   *  company whose customer has none must land on "Subscribe", not a portal session opening to Polar's
   *  own empty "No Active Subscriptions". */
  status: CompanySubscriptionStatus
  seats: number
  interval: "MONTH" | "YEAR" | null
  trialEndsAt: string
  daysRemaining: number | null
  checkoutUrl: string
  portalUrl: string
  /** `true` when this company already has its OWN, company-scoped Polar customer (backend's own
   *  `legacy-customer.ts#getCompanyCustomerFacts`). `billing.settings.tsx` uses this — combined with
   *  `status === "ACTIVE"` (see that field's own doc comment below, 2026-09-15 incident) — to decide
   *  whether "Manage subscription" can even be shown: a concrete 2026-09-16 dev-instance incident
   *  proved a company reconciled to ACTIVE from a pre-migration customer still had none of its own, and
   *  the button surfaced a raw backend error message when clicked. Merely `true` here does NOT mean
   *  there is anything to manage — see `status`'s own comment. */
  hasCompanyCustomer: boolean
  /** `true` when this company's subscription still points at a pre-2026-09-16 per-USER Polar customer
   *  (backend's own `legacy-customer.ts`) that ITSELF still exists and still has an active/trialing
   *  subscription — `false` the moment either stops being true (the old customer was deleted, or its
   *  subscription was canceled), not merely because the stored id differs from the company-scoped one.
   *  There is no automatic migration, the settings screen shows a plain re-subscribe notice instead. */
  legacySubscription: boolean
  /** `true` when a link to the OLD, pre-migration per-USER Polar portal
   *  (`POST /api/billing/portal/legacy`) has a real chance of opening — checked only while
   *  `legacySubscription` is true. `false` (plain text, no link) otherwise. */
  legacyPortalAvailable: boolean
  /** `true` only while PAST_DUE AND a seat INCREASE's own card decline is still the most likely
   *  reason (backend's own `billing-status-view.ts`) — lets the banner/settings screen say "the
   *  payment for the seat you just added failed" instead of the generic "your last payment failed". */
  seatPaymentFailureExplainsStatus: boolean
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
  /** Checkout only (never set by the portal route): `true` when this company had a syntactically valid,
   *  non-exempt VAT number on file and Polar still refused it as a checkout tax id — backend's own
   *  `checkout-session.ts` retried automatically, WITHOUT it, so the checkout above still succeeded.
   *  `billing.settings.tsx` uses this to tell the owner why their VAT number did not reach Polar. */
  taxIdRejected?: true
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

/**
 * `POST /api/billing/portal/legacy` — opens a Polar customer-portal session for the CALLING user's own
 * PRE-MIGRATION customer (backend's own `portal-session.ts#createLegacyCustomerPortalSession`), so an
 * OWNER/ADMIN stuck in the `legacySubscription: true` case can cancel the old subscription by hand.
 * Only ever offered when `legacyPortalAvailable` is true (`useBillingStatus`) — see that field's own
 * doc comment.
 */
export function useOpenLegacyCustomerPortal() {
  return useApiMutation<undefined, PolarRouteResponse>("POST", "/api/billing/portal/legacy")
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
