import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { type IdentifierRequirement, identifierHelpText } from "./use-required-identifiers"

const COUNTRY_DATA_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "backend",
  "src",
  "modules",
  "documents",
  "countries",
  "data",
)
const EN = JSON.parse(readFileSync(join(__dirname, "..", "locales", "en", "translation.json"), "utf8"))

function lookup(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], EN)
}

function declaredHelpTextKeys(): string[] {
  return readdirSync(COUNTRY_DATA_DIR)
    .filter((name) => /^[a-z]{2}\.json$/.test(name))
    .flatMap((name) => {
      const file = JSON.parse(readFileSync(join(COUNTRY_DATA_DIR, name), "utf8"))
      const schemes: { helpTextKey?: string }[] = file.identifiers?.schemes ?? []
      return schemes.flatMap((scheme) => (scheme.helpTextKey ? [scheme.helpTextKey] : []))
    })
}

function leafKeys(node: unknown, prefix: string): string[] {
  if (typeof node !== "object" || node === null) return [prefix]
  return Object.entries(node).flatMap(([key, child]) => leafKeys(child, `${prefix}.${key}`))
}

const requirement = (overrides: Partial<IdentifierRequirement>): IdentifierRequirement => ({
  scheme: "LEGAL_ID",
  label: "SIREN / SIRET",
  appliesTo: "BOTH",
  required: true,
  ...overrides,
})

const t = (key: string, defaultValue: string) => (key === "known.key" ? "Translated help" : defaultValue)

describe("identifierHelpText", () => {
  it("translates a catalog requirement's helpTextKey and ignores its English helpText", () => {
    const req = requirement({ helpText: "9 digits", helpTextKey: "known.key" })
    expect(identifierHelpText(req, [req], t)).toBe("Translated help")
  })

  it("shows nothing for a catalog requirement with no helpTextKey", () => {
    const req = requirement({ helpText: "9 digits" })
    expect(identifierHelpText(req, [req], t)).toBeUndefined()
  })

  it("shows the display text of a requirement the frontend added itself", () => {
    const req = requirement({ scheme: "VAT", helpText: "Your VAT number" })
    expect(identifierHelpText(req, [], t)).toBe("Your VAT number")
  })
})

describe("identifier help text keys", () => {
  const declared = declaredHelpTextKeys()

  it("finds the keys the country files declare", () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it.each(declared)("%s has an English text", (key) => {
    expect(typeof lookup(key)).toBe("string")
  })

  it("has no English help text that no country file points to", () => {
    const defined = leafKeys(EN.settings.identifiers.help, "settings.identifiers.help")
    expect(defined.filter((key) => !declared.includes(key))).toEqual([])
  })
})
