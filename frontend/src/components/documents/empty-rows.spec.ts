import { describe, expect, it } from "vitest"

import { dropEmptyRows } from "./empty-rows"
import type { DocumentFieldDescriptor } from "./types"

/** The invoice's own line shape (invoice.descriptor.ts, backend) — description/quantity/unit/
 *  unitPrice/vatRate, all required there. Only `description`/`quantity`/`unitPrice` matter for what
 *  this file tests (whether a row survives the filter), so the fixture keeps just those three. */
const lineFields: DocumentFieldDescriptor[] = [
  { key: "description", kind: "text", label: "Designation", required: true },
  { key: "quantity", kind: "number", label: "Quantity", required: true, min: 0 },
  { key: "unitPrice", kind: "money", label: "Unit price", required: true, min: 0 },
]

const fields: DocumentFieldDescriptor[] = [
  { key: "lines", kind: "array", label: "Lines", required: true, min: 1, fields: lineFields },
]

describe("dropEmptyRows — issue #365, 'empty line items should not survive a save'", () => {
  it("drops a row whose every subfield is undefined — the '+ Add line' default", () => {
    const data = {
      lines: [
        { description: "Widget", quantity: 2, unitPrice: 9.9 },
        { description: undefined, quantity: undefined, unitPrice: undefined },
      ],
    }
    expect(dropEmptyRows(fields, data).lines).toEqual([
      { description: "Widget", quantity: 2, unitPrice: 9.9 },
    ])
  })

  it("drops a row whose text fields are '' and whose number fields are 0 — typed then cleared", () => {
    const data = { lines: [{ description: "", quantity: 0, unitPrice: 0 }] }
    expect(dropEmptyRows(fields, data).lines).toEqual([])
  })

  it("keeps a row that carries only a price — half-filled on purpose, not thrown away", () => {
    const data = { lines: [{ description: undefined, quantity: undefined, unitPrice: 12 }] }
    expect(dropEmptyRows(fields, data).lines).toEqual([
      { description: undefined, quantity: undefined, unitPrice: 12 },
    ])
  })

  it("keeps a row that carries only a description — the mirror case", () => {
    const data = { lines: [{ description: "To be priced later", quantity: undefined, unitPrice: undefined }] }
    expect(dropEmptyRows(fields, data).lines).toEqual([
      { description: "To be priced later", quantity: undefined, unitPrice: undefined },
    ])
  })

  it("a document left with nothing but empty rows ends up with an empty array", () => {
    const data = {
      lines: [
        { description: undefined, quantity: undefined, unitPrice: undefined },
        { description: "", quantity: 0, unitPrice: 0 },
      ],
    }
    expect(dropEmptyRows(fields, data).lines).toEqual([])
  })

  it("never mutates the original object or array", () => {
    const original = {
      lines: [
        { description: "Widget", quantity: 1, unitPrice: 5 },
        { description: undefined, quantity: undefined, unitPrice: undefined },
      ],
    }
    const cleaned = dropEmptyRows(fields, original)
    expect(original.lines).toHaveLength(2)
    expect(cleaned).not.toBe(original)
    expect(cleaned.lines).not.toBe(original.lines)
  })

  it("leaves a non-object row alone — not this function's shape to judge", () => {
    expect(dropEmptyRows(fields, { lines: ["not-an-object", 42, null] }).lines).toEqual([
      "not-an-object",
      42,
      null,
    ])
  })

  it("a field that is not 'array', or an 'array' field with no declared row fields, is left untouched", () => {
    const noRowShape: DocumentFieldDescriptor[] = [{ key: "lines", kind: "array", label: "Lines" }]
    expect(dropEmptyRows(noRowShape, { lines: [{}] })).toEqual({ lines: [{}] })
    expect(dropEmptyRows([{ key: "notes", kind: "text", label: "Notes" }], { notes: "" })).toEqual({
      notes: "",
    })
  })
})
