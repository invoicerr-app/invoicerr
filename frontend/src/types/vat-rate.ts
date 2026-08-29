export type VatRateCategory = "STANDARD" | "REDUCED" | "SUPER_REDUCED" | "ZERO" | "EXEMPT"

export type VatRateConfidence = "OFFICIAL" | "UNVERIFIED"

/**
 * One entry in a country's VAT rate catalog — mirrors `VatRateView` in
 * backend/src/compliance/nest/required-fields.controller.ts. `label` is the country's own official
 * term (e.g. "Taux normal") and is shown as-is: it is DATA, like a client or article name, not
 * application chrome, so it is deliberately not run through i18n `t()`.
 */
export interface VatRate {
  id: string
  rate: number
  label: string
  category: VatRateCategory
  confidence: VatRateConfidence
  source: string
  sourceCheckedAt: string
  notes?: string | null
}

/**
 * Why no rate list is offered — a code, not a message, so the label goes through the frontend's own
 * `t()` rather than a raw backend string.
 *  - NOT_A_VAT_SYSTEM: the country has no VAT/GST at all.
 *  - DESTINATION_BASED_SYSTEM: the tax depends on the buyer's state/destination (e.g. US sales tax),
 *    not a fixed rate of the seller's country.
 *  - NO_CATALOG_YET: a genuine VAT/GST country this catalog hasn't sourced rates for yet.
 */
export type VatRatesUnavailableReason = "NOT_A_VAT_SYSTEM" | "DESTINATION_BASED_SYSTEM" | "NO_CATALOG_YET"

export interface VatRatesResponse {
  countryCode: string
  resolvedCountryCode: string
  taxSystemKind: string
  rates: VatRate[]
  unavailableReason?: VatRatesUnavailableReason
}
