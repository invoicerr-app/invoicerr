import { describe, expect, it } from "vitest"

import { resolveRowAmount } from "./list-amount"
import type { DocumentTypeDescriptor } from "./types"

/**
 * The list row's figure comes from two generic readings and nothing else — line rows summed like
 * the totals card, or a top-level money field — so a type that fits neither shows no amount rather
 * than an invented one. Descriptors below are the minimal shapes the two readings look at.
 */
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

describe("resolveRowAmount", () => {
  it("sums line rows into the gross total, in the document's own currency", () => {
    const amount = resolveRowAmount(withLines, {
      currency: "EUR",
      lines: [{ quantity: 2, unitPrice: 100, vatRate: "20" }],
    })
    expect(amount).toEqual({ minor: 24000, currency: "EUR" })
  })

  it("falls back to the first top-level money field when there are no line rows", () => {
    const expense = descriptor([
      { key: "amount", kind: "money", label: "Amount", currencyField: "currency" },
      { key: "currency", kind: "select", label: "Currency", options: [] },
    ] as unknown as DocumentTypeDescriptor["fields"])
    expect(resolveRowAmount(expense, { amount: 12.5, currency: "EUR" })).toEqual({
      minor: 1250,
      currency: "EUR",
      fieldKey: "amount",
    })
  })

  it("shows nothing rather than guessing when neither reading applies", () => {
    expect(resolveRowAmount(withLines, { currency: "EUR", lines: [] })).toBeNull()
    const noMoney = descriptor([
      { key: "title", kind: "text", label: "Title" },
    ] as unknown as DocumentTypeDescriptor["fields"])
    expect(resolveRowAmount(noMoney, { title: "x" })).toBeNull()
  })
})
