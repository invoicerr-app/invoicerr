import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { ClientPaymentMethodRestriction, PaymentMethodConfig } from "@/types/payment-method"

/**
 * A company's own accepted payment methods — its own top-level screen (payment-methods/index.tsx),
 * not a settings tab. Mirrors the backend's `payment-methods/` module: `GET` always returns the FULL
 * registered list (configured or not); `PATCH` updates one method's own `enabled`/`config`.
 */

export function usePaymentMethods() {
  return useApiQuery<PaymentMethodConfig[]>(queryKeys.paymentMethods.list(), "/api/payment-methods")
}

export interface UpdatePaymentMethodVariables {
  methodId: string
  enabled?: boolean
  config?: Record<string, unknown>
}

/** Invalidates the list so the card immediately reflects the saved `enabled`/`config` — the same
 *  "one mutation, one invalidation" convention every other settings-shaped mutation in this app
 *  already follows (e.g. useImportBankStatement). */
export function useUpdatePaymentMethod() {
  return useApiMutation<UpdatePaymentMethodVariables, PaymentMethodConfig>(
    "PATCH",
    ({ methodId }) => `/api/payment-methods/${methodId}`,
    { invalidateKeys: [queryKeys.paymentMethods.list()] },
  )
}

/** Issue #416 ("payment methods per client") — one client's own restriction. `enabled` mirrors the
 *  SAME "only fetch once there is a real client id" guard `usePortalAccess` already holds for the
 *  identical client-scoped-dialog shape (`client-portal-access.tsx`). */
export function useClientPaymentMethodRestriction(clientId: string, enabled: boolean) {
  return useApiQuery<ClientPaymentMethodRestriction>(
    queryKeys.paymentMethods.clientRestriction(clientId),
    `/api/payment-methods/clients/${clientId}`,
    { enabled },
  )
}

/** Replaces a client's own restriction wholesale (`methodIds: []` clears it back to unrestricted).
 *  No static `invalidateKeys` here — the query key is per-CLIENT (`queryKeys.paymentMethods.
 *  clientRestriction(clientId)`), only known from the mutation's own variables, not at hook-build
 *  time — the exact same reason `useCreatePortalAccess`/`useRevokePortalAccess` leave invalidation to
 *  their own caller (`client-portal-access.tsx#invalidateList`) rather than this option. */
export function useUpdateClientPaymentMethodRestriction() {
  return useApiMutation<{ clientId: string; methodIds: string[] }, ClientPaymentMethodRestriction>(
    "PATCH",
    ({ clientId }) => `/api/payment-methods/clients/${clientId}`,
  )
}
