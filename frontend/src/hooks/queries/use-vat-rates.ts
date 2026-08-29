import { useApiQuery } from "@/hooks/use-api-query"
import type { VatRatesResponse } from "@/types"

/**
 * The VAT rate list for a country's line-item picker. Static reference data — mirrors
 * `useDocumentKinds`/`useRequiredIdentifiers`: public endpoint, driven purely by the country code
 * the caller already has (the active company's `countryCode`), nothing read from the session.
 *
 * Without a country the query stays disabled and callers get `undefined` — an unknown company
 * country must render as "we don't know yet", never as a guess at a rate list.
 */
export function useVatRates(countryCode: string | undefined | null) {
  const url = countryCode ? `/api/compliance/vat-rates?countryCode=${encodeURIComponent(countryCode)}` : null

  return useApiQuery<VatRatesResponse>(["vat-rates", countryCode], url!, {
    enabled: !!url,
    staleTime: 5 * 60 * 1000,
  })
}
