import { describe, expect, it } from "vitest"

import type { CompanyProfileAttribute } from "@/types"

import { isProfileAttributeAsked, profileValuesForDisplay } from "./company-profile-values"

const vatRegime: CompanyProfileAttribute = {
  key: "vatRegime",
  label: "VAT regime",
  values: [
    { value: "FRANCHISE", label: "Exempt" },
    { value: "NORMAL", label: "Normal" },
  ],
  derived: { source: "exemptVat", whenTrue: "FRANCHISE", whenFalse: "NORMAL" },
}

const vatDebitsOption: CompanyProfileAttribute = {
  key: "vatDebitsOption",
  label: "Option for VAT on debits",
  values: [
    { value: "EXERCISED", label: "Exercised" },
    { value: "NOT_EXERCISED", label: "Not exercised" },
  ],
  askedWhen: { vatRegime: ["NORMAL"] },
}

const sizeCategory: CompanyProfileAttribute = {
  key: "sizeCategory",
  label: "Size category",
  values: [{ value: "SME", label: "SME" }],
}

const attributes = [sizeCategory, vatRegime, vatDebitsOption]

describe("company profile values on the settings screen", () => {
  it("derives the VAT regime from the live switch, not from the stored values", () => {
    const stored = { vatRegime: "NORMAL" }

    expect(profileValuesForDisplay(attributes, stored, {}, true).vatRegime).toBe("FRANCHISE")
    expect(profileValuesForDisplay(attributes, stored, {}, false).vatRegime).toBe("NORMAL")
  })

  it("hides the debits option as soon as the switch turns the derived regime to the exempt scheme", () => {
    const values = profileValuesForDisplay(attributes, { vatDebitsOption: "EXERCISED" }, {}, true)

    expect(isProfileAttributeAsked(vatDebitsOption, values)).toBe(false)
  })

  it("keeps the debits option while the live switch leaves the normal regime in force", () => {
    const values = profileValuesForDisplay(attributes, {}, {}, false)

    expect(isProfileAttributeAsked(vatDebitsOption, values)).toBe(true)
  })

  it("keeps an undeclared dependency's question visible", () => {
    expect(isProfileAttributeAsked(vatDebitsOption, {})).toBe(true)
  })
})
