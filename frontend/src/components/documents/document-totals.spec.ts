import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import { computeDocumentTotals } from "./document-totals"
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
})
