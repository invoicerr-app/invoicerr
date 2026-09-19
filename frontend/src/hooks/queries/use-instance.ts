import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

export interface InstancePreflightView {
  companies: number
  users: number
  documents: number
}

/**
 * `GET /api/instance/danger/preflight` — the ONE signal the frontend has for whether the
 * instance-reset feature exists on this deployment at all (backend/src/modules/instance/
 * instance.controller.ts's own header): masked entirely on SaaS (404) and refused for anyone not on
 * `INSTANCE_OPERATOR_EMAILS` (403) — `retry: false` so either non-200 surfaces immediately as
 * `isError`/`!isSuccess` rather than react-query retrying a request that can never succeed. The exact
 * same "not isSuccess means the feature does not exist here" contract `use-billing.ts#useBillingStatus`
 * already holds for hosted billing.
 */
export function useInstancePreflight() {
  return useApiQuery<InstancePreflightView>(
    queryKeys.instance.preflight(),
    "/api/instance/danger/preflight",
    {
      retry: false,
      staleTime: 60_000,
    },
  )
}

interface MessageResponse {
  message: string
}

export function useRequestInstanceResetOtp() {
  return useApiMutation<void, MessageResponse>("POST", "/api/instance/danger/otp")
}

export interface ConfirmInstanceResetInput {
  otp: string
  confirmationWord: string
}

export function useConfirmInstanceReset() {
  return useApiMutation<ConfirmInstanceResetInput, MessageResponse>("POST", "/api/instance/danger/reset")
}
