import { describe, expect, it } from "vitest"
import { byCodeUnit } from "./compare"

describe("byCodeUnit", () => {
  it("keeps the comparator-less sort order where locale order would differ", () => {
    const values = ["b", "B", "a", "10", "9", "A", "Z"]

    expect([...values].sort(byCodeUnit)).toEqual(["10", "9", "A", "B", "Z", "a", "b"])
  })

  it("returns zero only for identical strings", () => {
    expect(byCodeUnit("ab", "ab")).toBe(0)
    expect(byCodeUnit("ab", "AB")).toBeGreaterThan(0)
    expect(byCodeUnit("AB", "ab")).toBeLessThan(0)
  })
})
