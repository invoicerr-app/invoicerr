import type { FieldValues, UseFormReturn } from "react-hook-form"

import type { AddressSuggestion } from "@/hooks/use-address-autocomplete"
import { countryCodes } from "@/lib/constants/countries"

/**
 * Fills the address fields the client form (`clients/_components/client-upsert.tsx`) and the
 * company settings form (`settings/_components/company.settings.tsx`) both already declare -
 * `address` / `postalCode` / `city` / `country` / `countryCode` - from ONE picked Photon suggestion
 * (#197). One shared function so the two forms can never fill these fields differently.
 *
 * Photon separates `street` from `houseNumber`; both forms carry a single free-text address line
 * (see `AddressStep`'s own header on the client form), so the two are joined with the house number
 * FIRST - "12 Rue de la Paix", the convention already used everywhere a fixture or a real user types
 * a French/German/Italian/Portuguese address in this codebase.
 *
 * `country`/`countryCode` are set ONLY when Photon's ISO code is one this app actually recognizes
 * (`countryCodes` below - effectively every UN member state, see that file's own header). A code
 * outside that list (a disputed territory or a dependency Photon still names on its own) is left
 * alone: `CountrySelect` has nothing to render for a code it doesn't know, and setting `countryCode`
 * without a matching `country` label would desync the per-country catalogs (required identifiers,
 * VAT rates, currency default) from what the screen shows. The address/postalCode/city lines are
 * filled regardless - the country picker is the one thing a user then still has to confirm by hand.
 */
export function applyAddressSuggestion<T extends FieldValues>(
  form: UseFormReturn<T>,
  suggestion: AddressSuggestion,
  language: string,
): void {
  const street = [suggestion.houseNumber, suggestion.street].filter(Boolean).join(" ").trim()
  if (street) {
    form.setValue("address" as never, street as never, { shouldDirty: true, shouldValidate: true })
  }
  if (suggestion.postalCode) {
    form.setValue("postalCode" as never, suggestion.postalCode as never, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }
  if (suggestion.city) {
    form.setValue("city" as never, suggestion.city as never, { shouldDirty: true, shouldValidate: true })
  }

  const code = suggestion.countryCode?.toUpperCase()
  if (code && countryCodes.includes(code)) {
    const displayNames = new Intl.DisplayNames([language, "en"], { type: "region" })
    form.setValue("countryCode" as never, code as never, { shouldDirty: true })
    form.setValue("country" as never, (displayNames.of(code) ?? suggestion.country ?? code) as never, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }
}
