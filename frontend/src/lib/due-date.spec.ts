import { afterEach, describe, expect, it } from "vitest"

import { computeDueDate } from "./due-date"

const originalTimezone = process.env.TZ
afterEach(() => {
  process.env.TZ = originalTimezone
})

describe("computeDueDate", () => {
  it("adds net days across a month boundary", () => {
    expect(computeDueDate("2026-10-01", { days: 30, mode: "net" })).toBe("2026-10-31")
    expect(computeDueDate("2026-10-20", { days: 30, mode: "net" })).toBe("2026-11-19")
  })

  it("counts zero days as the issue date itself", () => {
    expect(computeDueDate("2026-10-01", { days: 0, mode: "net" })).toBe("2026-10-01")
  })

  it("goes to the last day of the month reached for end of month", () => {
    expect(computeDueDate("2026-10-01", { days: 30, mode: "endOfMonth" })).toBe("2026-10-31")
    expect(computeDueDate("2026-10-15", { days: 30, mode: "endOfMonth" })).toBe("2026-11-30")
    expect(computeDueDate("2026-10-31", { days: 0, mode: "endOfMonth" })).toBe("2026-10-31")
  })

  it("rolls the year over", () => {
    expect(computeDueDate("2026-12-20", { days: 30, mode: "endOfMonth" })).toBe("2027-01-31")
    expect(computeDueDate("2026-12-20", { days: 30, mode: "net" })).toBe("2027-01-19")
  })

  it("handles February, leap and non-leap", () => {
    expect(computeDueDate("2026-01-31", { days: 28, mode: "endOfMonth" })).toBe("2026-02-28")
    expect(computeDueDate("2028-01-31", { days: 28, mode: "endOfMonth" })).toBe("2028-02-29")
    expect(computeDueDate("2026-02-01", { days: 28, mode: "net" })).toBe("2026-03-01")
  })

  it("returns nothing for a missing or impossible issue date", () => {
    expect(computeDueDate(undefined, { days: 30, mode: "net" })).toBeUndefined()
    expect(computeDueDate("", { days: 30, mode: "net" })).toBeUndefined()
    expect(computeDueDate("2026-02-30", { days: 30, mode: "net" })).toBeUndefined()
  })

  for (const timezone of ["Europe/Paris", "America/Los_Angeles", "UTC"]) {
    it(`gives the same calendar day across a DST change in ${timezone}`, () => {
      process.env.TZ = timezone
      expect(computeDueDate("2026-03-20", { days: 30, mode: "net" })).toBe("2026-04-19")
      expect(computeDueDate("2026-10-10", { days: 30, mode: "net" })).toBe("2026-11-09")
    })
  }
})
