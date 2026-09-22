import { describe, expect, it } from "vitest"

import { computeTotals, resolveVatRatePercent } from "./totals-calculator"

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

// `showVat` — mirrors the backend's own `compute-totals.ts#DocumentTotals.showVat` exactly (same
// rule, this file's own header commits to never diverging on it).
describe("computeTotals — showVat", () => {
  it("is true for an ordinary line with a positive VAT rate", () => {
    const totals = computeTotals(
      [{ quantity: 1, unitPrice: 100, vatRate: "20" }],
      "EUR",
      "unitPrice",
      "quantity",
      "vatRate",
      undefined,
    )
    expect(totals.showVat).toBe(true)
  })

  it("stays true for a MIXED document — a 0% line next to a real 20% one", () => {
    const totals = computeTotals(
      [
        { quantity: 1, unitPrice: 100, vatRate: "0" },
        { quantity: 1, unitPrice: 100, vatRate: "20" },
      ],
      "EUR",
      "unitPrice",
      "quantity",
      "vatRate",
      undefined,
    )
    expect(totals.showVat).toBe(true)
  })

  it("is false when every line resolves to exactly 0% — no `sellerExemptVat` needed", () => {
    const totals = computeTotals(
      [{ quantity: 1, unitPrice: 100, vatRate: "0" }],
      "EUR",
      "unitPrice",
      "quantity",
      "vatRate",
      undefined,
    )
    expect(totals.showVat).toBe(false)
  })

  it("is false for a VAT-exempt seller even though the line still carries a stray positive rate — never an arithmetic override", () => {
    const totals = computeTotals(
      [{ quantity: 1, unitPrice: 100, vatRate: "20" }],
      "EUR",
      "unitPrice",
      "quantity",
      "vatRate",
      undefined,
      undefined,
      undefined,
      true, // sellerExemptVat
    )
    expect(totals.showVat).toBe(false)
    // The honest (not-yet-resolved) VAT amount is still computed — only the display flag reacts.
    expect(totals.vatMinor).toBe(2000)
    expect(totals.grossMinor).toBe(12000)
  })
})
