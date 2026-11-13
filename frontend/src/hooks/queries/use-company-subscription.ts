import { useMutation, useQuery } from "@tanstack/react-query"

import { authClient } from "@/lib/auth"
import { queryKeys } from "@/lib/query-keys"

/** The fields of the Stripe plugin's subscription row this app reads. */
export interface CompanyStripeSubscription {
  id: string
  plan: string
  status: string
  seats?: number | null
  billingInterval?: string | null
  periodEnd?: string | Date | null
  cancelAtPeriodEnd?: boolean | null
}

/**
 * Every call bills the company's own Stripe customer, never the one of whoever clicks: the plugin's
 * `organization` customer type, whose model the backend maps onto the Company table. The backend
 * refuses any call without it (`stripe-plugin.ts`, `canActOnCompanySubscription`).
 */
export const COMPANY_CUSTOMER_TYPE = "organization" as const

/** Unwraps a better-auth client result: the data, or a thrown Error carrying the server's message. */
function unwrap<T>(result: { data: T | null; error: { message?: string } | null }): T {
  if (result.error) throw new Error(result.error.message || "Billing request failed")
  return result.data as T
}

/**
 * The active (or trialing) Stripe subscription of the active company, or `null` when it has none.
 * The plugin's list endpoint only returns active and trialing rows; a past due subscription is
 * therefore read from `GET /api/billing/status` instead (`PAST_DUE`). Only enabled once the
 * caller knows hosted billing exists, so a self-hosted instance never calls it.
 */
export function useCompanyStripeSubscription(companyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.billing.stripeSubscription(companyId),
    enabled: enabled && !!companyId,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<CompanyStripeSubscription | null> => {
      const rows = unwrap(
        await authClient.subscription.list({
          query: { referenceId: companyId as string, customerType: COMPANY_CUSTOMER_TYPE },
        }),
      ) as CompanyStripeSubscription[] | null
      return rows?.[0] ?? null
    },
  })
}

/** Where Stripe sends the browser back to: the Subscription tab, on this same origin. */
export function billingReturnUrl(query = ""): string {
  return `${window.location.origin}/settings/billing${query}`
}

/**
 * Starts a Stripe Checkout for the standard grid and redirects the browser to it. `seats` is the
 * quantity the manager chose; Invoicerr never changes it afterwards (the seat count is whatever
 * the subscription says). The founder grid is refused by the backend at checkout.
 */
export function useStartCheckout() {
  return useMutation({
    mutationFn: async ({ companyId, annual, seats }: { companyId: string; annual: boolean; seats: number }) =>
      unwrap(
        await authClient.subscription.upgrade({
          plan: "standard",
          annual,
          seats,
          referenceId: companyId,
          customerType: COMPANY_CUSTOMER_TYPE,
          successUrl: billingReturnUrl("?checkout=success"),
          cancelUrl: billingReturnUrl(),
        }),
      ),
  })
}

/**
 * Opens the Stripe Customer Portal (payment method, card or SEPA Direct Debit, invoice history,
 * seat quantity, cancellation; what it offers is configured in the Stripe dashboard).
 */
export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: async ({ companyId }: { companyId: string }) =>
      unwrap(
        await authClient.subscription.billingPortal({
          referenceId: companyId,
          customerType: COMPANY_CUSTOMER_TYPE,
          returnUrl: billingReturnUrl(),
        }),
      ),
  })
}

/** Opens the portal's cancellation confirmation for this company's subscription. */
export function useCancelSubscription() {
  return useMutation({
    mutationFn: async ({ companyId }: { companyId: string }) =>
      unwrap(
        await authClient.subscription.cancel({
          referenceId: companyId,
          customerType: COMPANY_CUSTOMER_TYPE,
          returnUrl: billingReturnUrl("?cancel=done"),
        }),
      ),
  })
}
