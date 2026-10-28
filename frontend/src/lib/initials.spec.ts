import { describe, expect, it } from "vitest"

import { initialsOf, tintHueOf } from "./initials"

describe("initialsOf", () => {
  it.each([
    ["Studio Pixel & Fils SARL", "SP"],
    ["Boulangerie Les Trois Meules", "BL"],
    ["Éditions du Petit Phare", "ÉD"],
    ["  camille   vasseur ", "CV"],
    ["Acme", "A"],
    ["3M France", "3F"],
    ["", ""],
  ])("%s gives %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected)
  })

  it("treats a missing name as empty", () => {
    expect(initialsOf(undefined)).toBe("")
    expect(initialsOf(null)).toBe("")
  })
})

describe("tintHueOf", () => {
  it("gives the same hue to the same name, whatever the call", () => {
    expect(tintHueOf("Maison Bellerive SAS")).toBe(tintHueOf("Maison Bellerive SAS"))
  })

  it("lands on a 30 degree step of the wheel", () => {
    for (const name of ["Studio Pixel & Fils SARL", "Ferme du Haut-Perché EARL", "x", ""]) {
      const hue = tintHueOf(name)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(hue % 30).toBe(0)
    }
  })

  it("spreads different names over more than one hue", () => {
    const hues = new Set(
      [
        "Boulangerie Les Trois Meules",
        "Studio Pixel & Fils SARL",
        "Éditions du Petit Phare",
        "Maison Bellerive SAS",
      ].map(tintHueOf),
    )
    expect(hues.size).toBeGreaterThan(1)
  })
})
