import { useApiQuery } from "./use-api-query"

// Mirrors backend/src/modules/documents/country-policy/schema.ts's DomesticInvoiceCurrencyFact.
// `null` (not an empty object) means no domestic-invoicing-currency rule is declared for this
// country: see this hook's own caller (document-create-dialog.tsx) for why that is used only to
// PRESELECT a currency, never to block anything on its own: the actual enforcement happens at
// "send", server side (country-policy/domestic-currency-issuance.ts).
export interface DomesticInvoiceCurrencyRule {
  currency: string
  provenance:
    | { kind: "legal"; sourceText: string; sourceCheckedAt: string }
    | { kind: "unverified"; resolutionNote: string }
  notes?: string
}

/**
 * The domestic-invoicing-currency rule for a country, or `null`, asked for with the SELLER's own
 * company country (never the buyer's alone): issue #558's Algeria fact only ever preselects a
 * currency once both parties turn out to share that same country, which the caller decides for
 * itself (document-create-dialog.tsx) by also comparing the resolved client's own country.
 */
export function useDomesticInvoiceCurrencyRule(countryCode: string | undefined | null, enabled: boolean) {
  const url =
    enabled && countryCode
      ? `/api/documents/domestic-invoice-currency?countryCode=${encodeURIComponent(countryCode)}`
      : null

  return useApiQuery<DomesticInvoiceCurrencyRule | null>(["domestic-invoice-currency", countryCode], url!, {
    enabled: !!url,
  })
}
