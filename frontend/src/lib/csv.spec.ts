import { describe, expect, it } from "vitest"

import { escapeCsvCell, isSpreadsheetFormula, toCsvLine } from "./csv"

/**
 * The same assertions the backend's own `backend/src/utils/csv.spec.ts` holds, on this project's own
 * copy — the two escapers are a deliberate mirror (see `csv.ts`'s own header), so they are pinned to
 * the same emitted bytes. Assertions are on the BYTES, never on "did it call the escaper".
 */
describe("escapeCsvCell", () => {
  it.each([
    ["=", "=cmd|' /C calc'!A0"],
    ["+", "+cmd|' /C calc'!A0"],
    ["-", "-2+3+cmd|' /C calc'!A0"],
    ["@", "@SUM(1+1)*cmd|' /C calc'!A0"],
  ])('a cell beginning "%s" is prefixed with an apostrophe', (_lead, payload) => {
    expect(escapeCsvCell(payload)).toBe(`'${payload}`)
  })

  it("a payload hidden behind a leading tab is guarded too", () => {
    expect(escapeCsvCell("\t=1+1")).toBe("'\t=1+1")
  })

  it("ordinary text is left exactly as it is, trigger or not, as long as it is not the FIRST char", () => {
    expect(escapeCsvCell("Acme Corp")).toBe("Acme Corp")
    expect(escapeCsvCell("Acme=Corp")).toBe("Acme=Corp")
    expect(escapeCsvCell("Jean-Pierre")).toBe("Jean-Pierre")
    expect(escapeCsvCell("")).toBe("")
  })

  // The constraint the guard lives under: an exported amount must still read as a number.
  it.each([
    "-120.00",
    "-0.01",
    "-1",
    "-1234.56",
    "+120.00",
    "-.5",
  ])("the amount %s is emitted bare", (amount) => {
    expect(escapeCsvCell(amount)).toBe(amount)
    expect(isSpreadsheetFormula(amount)).toBe(false)
  })

  it("a payload that merely OPENS like a negative number is still guarded", () => {
    expect(escapeCsvCell("-1+1")).toBe("'-1+1")
  })

  it("keeps RFC 4180 quoting intact", () => {
    expect(escapeCsvCell("Acme Corp, Ltd")).toBe('"Acme Corp, Ltd"')
    expect(escapeCsvCell('The "Acme" Corp')).toBe('"The ""Acme"" Corp"')
    expect(escapeCsvCell("Acme\nCorp")).toBe('"Acme\nCorp"')
  })

  it("guards BEFORE quoting — a payload carrying its own comma is both guarded and quoted", () => {
    expect(escapeCsvCell("=SUM(1,2)")).toBe('"\'=SUM(1,2)"')
  })
})

describe("toCsvLine", () => {
  it("escapes every cell, then comma-joins", () => {
    expect(toCsvLine(["invoice", "=cmd", "Acme, Ltd", "-120.00"])).toBe('invoice,\'=cmd,"Acme, Ltd",-120.00')
  })
})
