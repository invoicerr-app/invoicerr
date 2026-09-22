import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { fromCalendarDate, toCalendarDate, todayCalendarDate } from "./calendar-date"

/**
 * Every fixture here sits on a MONTH BOUNDARY, read under timezones whose local midnight falls on
 * the previous UTC day (and ones where it does not). Mid-month the shift this module exists to
 * prevent still happens — it simply lands inside the same month, quarter and fiscal year, where
 * nothing downstream can see it. The shift runs BACKWARD, so the two boundaries differ:
 *
 *  - 1 September 2026, the FIRST of a month, is where it actually crosses — it becomes 31 August,
 *    and 1 September is a date a channel mandate comes into force in this product's own catalogs,
 *    so an invoice issued on that very day would fall out of the mandate that governs it.
 *  - 31 May 2026, the LAST of a month, is the mirror: it becomes 30 May, so a document that has to
 *    fall ON a period's closing day no longer does.
 */

/** FR, PL, IT, PT, DE — every country this product targets sits east of Greenwich, so local midnight
 *  is the PREVIOUS UTC day for all five (two hours in summer, one for Lisbon). */
const EASTERN = ["Europe/Paris", "Europe/Warsaw", "Europe/Rome", "Europe/Lisbon", "Europe/Berlin"]
/** The mirror: local midnight is the SAME UTC day, and a bare calendar day parsed as UTC midnight
 *  reads back as the previous LOCAL day. Reading is where this one bites. */
const WESTERN = ["America/New_York", "America/Los_Angeles"]

let originalTimezone: string | undefined

beforeEach(() => {
  originalTimezone = process.env.TZ
})

afterEach(() => {
  process.env.TZ = originalTimezone
})

describe("toCalendarDate — writing the day the user actually picked", () => {
  for (const timezone of [...EASTERN, ...WESTERN, "UTC"]) {
    it(`writes both month boundaries as the days they are in ${timezone}`, () => {
      process.env.TZ = timezone
      // Exactly what react-day-picker hands back for a click on a day: local midnight.
      expect(toCalendarDate(new Date(2026, 8, 1))).toBe("2026-09-01")
      expect(toCalendarDate(new Date(2026, 4, 31))).toBe("2026-05-31")
      // New Year's Day crosses month, quarter AND fiscal year at once — the worst case for a
      // retention clock counted from `issueDateYearEnd`.
      expect(toCalendarDate(new Date(2026, 0, 1))).toBe("2026-01-01")
    })
  }

  it("writes the day, not the instant, from a value carrying a time of day", () => {
    process.env.TZ = "Europe/Paris"
    // 00:30 local on 1 June is 22:30 UTC on 31 May — `toISOString()` would say May, the wall
    // calendar in the room says June, and the wall calendar is what a legal date means.
    expect(toCalendarDate(new Date(2026, 5, 1, 0, 30))).toBe("2026-06-01")
  })

  it("returns undefined for a cleared field and for an unparseable Date", () => {
    expect(toCalendarDate(null)).toBeUndefined()
    expect(toCalendarDate(undefined)).toBeUndefined()
    expect(toCalendarDate(new Date("nonsense"))).toBeUndefined()
  })
})

describe("fromCalendarDate — reading a stored day back as the same day", () => {
  for (const timezone of [...EASTERN, ...WESTERN, "UTC"]) {
    it(`reads both month boundaries back as the same days in ${timezone}`, () => {
      process.env.TZ = timezone
      for (const [iso, parts] of [
        ["2026-09-01", [2026, 8, 1]],
        ["2026-05-31", [2026, 4, 31]],
        ["2026-01-01", [2026, 0, 1]],
      ] as [string, number[]][]) {
        const date = fromCalendarDate(iso) as Date
        expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual(parts)
        expect([date.getHours(), date.getMinutes()]).toEqual([0, 0])
      }
    })
  }

  // A document saved before this module existed carries the shifted full timestamp, and that shifted
  // day is the one the backend has been treating as its legal date all along (`mandate.ts` reads the
  // literal prefix, `toDateOnly` re-derives the same day through UTC). The screen states it.
  it("reads a legacy full timestamp off its leading day, not off the instant", () => {
    process.env.TZ = "Europe/Paris"
    // What a Paris user's click on 1 September 2026 used to store — the day BEFORE the mandate.
    const date = fromCalendarDate("2026-08-31T22:00:00.000Z") as Date
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 7, 31])
  })

  it("passes a Date through untouched — some forms keep one in their own state", () => {
    const already = new Date(2026, 4, 31, 14, 12)
    expect(fromCalendarDate(already)).toBe(already)
  })

  it("refuses a day the calendar does not have, rather than rolling it into the next month", () => {
    expect(fromCalendarDate("2026-02-30")).toBeNull()
    expect(fromCalendarDate("2026-13-01")).toBeNull()
  })

  it("refuses anything that is not a calendar day at all", () => {
    expect(fromCalendarDate(undefined)).toBeNull()
    expect(fromCalendarDate("")).toBeNull()
    expect(fromCalendarDate("31/05/2026")).toBeNull()
    expect(fromCalendarDate(1780000000000)).toBeNull()
  })

  it("states a two-digit year literally instead of mapping it into the 1900s", () => {
    expect((fromCalendarDate("0099-05-31") as Date).getFullYear()).toBe(99)
  })
})

describe("todayCalendarDate — today where the user is, not where UTC is", () => {
  it("answers the local day even when the UTC day has already moved on", () => {
    process.env.TZ = "Europe/Paris"
    // 00:30 Paris on 1 June 2026 — UTC is still 31 May. `new Date().toISOString()` would record May.
    const localMidnightPastMidnight = new Date(2026, 5, 1, 0, 30)
    expect(toCalendarDate(localMidnightPastMidnight)).toBe("2026-06-01")
    // And the real clock still round-trips through the read side without changing day.
    const today = todayCalendarDate()
    expect(toCalendarDate(fromCalendarDate(today))).toBe(today)
  })
})
