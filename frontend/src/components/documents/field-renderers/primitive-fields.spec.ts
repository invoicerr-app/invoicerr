import { describe, expect, it } from "vitest"

import type { DocumentFieldDescriptor } from "@/components/documents/types"

import { legacyOptionLabels } from "./primitive-fields"

/** Same shape `vat-rates/registry.ts#vatRateFieldOptions` sends: `options`/`legacyOptions` built
 *  together, same length and order, so index i names the same rate in both. */
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

describe("legacyOptionLabels", () => {
  it("pairs each legacy bare-percentage value with the CURRENT catalog's label at the same index", () => {
    expect(legacyOptionLabels(vatRateField)).toEqual([
      { value: "20", label: "20% — Taux normal" },
      { value: "10", label: "10% — Taux intermédiaire" },
    ])
  })

  it("returns nothing for a field with no legacyOptions at all", () => {
    const plainSelect: DocumentFieldDescriptor = { key: "category", kind: "select", label: "Category" }
    expect(legacyOptionLabels(plainSelect)).toEqual([])
  })

  it("drops a legacy entry whose index has no current option left (catalog shrank)", () => {
    const shrunkField: DocumentFieldDescriptor = {
      ...vatRateField,
      options: [{ value: "fr-standard", label: "20% — Taux normal" }],
    }
    expect(legacyOptionLabels(shrunkField)).toEqual([{ value: "20", label: "20% — Taux normal" }])
  })
})
