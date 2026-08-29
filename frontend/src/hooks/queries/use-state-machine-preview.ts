import { useApiQuery } from "@/hooks/use-api-query"
import type { StateMachinePreviewResponse } from "@/types"

/**
 * Country codes with a real (non-fallback) compliance profile — populates the `/dev/state-machine`
 * page's selectors. Authenticated (unlike the onboarding-facing `document-kinds`/`vat-rates`
 * endpoints): this is an internal diagnostic tool, not something the sign-in flow needs.
 */
export function useComplianceCountries() {
  return useApiQuery<{ countries: string[] }>(["compliance-countries"], "/api/compliance/countries")
}

export interface StateMachinePreviewParams {
  supplierCountry: string
  buyerCountry: string
  buyerRole: string
  documentKind?: string
  issueDate?: string
  supplyType?: string
}

/**
 * The compliance engine's resolved plan + assembled lifecycle graph for a SYNTHETIC transaction —
 * backs the `/dev/state-machine` page. No invoice or company is read or created; the backend builds
 * the `TransactionContext` purely from these query params.
 *
 * Disabled until both countries and a buyer role are chosen: an incomplete triplet must render as
 * "pick something", never as a guessed call to the engine.
 */
export function useStateMachinePreview(params: StateMachinePreviewParams) {
  const enabled = !!params.supplierCountry && !!params.buyerCountry && !!params.buyerRole

  const search = new URLSearchParams({
    supplierCountry: params.supplierCountry,
    buyerCountry: params.buyerCountry,
    buyerRole: params.buyerRole,
  })
  if (params.documentKind) search.set("documentKind", params.documentKind)
  if (params.issueDate) search.set("issueDate", params.issueDate)
  if (params.supplyType) search.set("supplyType", params.supplyType)

  return useApiQuery<StateMachinePreviewResponse>(
    [
      "state-machine-preview",
      params.supplierCountry,
      params.buyerCountry,
      params.buyerRole,
      params.documentKind,
      params.issueDate,
      params.supplyType,
    ],
    `/api/compliance/state-machine-preview?${search.toString()}`,
    { enabled, retry: false },
  )
}
