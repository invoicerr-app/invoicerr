/**
 * `csv-parse.ts` against three BINARY-EXACT fixtures (`__fixtures__/`, generated once with a script
 * producing the exact bytes - see the issue's own requirement) rather than a string literal a test
 * runner's own source encoding could silently "fix": a semicolon-separated file, a genuine
 * Windows-1252 file with accented characters, and a UTF-8 file carrying a real BOM. Also covers the
 * RFC 4180 embedded-delimiter/quote/newline cases directly, and `mapRow`'s `identifier:<SCHEME>`
 * column convention.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { decodeCsvBytes, detectDelimiter, parseCsv, stripFormulaGuard } from "./csv-parse"
import { mapRow } from "./csv-import/client-rows"

function fixtureBuffer(name: string): ArrayBuffer {
  const buffer = readFileSync(join(__dirname, "__fixtures__", name))
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

describe("decodeCsvBytes", () => {
  it("decodes a semicolon-separated UTF-8 file and strips no BOM (none present)", () => {
    const text = decodeCsvBytes(fixtureBuffer("semicolon-utf8.csv"))
    expect(text.startsWith("type;name;country;countryCode")).toBe(true)
    expect(text).toContain("Société Générale")
  })

  it("falls back to Windows-1252 for bytes that are not valid UTF-8, recovering accents", () => {
    const text = decodeCsvBytes(fixtureBuffer("windows-1252.csv"))
    expect(text).toContain("Société Générale")
    expect(text).toContain("Müller")
    expect(text).toContain("Crédit Local")
  })

  it("strips a leading UTF-8 BOM so it never lands in the first header name", () => {
    const text = decodeCsvBytes(fixtureBuffer("utf8-bom.csv"))
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
    expect(text.startsWith("type,name,country,countryCode")).toBe(true)
    const { headers } = parseCsv(text)
    expect(headers[0]).toBe("type")
  })
})

describe("detectDelimiter", () => {
  it("picks semicolon when it outnumbers commas in the header line", () => {
    expect(detectDelimiter("type;name;country;countryCode")).toBe(";")
  })
  it("picks comma otherwise", () => {
    expect(detectDelimiter("type,name,country,countryCode")).toBe(",")
  })
})

describe("parseCsv - RFC 4180", () => {
  it("parses the semicolon fixture into headers + one data row", () => {
    const text = decodeCsvBytes(fixtureBuffer("semicolon-utf8.csv"))
    const { headers, rows } = parseCsv(text, ";")
    expect(headers).toEqual(["type", "name", "country", "countryCode"])
    expect(rows).toEqual([["COMPANY", "Société Générale", "France", "FR"]])
  })

  it("handles a quoted field embedding the delimiter", () => {
    const { rows } = parseCsv('a,b\n"1,2",three', ",")
    expect(rows).toEqual([["1,2", "three"]])
  })

  it("handles a doubled quote inside a quoted field", () => {
    const { rows } = parseCsv('a,b\n"say ""hi""",two', ",")
    expect(rows).toEqual([['say "hi"', "two"]])
  })

  it("handles a quoted field embedding a real newline", () => {
    const { rows } = parseCsv('a,b\n"line1\nline2",two', ",")
    expect(rows).toEqual([["line1\nline2", "two"]])
  })

  it("pads a short row with empty strings rather than throwing", () => {
    const { rows } = parseCsv("a,b,c\n1,2", ",")
    expect(rows).toEqual([["1", "2", ""]])
  })
})

describe("mapRow - identifier:<SCHEME> columns", () => {
  it("collects every identifier: column, uppercasing the scheme, dropping blanks", () => {
    const headers = ["type", "name", "identifier:VAT", "identifier:siret", "identifier:EIN"]
    const cells = ["COMPANY", "Acme", "FR12345678901", "55210055400018", ""]
    const { wire, shapeErrors } = mapRow(headers, cells, 2)
    expect(shapeErrors).toEqual([])
    expect(wire.identifiers).toEqual([
      { scheme: "VAT", value: "FR12345678901" },
      { scheme: "SIRET", value: "55210055400018" },
    ])
  })

  it("ignores an unrecognised plain column without failing the row", () => {
    const headers = ["type", "name", "notAColumnWeKnow"]
    const cells = ["COMPANY", "Acme", "whatever"]
    const { wire, shapeErrors } = mapRow(headers, cells, 2)
    expect(shapeErrors).toEqual([])
    expect(wire.name).toBe("Acme")
  })
})

describe("stripFormulaGuard - undoes toCsvLine's own formula-injection prefix", () => {
  it("removes a leading apostrophe guarding a plus-prefixed value", () => {
    expect(stripFormulaGuard("'+33 1 23 45 67 89")).toBe("+33 1 23 45 67 89")
  })
  it("removes a leading apostrophe guarding an equals-prefixed value", () => {
    expect(stripFormulaGuard("'=SUM(A1:A2)")).toBe("=SUM(A1:A2)")
  })
  it("leaves an unguarded plus-prefixed value unchanged (no apostrophe to strip)", () => {
    expect(stripFormulaGuard("+33 1 23 45 67 89")).toBe("+33 1 23 45 67 89")
  })
  it("leaves a legitimate apostrophe-led value unchanged when not followed by a guard character", () => {
    expect(stripFormulaGuard("'Twas a good day")).toBe("'Twas a good day")
  })
  it("leaves a bare apostrophe unchanged", () => {
    expect(stripFormulaGuard("'")).toBe("'")
  })

  it("parseCsv applies it to every cell, so the downloaded template's own guarded phone value round-trips", () => {
    const csv = "type,contactPhone\r\nCOMPANY,'+33 1 23 45 67 89\r\n"
    const { rows } = parseCsv(csv, ",")
    expect(rows[0][1]).toBe("+33 1 23 45 67 89")
  })
})
