import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { activeCauseDay, CAUSE_DAYS } from "./cause-days"

describe("activeCauseDay", () => {
  it("returns undefined on an ordinary day", () => {
    expect(activeCauseDay(new Date(2026, 4, 16))).toBeUndefined() // May 16
    expect(activeCauseDay(new Date(2026, 11, 20))).toBeUndefined() // December 20
  })

  it("does not crash on 29 February and finds no cause that day", () => {
    // 2028 is a leap year — this date only exists at all every 4 years, and no catalog entry falls on it.
    expect(activeCauseDay(new Date(2028, 1, 29))).toBeUndefined()
  })

  it("matches every fixed-date entry on its own day", () => {
    const fixedCases: Array<[id: string, year: number, month: number, day: number]> = [
      ["zero-discrimination-day", 2026, 3, 1],
      ["international-womens-day", 2026, 3, 8],
      ["elimination-of-racial-discrimination-day", 2026, 3, 21],
      ["earth-day", 2026, 4, 22],
      ["international-day-of-persons-with-disabilities", 2026, 12, 3],
    ]
    for (const [id, year, month, day] of fixedCases) {
      const found = activeCauseDay(new Date(year, month - 1, day))
      expect(found?.id, `${id} on ${year}-${month}-${day}`).toBe(id)
    }
  })

  it("treats Pride Month as the whole range but not the days just outside it", () => {
    expect(activeCauseDay(new Date(2026, 5, 1))?.id).toBe("pride-month") // June 1
    expect(activeCauseDay(new Date(2026, 5, 30))?.id).toBe("pride-month") // June 30
    expect(activeCauseDay(new Date(2026, 5, 15))?.id).toBe("pride-month") // June 15, mid-range
    expect(activeCauseDay(new Date(2026, 4, 31))).toBeUndefined() // May 31
    expect(activeCauseDay(new Date(2026, 6, 1))).toBeUndefined() // July 1
  })

  it("is a pure function of the date passed in, independent of the system clock", () => {
    const a = activeCauseDay(new Date(2026, 2, 8))
    const b = activeCauseDay(new Date(2026, 2, 8))
    expect(a).toEqual(b)
  })
})

describe("CAUSE_DAYS catalog", () => {
  it("has exactly the six entries the owner kept", () => {
    expect(new Set(CAUSE_DAYS.map((c) => c.id))).toEqual(
      new Set([
        "zero-discrimination-day",
        "international-womens-day",
        "elimination-of-racial-discrimination-day",
        "earth-day",
        "pride-month",
        "international-day-of-persons-with-disabilities",
      ]),
    )
  })

  it("has unique ids and variants", () => {
    const ids = CAUSE_DAYS.map((c) => c.id)
    const variants = CAUSE_DAYS.map((c) => c.variant)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(variants).size).toBe(variants.length)
  })

  it("every entry has a real https source", () => {
    for (const cause of CAUSE_DAYS) {
      expect(cause.source.startsWith("https://")).toBe(true)
    }
  })

  // Guards against exactly the drift this codebase's other data catalogs already guard against
  // (country-policy/drift.spec.ts, country-identifiers/drift.spec.ts): a catalog entry naming a
  // variant whose SVG was never generated, or renamed out from under it.
  it("has a generated SVG file for every variant", () => {
    const causesDir = join(__dirname, "..", "..", "public", "brand", "causes")
    for (const cause of CAUSE_DAYS) {
      const svgPath = join(causesDir, `${cause.variant}.svg`)
      expect(existsSync(svgPath), `${svgPath} should exist for ${cause.id}`).toBe(true)
    }
  })

  // Every id needs a label + description in en/translation.json (brand-mark.tsx's tooltip reads
  // them via a dynamic t(`brand.causeDays.${id}.label`) key the static i18n:check script can't
  // verify by itself — see its own comment on dynamic patterns).
  it("has a label and description in en/translation.json for every entry", () => {
    const en = JSON.parse(readFileSync(join(__dirname, "..", "locales", "en", "translation.json"), "utf8"))
    for (const cause of CAUSE_DAYS) {
      const entry = en.brand?.causeDays?.[cause.id]
      expect(entry?.label, `brand.causeDays.${cause.id}.label`).toBeTruthy()
      expect(entry?.description, `brand.causeDays.${cause.id}.description`).toBeTruthy()
    }
  })
})
