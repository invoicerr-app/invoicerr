import { useApiQuery } from "./use-api-query"

export interface IdentifierRequirement {
    scheme: string
    label: string
    appliesTo: "COMPANY" | "INDIVIDUAL" | "BOTH"
    required: boolean
    pattern?: string
    helpText?: string
}

export function useRequiredIdentifiers(countryCode: string | undefined | null, partyType: "COMPANY" | "INDIVIDUAL") {
    const url = countryCode
        ? `/api/compliance/required-fields?countryCode=${encodeURIComponent(countryCode)}&partyType=${partyType}`
        : null

    return useApiQuery<IdentifierRequirement[]>(
        ["required-identifiers", countryCode, partyType],
        url!,
        { enabled: !!url },
    )
}
