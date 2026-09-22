import { describe, expect, it } from "vitest"

import { getDefaultLanguageForCountry } from "./country-default-language"

describe("getDefaultLanguageForCountry", () => {
  it("resolves a known country to its supported default language", () => {
    expect(getDefaultLanguageForCountry("FR")).toBe("fr")
    expect(getDefaultLanguageForCountry("PL")).toBe("pl")
    expect(getDefaultLanguageForCountry("IT")).toBe("it")
    expect(getDefaultLanguageForCountry("PT")).toBe("pt")
    expect(getDefaultLanguageForCountry("DE")).toBe("de")
  })

  it("resolves an 'evident' country outside the five target markets", () => {
    expect(getDefaultLanguageForCountry("AT")).toBe("de")
    expect(getDefaultLanguageForCountry("BR")).toBe("pt")
    expect(getDefaultLanguageForCountry("US")).toBe("en")
    expect(getDefaultLanguageForCountry("GB")).toBe("en")
    expect(getDefaultLanguageForCountry("CA")).toBe("en")
    expect(getDefaultLanguageForCountry("IE")).toBe("en")
    expect(getDefaultLanguageForCountry("LU")).toBe("fr")
    expect(getDefaultLanguageForCountry("MC")).toBe("fr")
  })

  it("returns no suggestion for a genuinely multilingual country — a guess would be exactly the risk this exists to avoid", () => {
    expect(getDefaultLanguageForCountry("BE")).toBeUndefined()
    expect(getDefaultLanguageForCountry("CH")).toBeUndefined()
  })

  it("returns no suggestion for an unresearched or unsupported-language country", () => {
    expect(getDefaultLanguageForCountry("NL")).toBeUndefined()
    expect(getDefaultLanguageForCountry("SE")).toBeUndefined()
    expect(getDefaultLanguageForCountry("ZZ")).toBeUndefined()
  })

  it("is case-insensitive", () => {
    expect(getDefaultLanguageForCountry("fr")).toBe("fr")
    expect(getDefaultLanguageForCountry("Pl")).toBe("pl")
  })

  it("resolves a known non-ISO alias", () => {
    expect(getDefaultLanguageForCountry("UK")).toBe("en")
  })

  it("returns no suggestion for a blank or missing country code", () => {
    expect(getDefaultLanguageForCountry(undefined)).toBeUndefined()
    expect(getDefaultLanguageForCountry(null)).toBeUndefined()
    expect(getDefaultLanguageForCountry("")).toBeUndefined()
    expect(getDefaultLanguageForCountry("   ")).toBeUndefined()
  })
})
