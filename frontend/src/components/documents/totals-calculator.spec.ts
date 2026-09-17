import { describe, expect, it } from "vitest"

import { resolveVatRatePercent } from "./totals-calculator"

/**
 * `options`/`legacyOptions` here mirror what `vat-rates/registry.ts#vatRateFieldOptions` actually
 * sends: same length, same order, built from the same rates array — index 0 is Italy's "esente" (0%,
 * no deduction right), index 1 its "non imponibile" (also 0%, deduction preserved) — the exact
 * same-percentage-different-regime pair the catalog id exists to keep apart.
 */
const itVatOptions = {
  options: [
    { value: "it-esente", label: "0% — Esente" },
    { value: "it-non-imponibile", label: "0% — Non imponibile" },
    { value: "it-standard", label: "22% — Ordinaria" },
  ],
  legacyOptions: [
    { value: "0", label: "0% — Esente" },
    { value: "0", label: "0% — Non imponibile" },
    { value: "22", label: "22% — Ordinaria" },
  ],
}

describe("resolveVatRatePercent", () => {
  it("resolves a catalog id to its percentage via the matching legacyOptions index", () => {
    expect(resolveVatRatePercent("it-standard", itVatOptions)).toBe(22)
  })

  it("tells apart two same-percentage regimes sharing one bare rate (both 0%, different ids)", () => {
    expect(resolveVatRatePercent("it-esente", itVatOptions)).toBe(0)
    expect(resolveVatRatePercent("it-non-imponibile", itVatOptions)).toBe(0)
  })

  it("still resolves a bare percentage persisted before catalog ids existed", () => {
    expect(resolveVatRatePercent("20", itVatOptions)).toBe(20)
    expect(resolveVatRatePercent("20", undefined)).toBe(20)
  })

  it("resolves a hand-typed rate on a field with no catalog at all (allowCustomValue, options empty)", () => {
    expect(resolveVatRatePercent("17.5", { options: [], legacyOptions: [] })).toBe(17.5)
  })

  it("returns null for an id no longer in this company's catalog, same as genuinely unparseable text", () => {
    expect(resolveVatRatePercent("de-standard", itVatOptions)).toBeNull()
    expect(resolveVatRatePercent("standard", itVatOptions)).toBeNull()
  })
})
