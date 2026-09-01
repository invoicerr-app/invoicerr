import { useApiQuery } from "./use-api-query"

export interface RequiredClientIdentifier {
  scheme: string
  label: string
  why: string
}

export interface RequiredDocumentField {
  field: string
  label: string
  why: string
  required: boolean
}

// Mirrors backend/src/modules/documents/b2g-routing/b2g-routing.ts's B2gRoutingRuleView. `null`
// (not an empty object) means no B2G rule is declared for this country YET — see this hook's own
// caller (client-upsert.tsx) for why that is shown as HELP, never a block: a GOVERNMENT client from
// an uncovered country can still be saved, the actual refusal only happens when an invoice to it is
// sent (documents/actions/invoice-actions.ts's own B2G precedence).
export interface B2gRoutingRule {
  countryCode: string
  transportId: string
  formatSyntax: string
  requiredClientIdentifiers: RequiredClientIdentifier[]
  requiredDocumentFields: RequiredDocumentField[]
  provenanceDescription: string
}

/**
 * The B2G routing rule for a country, or `null` — asked for ONLY when a client is marked GOVERNMENT
 * (see `client-upsert.tsx`'s own `enabled` gate below): a BUSINESS client never needs this, so this
 * hook is disabled unless the caller explicitly says it's relevant.
 */
export function useB2gRoutingRule(countryCode: string | undefined | null, enabled: boolean) {
  const url =
    enabled && countryCode
      ? `/api/documents/b2g-routing?countryCode=${encodeURIComponent(countryCode)}`
      : null

  return useApiQuery<B2gRoutingRule | null>(["b2g-routing", countryCode], url!, {
    enabled: !!url,
  })
}
