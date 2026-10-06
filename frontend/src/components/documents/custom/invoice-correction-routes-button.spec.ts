import { describe, expect, it } from "vitest"

import { creditNoteSeed } from "./invoice-correction-routes-button"

describe("creditNoteSeed", () => {
  it("links the invoice and checks every original line", () => {
    expect(creditNoteSeed("inv-1", [{ id: "a" }, { id: "b" }])).toEqual({
      invoice: "inv-1",
      correctedLines: ["a", "b"],
    })
  })

  it("seeds an empty selection when the invoice has no rows", () => {
    expect(creditNoteSeed("inv-1", [])).toEqual({ invoice: "inv-1", correctedLines: [] })
  })
})
