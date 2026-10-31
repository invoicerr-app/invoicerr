import { describe, expect, it } from "vitest"

import { languageToLocale, normalizeLanguageTag, resolveAppLanguage, SUPPORTED_LANGUAGES } from "./i18n"

// Every value `i18n.language` can take that resolves to a locale other than en-US, with that locale.
const EXPECTED_DATE_LOCALE: Record<string, string> = {
  ar: "ar",
  "ar-DZ": "ar-DZ",
  "ar-EG": "ar-EG",
  "ar-MA": "ar-MA",
  "ar-SA": "ar-SA",
  "ar-TN": "ar-TN",
  cs: "cs",
  de: "de",
  "de-AT": "de-AT",
  "en-AU": "en-AU",
  "en-CA": "en-CA",
  "en-GB": "en-GB",
  "en-IE": "en-IE",
  "en-IN": "en-IN",
  "en-NZ": "en-NZ",
  "en-ZA": "en-ZA",
  es: "es",
  fr: "fr",
  "fr-CA": "fr-CA",
  "fr-CH": "fr-CH",
  it: "it",
  "it-CH": "it-CH",
  nl: "nl",
  "nl-BE": "nl-BE",
  pl: "pl",
  da: "da",
  he: "he",
  ja: "ja",
  ko: "ko",
  "pt-BR": "pt-BR",
  ru: "ru",
  sv: "sv",
  uk: "uk",
}

describe("languageToLocale", () => {
  it.each(Object.entries(EXPECTED_DATE_LOCALE))("resolves %s to the %s date-fns locale", (language, code) => {
    expect(languageToLocale(language).code).toBe(code)
  })

  it("gives every supported language a date-fns locale of that language", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(languageToLocale(code).code.split("-")[0]).toBe(code)
    }
  })

  it.each([
    "en",
    "en-US",
    "zh-Hans",
    "kab",
    "rtltest",
    "xx",
    "",
    "constructor",
  ])("falls back to en-US for %j", (language) => {
    expect(languageToLocale(language).code).toBe("en-US")
  })

  // Issue #733: a regional browser code whose base language this app ships must use that base
  // language's dates, never English.
  it.each([
    ["fr-FR", "fr"],
    ["fr-CA", "fr-CA"],
    ["de-CH", "de"],
    ["es-MX", "es"],
    ["en-US@posix", "en-US"],
    ["it_IT", "it"],
  ])("resolves the regional code %s to the %s date-fns locale", (language, code) => {
    expect(languageToLocale(language).code).toBe(code)
  })
})

describe("normalizeLanguageTag", () => {
  it.each([
    ["en-US@posix", "en-US"],
    ["en_US@euro", "en-US"],
    ["FR-fr", "fr-FR"],
    ["fr", "fr"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeLanguageTag(raw)).toBe(expected)
  })

  it.each([
    "",
    "  ",
    "@posix",
    "not a tag",
    "constructor",
    null,
    undefined,
  ])("rejects %j, which no Intl constructor may receive", (raw) => {
    expect(normalizeLanguageTag(raw)).toBeNull()
  })
})

describe("resolveAppLanguage", () => {
  // Issue #718: the POSIX suffix never reaches i18n or Intl.
  it("strips a POSIX locale suffix", () => {
    expect(resolveAppLanguage("en-US@posix")).toBe("en")
  })

  // Issue #733: the interface and the dates must agree.
  it.each([
    ["fr-FR", "fr"],
    ["de-CH", "de"],
    ["es-MX", "es"],
    ["en-US", "en"],
  ])("maps the regional code %s to the supported base %s", (raw, expected) => {
    expect(resolveAppLanguage(raw)).toBe(expected)
  })

  it.each([
    "ja",
    "ko",
    "ru",
    "pt-BR",
    "zh-Hans",
    "xx",
    "",
    "not a tag",
  ])("falls back to en for the unsupported language %j", (raw) => {
    expect(resolveAppLanguage(raw)).toBe("en")
  })

  it("keeps every supported language unchanged", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(resolveAppLanguage(code)).toBe(code)
    }
  })

  it("produces a tag every Intl constructor accepts", () => {
    for (const raw of ["en-US@posix", "fr-FR", "ja", "", "xx", "not a tag"]) {
      const resolved = resolveAppLanguage(raw)
      expect(() => new Intl.DisplayNames([resolved], { type: "region" })).not.toThrow()
      expect(() => new Intl.ListFormat(resolved)).not.toThrow()
    }
  })
})
