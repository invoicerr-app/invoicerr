import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import {
  commonLineDescriptions,
  computeCommonLineTotals,
  computeDocumentOptionTotals,
  computeDocumentTotals,
} from "./document-totals"
import type { DocumentTypeDescriptor } from "./types"

/** Minimal line-shaped descriptor — same fixture shape as list-amount.spec.ts. */
function descriptor(fields: DocumentTypeDescriptor["fields"]): DocumentTypeDescriptor {
  return { id: "t", label: "T", fields, actions: [] } as unknown as DocumentTypeDescriptor
}

const withLines = descriptor([
  { key: "currency", kind: "select", label: "Currency", options: [] },
  {
    key: "lines",
    kind: "array",
    label: "Lines",
    fields: [
      { key: "quantity", kind: "number", label: "Qty" },
      { key: "unitPrice", kind: "money", label: "Unit price", currencyField: "currency" },
      { key: "vatRate", kind: "select", label: "VAT", options: [{ value: "20", label: "20%" }] },
    ],
  },
] as unknown as DocumentTypeDescriptor["fields"])

/** Issue #373 ("quotes with options") - a quote-shaped descriptor: same line shape as `withLines`,
 *  plus the `option` subfield the quote descriptor alone declares. */
const withOptions = descriptor([
  { key: "currency", kind: "select", label: "Currency", options: [] },
  {
    key: "lines",
    kind: "array",
    label: "Lines",
    fields: [
      { key: "quantity", kind: "number", label: "Qty" },
      { key: "unitPrice", kind: "money", label: "Unit price", currencyField: "currency" },
      { key: "vatRate", kind: "select", label: "VAT", options: [{ value: "20", label: "20%" }] },
      { key: "option", kind: "text", label: "Option" },
    ],
  },
] as unknown as DocumentTypeDescriptor["fields"])

/** Same shape as `withOptions`, plus the line's own `description` subfield - what
 *  `commonLineDescriptions` reads (the real quote descriptor's own "Designation" field). */
const withOptionsAndDescription = descriptor([
  { key: "currency", kind: "select", label: "Currency", options: [] },
  {
    key: "lines",
    kind: "array",
    label: "Lines",
    fields: [
      { key: "description", kind: "text", label: "Designation" },
      { key: "quantity", kind: "number", label: "Qty" },
      { key: "unitPrice", kind: "money", label: "Unit price", currencyField: "currency" },
      { key: "vatRate", kind: "select", label: "VAT", options: [{ value: "20", label: "20%" }] },
      { key: "option", kind: "text", label: "Option" },
    ],
  },
] as unknown as DocumentTypeDescriptor["fields"])

/** A purchase-order-shaped descriptor: lines carry no VAT-like subfield AT ALL — a STRUCTURAL fact
 *  about the type (it isn't a tax document), never a per-row data problem. */
const purchaseOrderShaped = descriptor([
  { key: "currency", kind: "select", label: "Currency", options: [] },
  {
    key: "lines",
    kind: "array",
    label: "Lines",
    fields: [
      { key: "description", kind: "text", label: "Description" },
      { key: "quantity", kind: "number", label: "Qty" },
      { key: "unitPrice", kind: "money", label: "Unit price", currencyField: "currency" },
    ],
  },
] as unknown as DocumentTypeDescriptor["fields"])

/** A line shape whose FIRST `select` subfield is a non-numeric, non-"vat"-named dropdown ("quality"),
 *  with the real VAT-rate field declared after it. */
const withNonNumericSelectBeforeVat = descriptor([
  { key: "currency", kind: "select", label: "Currency", options: [] },
  {
    key: "lines",
    kind: "array",
    label: "Lines",
    fields: [
      { key: "quantity", kind: "number", label: "Qty" },
      { key: "unitPrice", kind: "money", label: "Unit price", currencyField: "currency" },
      {
        key: "quality",
        kind: "select",
        label: "Quality",
        options: [
          { value: "good", label: "Good" },
          { value: "bad", label: "Bad" },
        ],
      },
      { key: "vatRate", kind: "select", label: "VAT", options: [{ value: "20", label: "20%" }] },
    ],
  },
] as unknown as DocumentTypeDescriptor["fields"])

/** A line shape whose `vatRate` field carries catalog ids as `value` (Italy's 0% "esente" vs 22%
 *  "standard") plus the `legacyOptions` sibling the backend sends alongside them — the shape every
 *  company descriptor with a known VAT-rate catalog now sends (vat-rates/registry.ts). */
const withCatalogIdVatRate = descriptor([
  { key: "currency", kind: "select", label: "Currency", options: [] },
  {
    key: "lines",
    kind: "array",
    label: "Lines",
    fields: [
      { key: "quantity", kind: "number", label: "Qty" },
      { key: "unitPrice", kind: "money", label: "Unit price", currencyField: "currency" },
      {
        key: "vatRate",
        kind: "select",
        label: "VAT",
        options: [
          { value: "it-esente", label: "0% — Esente" },
          { value: "it-standard", label: "22% — Ordinaria" },
        ],
        legacyOptions: [
          { value: "0", label: "0% — Esente" },
          { value: "22", label: "22% — Ordinaria" },
        ],
      },
    ],
  },
] as unknown as DocumentTypeDescriptor["fields"])

describe("computeDocumentTotals", () => {
  it("returns zeroed totals rather than null when a real line sums to net 0 (fully discounted)", () => {
    const totals = computeDocumentTotals(withLines, {
      currency: "EUR",
      lines: [{ quantity: 1, unitPrice: 0, vatRate: "20" }],
    })
    expect(totals).not.toBeNull()
    expect(totals?.netMinor).toBe(0)
    expect(totals?.grossMinor).toBe(0)
  })

  it("still returns null when there are no line rows at all", () => {
    expect(computeDocumentTotals(withLines, { currency: "EUR", lines: [] })).toBeNull()
  })

  it("does not warn about an unusable VAT rate on a line shape with no VAT field at all (e.g. a purchase order)", () => {
    const totals = computeDocumentTotals(purchaseOrderShaped, {
      currency: "EUR",
      lines: [
        { description: "A", quantity: 1, unitPrice: 10 },
        { description: "B", quantity: 2, unitPrice: 20 },
      ],
    })
    expect(totals?.warnings).toEqual([])
    expect(totals?.netMinor).toBe(5000)
    expect(totals?.grossMinor).toBe(5000)
  })

  it("still warns when a VAT field DOES exist on the shape but this row's own value is unusable", () => {
    const totals = computeDocumentTotals(withLines, {
      currency: "EUR",
      lines: [{ quantity: 1, unitPrice: 10, vatRate: "" }],
    })
    expect(totals?.warnings).toEqual(["line 1 has no usable VAT rate — counted in net only"])
  })

  it("translates that same warning through the given TFunction instead of the raw English fallback", () => {
    const fakeT = ((key: string, options?: Record<string, unknown>) =>
      `${key}:${options?.line}`) as unknown as TFunction
    const totals = computeDocumentTotals(
      withLines,
      { currency: "EUR", lines: [{ quantity: 1, unitPrice: 10, vatRate: "" }] },
      fakeT,
    )
    expect(totals?.warnings).toEqual(["documents.totals.warnings.noUsableVatRate:1"])
  })

  it("does not mistake a non-numeric, non-'vat'-named select for the VAT-rate field", () => {
    const totals = computeDocumentTotals(withNonNumericSelectBeforeVat, {
      currency: "EUR",
      lines: [{ quantity: 1, unitPrice: 100, quality: "good", vatRate: "20" }],
    })
    // Old detection (any select with options.length > 0) would have picked "quality" first, read
    // "good" as a VAT rate, warned, and shown 0 VAT for a line the backend taxes at 20%.
    expect(totals?.warnings).toEqual([])
    expect(totals?.netMinor).toBe(10000)
    expect(totals?.vatMinor).toBe(2000)
    expect(totals?.grossMinor).toBe(12000)
  })

  it("resolves a catalog-id VAT rate to its real percentage instead of treating it as unusable", () => {
    const totals = computeDocumentTotals(withCatalogIdVatRate, {
      currency: "EUR",
      lines: [{ quantity: 1, unitPrice: 100, vatRate: "it-standard" }],
    })
    expect(totals?.warnings).toEqual([])
    expect(totals?.netMinor).toBe(10000)
    expect(totals?.vatMinor).toBe(2200)
    expect(totals?.grossMinor).toBe(12200)
  })

  it("tells apart two 0% catalog ids on the same line shape instead of collapsing them", () => {
    const totals = computeDocumentTotals(withCatalogIdVatRate, {
      currency: "EUR",
      lines: [{ quantity: 1, unitPrice: 100, vatRate: "it-esente" }],
    })
    expect(totals?.warnings).toEqual([])
    expect(totals?.vatMinor).toBe(0)
    expect(totals?.grossMinor).toBe(10000)
  })

  it("still resolves a bare percentage a document saved before catalog ids existed", () => {
    const totals = computeDocumentTotals(withCatalogIdVatRate, {
      currency: "EUR",
      lines: [{ quantity: 1, unitPrice: 100, vatRate: "22" }],
    })
    expect(totals?.warnings).toEqual([])
    expect(totals?.vatMinor).toBe(2200)
  })

  it("warns, rather than silently charging 0%, for a VAT-rate id this company's catalog no longer lists", () => {
    const totals = computeDocumentTotals(withCatalogIdVatRate, {
      currency: "EUR",
      lines: [{ quantity: 1, unitPrice: 100, vatRate: "de-standard" }],
    })
    expect(totals?.warnings).toEqual(["line 1 has no usable VAT rate — counted in net only"])
    expect(totals?.vatMinor).toBe(0)
  })

  describe("showVat (the company's own `exemptVat` toggle)", () => {
    it("is true by default, a positive-rate line, no company info passed", () => {
      const totals = computeDocumentTotals(withLines, {
        currency: "EUR",
        lines: [{ quantity: 1, unitPrice: 100, vatRate: "20" }],
      })
      expect(totals?.showVat).toBe(true)
    })

    it("is false once the 5th arg (the company's `exemptVat`) is true, even with a positive line rate on file", () => {
      const totals = computeDocumentTotals(
        withLines,
        { currency: "EUR", lines: [{ quantity: 1, unitPrice: 100, vatRate: "20" }] },
        undefined,
        true,
      )
      expect(totals?.showVat).toBe(false)
      // Still the honest, not-yet-resolved amount — only the display flag changes.
      expect(totals?.vatMinor).toBe(2000)
    })
  })
})

describe("computeDocumentOptionTotals (issue #373, quotes with options)", () => {
  it("is null for a descriptor whose line shape has no `option` subfield at all", () => {
    expect(
      computeDocumentOptionTotals(withLines, {
        currency: "EUR",
        lines: [{ quantity: 1, unitPrice: 100, vatRate: "20" }],
      }),
    ).toBeNull()
  })

  it("is null for fewer than two distinct options - the caller falls back to the single total", () => {
    expect(computeDocumentOptionTotals(withOptions, { currency: "EUR", lines: [] })).toBeNull()
    expect(
      computeDocumentOptionTotals(withOptions, {
        currency: "EUR",
        lines: [{ quantity: 1, unitPrice: 100, vatRate: "20" }],
      }),
    ).toBeNull()
    expect(
      computeDocumentOptionTotals(withOptions, {
        currency: "EUR",
        lines: [
          { quantity: 1, unitPrice: 100, vatRate: "20", option: "Basic" },
          { quantity: 1, unitPrice: 50, vatRate: "20", option: "Basic" },
        ],
      }),
    ).toBeNull()
  })

  it("computes each option's OWN totals from only its own lines, never a global sum", () => {
    const result = computeDocumentOptionTotals(withOptions, {
      currency: "EUR",
      lines: [
        { quantity: 1, unitPrice: 100, vatRate: "20", option: "Basic" },
        { quantity: 1, unitPrice: 100, vatRate: "20", option: "Premium" },
        { quantity: 1, unitPrice: 200, vatRate: "20", option: "Premium" },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.map((r) => r.option)).toEqual(["Basic", "Premium"])
    expect(result!.find((r) => r.option === "Basic")!.totals.grossMinor).toBe(12000)
    expect(result!.find((r) => r.option === "Premium")!.totals.grossMinor).toBe(36000)
  })

  it("counts a line with NO `option` in EVERY option's own total - never dropped, never orphaned", () => {
    const result = computeDocumentOptionTotals(withOptions, {
      currency: "EUR",
      lines: [
        { quantity: 1, unitPrice: 100, vatRate: "20", option: "Basic" },
        { quantity: 1, unitPrice: 50, vatRate: "20" }, // no `option` at all
        { quantity: 1, unitPrice: 300, vatRate: "20", option: "Premium" },
      ],
    })
    expect(result).not.toBeNull()
    // 100 (Basic) + 50 (common) = 150 net -> 180 gross @ 20%.
    expect(result!.find((r) => r.option === "Basic")!.totals.grossMinor).toBe(18000)
    // 50 (common) + 300 (Premium) = 350 net -> 420 gross @ 20%.
    expect(result!.find((r) => r.option === "Premium")!.totals.grossMinor).toBe(42000)
  })
})

describe("computeCommonLineTotals (issue #373 follow-up, common lines)", () => {
  it("is null for fewer than two options, or when every line IS tagged", () => {
    expect(
      computeCommonLineTotals(withOptions, { currency: "EUR", lines: [{ quantity: 1, unitPrice: 100 }] }),
    ).toBeNull()
    expect(
      computeCommonLineTotals(withOptions, {
        currency: "EUR",
        lines: [
          { quantity: 1, unitPrice: 100, option: "Basic" },
          { quantity: 1, unitPrice: 200, option: "Premium" },
        ],
      }),
    ).toBeNull()
  })

  it("computes the common lines' OWN informational total, separate from any option's", () => {
    const totals = computeCommonLineTotals(withOptions, {
      currency: "EUR",
      lines: [
        { quantity: 1, unitPrice: 100, vatRate: "20", option: "Basic" },
        { quantity: 1, unitPrice: 50, vatRate: "20" },
        { quantity: 1, unitPrice: 300, vatRate: "20", option: "Premium" },
      ],
    })
    expect(totals).not.toBeNull()
    expect(totals!.netMinor).toBe(5000)
    expect(totals!.grossMinor).toBe(6000)
  })
})

// Orchestrator review follow-up ("no meaningless common total") - `DocumentTotals`'s own common-lines
// block now lists these DESCRIPTIONS instead of `computeCommonLineTotals`'s figure; same null/empty
// rules as that sibling function (this test suite deliberately mirrors its own describe block above).
describe("commonLineDescriptions (orchestrator review follow-up, no meaningless common total)", () => {
  it("is null for fewer than two options, or when every line IS tagged", () => {
    expect(
      commonLineDescriptions(withOptionsAndDescription, {
        currency: "EUR",
        lines: [{ description: "Solo line", quantity: 1, unitPrice: 100 }],
      }),
    ).toBeNull()
    expect(
      commonLineDescriptions(withOptionsAndDescription, {
        currency: "EUR",
        lines: [
          { description: "Basic package", quantity: 1, unitPrice: 100, option: "Basic" },
          { description: "Premium package", quantity: 1, unitPrice: 200, option: "Premium" },
        ],
      }),
    ).toBeNull()
  })

  it("returns each common (untagged) line's own designation, in order, never a tagged one", () => {
    const descriptions = commonLineDescriptions(withOptionsAndDescription, {
      currency: "EUR",
      lines: [
        { description: "Setup fee", quantity: 1, unitPrice: 50, vatRate: "20" },
        { description: "Basic package", quantity: 1, unitPrice: 100, vatRate: "20", option: "Basic" },
        { description: "Onboarding", quantity: 1, unitPrice: 25, vatRate: "20" },
        { description: "Premium package", quantity: 1, unitPrice: 300, vatRate: "20", option: "Premium" },
      ],
    })
    expect(descriptions).toEqual(["Setup fee", "Onboarding"])
  })
})
