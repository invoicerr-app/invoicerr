import { describe, expect, it } from "vitest"

import { deskSeed, pickDeskFurniture } from "./desk-rng"

describe("pickDeskFurniture", () => {
  it("is deterministic — the same seed always produces the same furniture", () => {
    const a = pickDeskFurniture("company-1:3")
    const b = pickDeskFurniture("company-1:3")
    expect(a).toEqual(b)
  })

  it("different desk numbers on the same company usually differ", () => {
    const results = Array.from({ length: 8 }, (_, i) => pickDeskFurniture(`company-1:${i + 1}`))
    const unique = new Set(results.map((r) => JSON.stringify(r)))
    // Not a strict guarantee (a coincidental collision is possible), but 8 desks all landing on the
    // exact same combination would indicate the seed isn't actually varying the output.
    expect(unique.size).toBeGreaterThan(1)
  })

  it("the same desk NUMBER on two different companies usually differs too — the seed is per-company", () => {
    const a = pickDeskFurniture(deskSeed("company-1", 1))
    const b = pickDeskFurniture(deskSeed("company-2", 1))
    expect(a).not.toEqual(b)
  })

  it("always returns a value from the documented catalog for every trait", () => {
    const result = pickDeskFurniture("company-1:1")
    expect(["single-monitor", "dual-monitor", "laptop", "laptop-and-monitor"]).toContain(result.display)
    expect(["left", "right"]).toContain(result.mouseSide)
    expect(typeof result.hasCup).toBe("boolean")
    expect(typeof result.hasNotepad).toBe("boolean")
  })
})

describe("deskSeed", () => {
  it("combines the company id and desk number", () => {
    expect(deskSeed("acme", 3)).toBe("acme:3")
  })
})
