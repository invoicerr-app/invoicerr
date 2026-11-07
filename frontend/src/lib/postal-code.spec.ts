import { describe, expect, it } from "vitest"

import { isValidPostalCode } from "./postal-code"

describe("isValidPostalCode", () => {
  it("accepts a lowercase UK or NL code — the field is never uppercased on input", () => {
    expect(isValidPostalCode("sw1a 1aa")).toBe(true)
    expect(isValidPostalCode("1234 ab")).toBe(true)
  })

  it("accepts blank — a country with no postal code system must be able to leave it empty", () => {
    expect(isValidPostalCode("")).toBe(true)
    expect(isValidPostalCode(null)).toBe(true)
    expect(isValidPostalCode(undefined)).toBe(true)
  })

  it("still rejects something that plainly isn't a postal code", () => {
    expect(isValidPostalCode("a")).toBe(false)
    expect(isValidPostalCode("!!!!!")).toBe(false)
  })
})
