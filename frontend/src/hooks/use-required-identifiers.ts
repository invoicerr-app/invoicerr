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

/**
 * A `VAT`-scheme identifier is a requirement of the EN 16931 invoice FORMAT itself — the seller VAT
 * identifier (BT-31, `cac:PartyTaxScheme`) is what a standard-rated or intra-Community line needs to
 * export validly (BR-S-02/BR-IC-02), regardless of which country the seller is in. That is a
 * different concern from `country-identifiers`, which exists to express what a country demands IN
 * ADDITION (SIRET, Leitweg-ID, Codice Destinatario…). Gating the VAT field on that per-country catalog
 * was a layering mistake: a country with no `country-identifiers/data/<cc>.json` file (e.g. Italy,
 * Poland) still needs to let its companies record a VAT number, or every one of their invoices is
 * unexportable the moment a line is standard-rated or crosses a border.
 *
 * This appends a synthetic, generic VAT requirement ONLY when the catalog is silent on the `VAT`
 * scheme for this country — France, Germany and Portugal already declare their own (with a localized
 * label/pattern/help text), and this must never duplicate those. `required` is always `false`: the
 * backend never conditions company creation or editing on having a VAT number (a company below the
 * VAT-registration threshold, or in a country the format's own VAT concept doesn't apply to, must
 * still be able to complete onboarding and save settings), exactly like every VAT scheme this catalog
 * itself already declares (see fr.json/de.json/pt.json's own `required: false` VAT entries — none of
 * them make it mandatory either, for the same reason).
 */
export function withVatIdentifier(
  requirements: IdentifierRequirement[] | undefined,
  label: string,
  helpText: string,
): IdentifierRequirement[] | undefined {
  if (!requirements) return requirements
  if (requirements.some((r) => r.scheme === "VAT")) return requirements
  return [...requirements, { scheme: "VAT", label, appliesTo: "COMPANY", required: false, helpText }]
}
