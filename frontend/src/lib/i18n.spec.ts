import i18n from "i18next"
import { afterEach, describe, expect, it, vi } from "vitest"

import { languageToLocale, normalizeLanguageTag, SUPPORTED_LANGUAGES } from "./i18n"

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
    ["fr_FR.UTF-8", "fr-FR"],
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

describe("detected browser language", () => {
  const detector = i18n.services.languageDetector as { detect: () => string[] }

  // i18next's runtime applies the detector's whole list (that is how init uses it), but its type
  // only advertises a single code.
  const changeLanguageTo = (languages: string[]) =>
    (i18n.changeLanguage as unknown as (lng: string[]) => Promise<unknown>)(languages)

  function detect(languages: string[]): string[] {
    localStorage.clear()
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages)
    vi.spyOn(window.navigator, "language", "get").mockReturnValue(languages[0])
    try {
      return detector.detect()
    } finally {
      vi.restoreAllMocks()
    }
  }

  afterEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage("en")
  })

  // Issue #733: the regional code must reach languageToLocale, which maps en-GB to date-fns' en-GB.
  it("keeps en-GB so its dates stay en-GB", async () => {
    const detected = detect(["en-GB"])
    expect([...new Set(detected)]).toEqual(["en-GB"])

    await changeLanguageTo(detected)

    expect(i18n.language).toBe("en-GB")
    expect(i18n.resolvedLanguage).toBe("en")
    expect(languageToLocale(i18n.language).code).toBe("en-GB")
  })

  // Issue #733: converting each detected code to "en" let English win before the next language.
  it("lets a later supported language win over an unsupported one", async () => {
    const detected = detect(["ja-JP", "fr-FR"])
    expect(detected.filter(Boolean)).toEqual(["fr-FR"])

    await changeLanguageTo(detected)

    expect(i18n.resolvedLanguage).toBe("fr")
    expect(languageToLocale(i18n.language).code).toBe("fr")
  })

  // Issue #733 review: `normalizeLanguageTag(...) ?? "en"` put an `en` in the middle of the
  // detected list, where it beat the French that followed. An invalid entry must stay empty.
  it("lets a later supported language win when an earlier detected value is not a tag", async () => {
    const detected = detect(["not a tag", "fr-FR"])
    expect(detected).not.toContain("en")

    await changeLanguageTo(detected)

    expect(i18n.resolvedLanguage).toBe("fr")
    expect(languageToLocale(i18n.language).code).toBe("fr")
  })

  it("falls back to English when every detected value is not a tag", async () => {
    const detected = detect(["not a tag", "still not a tag"])

    await changeLanguageTo(detected)

    expect(i18n.language).toBe("en")
    expect(languageToLocale(i18n.language).code).toBe("en-US")
  })

  // Issue #733, second case: a stub catalog folder makes i18next adopt a bare "ja" verbatim, so
  // the interface went English but the dates stayed Japanese. The detector must drop it.
  it("keeps the dates in English for a stub catalog language such as ja", async () => {
    const detected = detect(["ja"])
    expect(detected).not.toContain("ja")

    await changeLanguageTo(detected)

    expect(i18n.language).toBe("en")
    expect(languageToLocale(i18n.language).code).toBe("en-US")
  })

  it("falls back to English when every detected language is unsupported", async () => {
    const detected = detect(["ja-JP"])
    expect(detected.every((code) => code === "")).toBe(true)

    await changeLanguageTo(detected)

    expect(i18n.language).toBe("en")
    expect(languageToLocale(i18n.language).code).toBe("en-US")
  })

  // Issue #718: the POSIX suffix never reaches i18n or an Intl constructor.
  it("turns en-US@posix into a tag Intl accepts", async () => {
    const detected = detect(["en-US@posix"])
    expect([...new Set(detected)]).toEqual(["en-US"])

    await changeLanguageTo(detected)

    expect(() => new Intl.DisplayNames([i18n.language], { type: "region" })).not.toThrow()
    expect(languageToLocale(i18n.language).code).toBe("en-US")
  })

  it("turns a POSIX codeset into a tag Intl accepts", async () => {
    const detected = detect(["fr_FR.UTF-8"])
    expect([...new Set(detected)]).toEqual(["fr-FR"])

    await changeLanguageTo(detected)

    expect(i18n.resolvedLanguage).toBe("fr")
  })
})
