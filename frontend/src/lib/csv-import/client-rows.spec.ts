/**
 * `mapRow`'s own closed-set coercions - an EMPTY cell defaults (COMPANY/BUSINESS/not-a-supplier/no
 * date), any OTHER unrecognised value is a `shapeErrors` entry naming the column and the value,
 * never a silent guess. See `mapRow`'s own header for why (the exact "Individuel" -> COMPANY,
 * "25/09/2020" -> dropped/misread failure modes this replaces).
 */
import { describe, expect, it } from "vitest"

import { mapRow } from "./client-rows"

const HEADERS = ["type", "kind", "isSupplier", "name", "foundedAt", "currency", "country", "countryCode"]

function row(cells: Partial<Record<(typeof HEADERS)[number], string>>) {
  return mapRow(
    HEADERS,
    HEADERS.map((h) => cells[h] ?? ""),
    2,
  )
}

describe("mapRow - type", () => {
  it("defaults an empty cell to COMPANY", () => {
    expect(row({}).wire.type).toBe("COMPANY")
    expect(row({}).shapeErrors).toEqual([])
  })
  it("accepts COMPANY/INDIVIDUAL case-insensitively", () => {
    expect(row({ type: "individual" }).wire.type).toBe("INDIVIDUAL")
  })
  it("rejects an unrecognised value instead of silently defaulting to COMPANY", () => {
    const { wire, shapeErrors } = row({ type: "Individuel" })
    expect(wire.type).toBeUndefined()
    expect(shapeErrors).toEqual([
      'Unknown type: "Individuel" (column "type", expected COMPANY or INDIVIDUAL).',
    ])
  })
})

describe("mapRow - kind", () => {
  it("defaults an empty cell to BUSINESS", () => {
    expect(row({}).wire.kind).toBe("BUSINESS")
  })
  it("rejects an unrecognised value", () => {
    const { shapeErrors } = row({ kind: "Public" })
    expect(shapeErrors).toEqual(['Unknown kind: "Public" (column "kind", expected BUSINESS or GOVERNMENT).'])
  })
})

describe("mapRow - isSupplier", () => {
  it("defaults an empty cell to false", () => {
    expect(row({}).wire.isSupplier).toBe(false)
  })
  it.each(["true", "1", "yes", "vrai", "oui", "TRUE"])("accepts %s as true", (value) => {
    expect(row({ isSupplier: value }).wire.isSupplier).toBe(true)
  })
  it.each(["false", "0", "no", "non", "faux"])("accepts %s as false", (value) => {
    expect(row({ isSupplier: value }).wire.isSupplier).toBe(false)
  })
  it("rejects an unrecognised value", () => {
    const { shapeErrors } = row({ isSupplier: "maybe" })
    expect(shapeErrors).toEqual(['Unknown value: "maybe" (column "isSupplier", expected true or false).'])
  })
})

describe("mapRow - foundedAt", () => {
  it("leaves an empty cell undefined", () => {
    expect(row({}).wire.foundedAt).toBeUndefined()
  })
  it("accepts YYYY-MM-DD", () => {
    expect(row({ foundedAt: "2020-09-25" }).wire.foundedAt).toBe("2020-09-25")
  })
  it("rejects a DD/MM/YYYY value instead of guessing an order", () => {
    const { wire, shapeErrors } = row({ foundedAt: "25/09/2020" })
    expect(wire.foundedAt).toBeUndefined()
    expect(shapeErrors).toEqual(['Invalid date: "25/09/2020" (column "foundedAt", expected YYYY-MM-DD).'])
  })
  it("rejects a calendar-invalid YYYY-MM-DD value", () => {
    const { shapeErrors } = row({ foundedAt: "2020-13-40" })
    expect(shapeErrors).toEqual(['Invalid date: "2020-13-40" (column "foundedAt", expected YYYY-MM-DD).'])
  })
})

describe("mapRow - currency", () => {
  it("leaves an empty cell undefined", () => {
    expect(row({}).wire.currency).toBeUndefined()
  })
  it("accepts a known ISO 4217 code case-insensitively", () => {
    expect(row({ currency: "eur" }).wire.currency).toBe("EUR")
  })
  it("rejects an unknown code", () => {
    const { shapeErrors } = row({ currency: "ZZZ" })
    expect(shapeErrors).toEqual(['Unknown currency: "ZZZ" (column "currency", expected an ISO 4217 code).'])
  })
})
