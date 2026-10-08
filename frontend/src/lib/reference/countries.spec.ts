import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { DOCUMENT_LANGUAGE_CODES } from "@/components/document-language-select"
import { currencies } from "@/lib/constants/currencies"
import { countryCodes } from "@/lib/constants/countries"
import { currencyForCountry, documentLanguageForCountry } from "./countries"
import reference from "./countries.json"

const BACKEND_COUNTRIES_DIR = join(__dirname, "../../../../backend/src/modules/documents/countries/data")

interface BackendCountryFile {
  countryCode: string
  policy?: { domesticInvoiceCurrency?: { currency: string } }
  vatCurrency?: { rule: { nationalCurrency: string } }
}

function backendCountryFiles(): BackendCountryFile[] {
  return readdirSync(BACKEND_COUNTRIES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(BACKEND_COUNTRIES_DIR, name), "utf8")) as BackendCountryFile)
}

describe("documentLanguageForCountry", () => {
  it.each([
    ["FR", "fr"],
    ["PL", "pl"],
    ["IT", "it"],
    ["PT", "pt"],
    ["DE", "de"],
    ["AT", "de"],
    ["BR", "pt"],
    ["US", "en"],
    ["LU", "fr"],
  ])("suggests a language for %s", (countryCode, language) => {
    expect(documentLanguageForCountry(countryCode)).toBe(language)
  })

  it.each(["BE", "CH", "NL", "SE", "ZZ"])("suggests nothing for %s", (countryCode) => {
    expect(documentLanguageForCountry(countryCode)).toBeUndefined()
  })

  it.each([undefined, null, "", "   "])("suggests nothing for a missing country code (%j)", (countryCode) => {
    expect(documentLanguageForCountry(countryCode)).toBeUndefined()
  })

  it("is case-insensitive", () => {
    expect(documentLanguageForCountry("pl")).toBe("pl")
  })

  it("only ever names a language documents can be rendered in", () => {
    const languages = Object.values(reference).flatMap((entry) =>
      "documentLanguage" in entry ? [entry.documentLanguage] : [],
    )
    expect(
      languages.filter((language) => !DOCUMENT_LANGUAGE_CODES.some((code) => code === language)),
    ).toEqual([])
  })
})

describe("currencyForCountry", () => {
  it.each([
    ["DE", "EUR"],
    ["PL", "PLN"],
    ["GB", "GBP"],
    ["ch", "CHF"],
  ])("resolves %s to %s", (countryCode, currency) => {
    expect(currencyForCountry(countryCode)).toBe(currency)
  })

  it("resolves nothing for an unknown or missing country code", () => {
    expect(currencyForCountry("ZZ")).toBeUndefined()
    expect(currencyForCountry(undefined)).toBeUndefined()
  })

  it("covers every country the country picker offers, with a currency the currency picker offers", () => {
    expect(countryCodes.filter((code) => !currencyForCountry(code))).toEqual([])
    const unknown = Object.values(reference).filter((entry) => !(entry.currency in currencies))
    expect(unknown).toEqual([])
  })

  it("agrees with the domestic currency of every backend country file", () => {
    const files = backendCountryFiles()
    expect(files.length).toBeGreaterThan(0)
    const disagreements = files.flatMap((file) => {
      const backend =
        file.policy?.domesticInvoiceCurrency?.currency ?? file.vatCurrency?.rule.nationalCurrency
      const frontend = currencyForCountry(file.countryCode)
      return backend === frontend ? [] : [{ countryCode: file.countryCode, backend, frontend }]
    })
    expect(disagreements).toEqual([])
  })
})
