import { describe, expect, it } from "vitest"

import type { DocumentFieldDescriptor } from "@/components/documents/types"

import { coercePrefillValue } from "./array-field"

/** Mirrors what `vat-rates/registry.ts#vatRateFieldOptions` actually sends for France: same length,
 *  same order — `options`' catalog id at each index lines up with `legacyOptions`' bare percentage at
 *  that same index. */
const vatRateField: DocumentFieldDescriptor = {
  key: "vatRate",
  kind: "select",
  label: "VAT rate",
  options: [
    { value: "fr-standard", label: "20% — Taux normal" },
    { value: "fr-intermediate", label: "10% — Taux intermédiaire" },
  ],
  legacyOptions: [
    { value: "20", label: "20% — Taux normal" },
    { value: "10", label: "10% — Taux intermédiaire" },
  ],
}

const twoZeroRatesField: DocumentFieldDescriptor = {
  key: "vatRate",
  kind: "select",
  label: "VAT rate",
  options: [
    { value: "it-esente", label: "0% — Esente" },
    { value: "it-non-imponibile", label: "0% — Non imponibile" },
  ],
  legacyOptions: [
    { value: "0", label: "0% — Esente" },
    { value: "0", label: "0% — Non imponibile" },
  ],
}

describe("coercePrefillValue", () => {
  it("resolves an Article's bare vatRate number to the matching catalog id", () => {
    expect(coercePrefillValue(vatRateField, 20)).toBe("fr-standard")
  })

  it("compares numerically — a stringified '20.0' still matches legacyOptions' '20'", () => {
    expect(coercePrefillValue(vatRateField, "20.0")).toBe("fr-standard")
  })

  it("picks the first catalog id, in catalog order, when several share one percentage", () => {
    expect(coercePrefillValue(twoZeroRatesField, 0)).toBe("it-esente")
  })

  it("falls back to a plain string for a select field with no legacyOptions at all", () => {
    const plainSelect: DocumentFieldDescriptor = { key: "category", kind: "select", label: "Category" }
    expect(coercePrefillValue(plainSelect, "misc")).toBe("misc")
  })

  it("falls back to a plain string when the value matches no legacyOptions entry", () => {
    expect(coercePrefillValue(vatRateField, 19.6)).toBe("19.6")
  })

  it("copies a non-select target's value verbatim (a 'money'/'number' field wants a real number)", () => {
    const moneyField: DocumentFieldDescriptor = { key: "unitPrice", kind: "money", label: "Unit price" }
    expect(coercePrefillValue(moneyField, 800)).toBe(800)
  })

  it("passes null/undefined through unchanged regardless of target kind", () => {
    expect(coercePrefillValue(vatRateField, undefined)).toBeUndefined()
    expect(coercePrefillValue(vatRateField, null)).toBeNull()
  })

  it("copies the value verbatim when the row has no subfield for this map key at all", () => {
    expect(coercePrefillValue(undefined, 800)).toBe(800)
  })
})
