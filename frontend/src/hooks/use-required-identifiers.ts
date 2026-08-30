import { useApiQuery } from "./use-api-query"

export interface IdentifierRequirement {
  scheme: string
  label: string
  appliesTo: "COMPANY" | "INDIVIDUAL" | "BOTH"
  required: boolean
  pattern?: string
  helpText?: string
}

// Mirrors backend/src/modules/documents/country-identifiers/country-identifiers.ts's
// RequiredIdentifiersDecision. `reason` is present, and `requirements` empty, ONLY when the
// country has no identifier-requirements file declared at all — never when the file exists but
// simply has nothing to say for this party type (that empty case carries no reason, and is not an
// error state a form needs to explain).
export interface RequiredIdentifiersResult {
  requirements: IdentifierRequirement[]
  reason?: string
}

export function useRequiredIdentifiers(
  countryCode: string | undefined | null,
  partyType: "COMPANY" | "INDIVIDUAL",
) {
  const url = countryCode
    ? `/api/documents/required-identifiers?countryCode=${encodeURIComponent(countryCode)}&partyType=${partyType}`
    : null

  return useApiQuery<RequiredIdentifiersResult>(["required-identifiers", countryCode, partyType], url!, {
    enabled: !!url,
  })
}
