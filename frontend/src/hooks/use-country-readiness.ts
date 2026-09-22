import { useApiQuery } from "./use-api-query"

// Mirrors backend/src/modules/country-readiness/country-readiness.service.ts's
// `CountryReadiness` — a country is "complete" only when it has a `data/xx.json` file in every one
// of the 5 CŒUR mechanisms (country-policy, vat-rates, tax-systems, correction-routes,
// country-identifiers); `mentions`/`content-requirements` are FR-specific extras and never appear
// here. `present`/`missing` carry the mechanism ids, not translated labels — the caller is
// responsible for turning an id into user-facing text (see country-readiness-alert.tsx).
export interface CountryReadiness {
  countryCode: string
  complete: boolean
  present: string[]
  missing: string[]
}

// Deliberately NOT scoped to the active company (there may not be one yet — this is read at
// company-creation time, both in the onboarding wizard and in company settings) — see the backend
// controller's own header for why it carries no `@ActiveCompany()`.
export function useCountryReadiness(countryCode: string | undefined | null) {
  const url = countryCode ? `/api/country-readiness/${encodeURIComponent(countryCode)}` : null

  return useApiQuery<CountryReadiness>(["country-readiness", countryCode], url!, { enabled: !!url })
}
