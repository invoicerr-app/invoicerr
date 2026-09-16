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
})
