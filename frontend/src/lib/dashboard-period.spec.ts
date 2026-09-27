import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  dashboardPeriodToParams,
  parseDashboardPeriodParams,
  resolveDashboardPeriod,
} from "./dashboard-period"

let originalTimezone: string | undefined

beforeEach(() => {
  originalTimezone = process.env.TZ
})

afterEach(() => {
  process.env.TZ = originalTimezone
})

describe("resolveDashboardPeriod", () => {
  it('"all" resolves to undefined - the pre-#418 default, unscoped behavior', () => {
    expect(resolveDashboardPeriod({ preset: "all" })).toBeUndefined()
  })

  it('"this-month" resolves to the exact calendar-month boundaries', () => {
    const now = new Date(2026, 1, 15) // 15 February 2026 (not a leap year - 28 days)
    expect(resolveDashboardPeriod({ preset: "this-month" }, now)).toEqual({
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
    })
  })

  it('"this-month" handles a leap-year February', () => {
    expect(resolveDashboardPeriod({ preset: "this-month" }, new Date(2028, 1, 10))).toEqual({
      dateFrom: "2028-02-01",
      dateTo: "2028-02-29",
    })
  })

  it('"this-month" handles a 31-day month and December correctly', () => {
    expect(resolveDashboardPeriod({ preset: "this-month" }, new Date(2026, 0, 5))).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    })
    expect(resolveDashboardPeriod({ preset: "this-month" }, new Date(2026, 11, 25))).toEqual({
      dateFrom: "2026-12-01",
      dateTo: "2026-12-31",
    })
  })

  it('"this-year" resolves to 1 January through 31 December of the current year', () => {
    expect(resolveDashboardPeriod({ preset: "this-year" }, new Date(2026, 5, 1))).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })
  })

  it('"last-30-days" is inclusive of today - a 30-day span, today counted as one of the 30', () => {
    const now = new Date(2026, 7, 30) // 30 August 2026
    const result = resolveDashboardPeriod({ preset: "last-30-days" }, now)
    expect(result?.dateTo).toBe("2026-08-30")
    expect(result?.dateFrom).toBe("2026-08-01")
    // Exactly 30 calendar days apart, inclusive on both ends.
    const from = new Date(result?.dateFrom as string)
    const to = new Date(result?.dateTo as string)
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1).toBe(30)
  })

  it('"last-30-days" crosses a month/year boundary correctly', () => {
    const result = resolveDashboardPeriod({ preset: "last-30-days" }, new Date(2026, 0, 10))
    expect(result).toEqual({ dateFrom: "2025-12-12", dateTo: "2026-01-10" })
  })

  it('"custom" passes the given bounds through untouched when both are present and ordered', () => {
    expect(
      resolveDashboardPeriod({ preset: "custom", dateFrom: "2026-03-01", dateTo: "2026-03-31" }),
    ).toEqual({ dateFrom: "2026-03-01", dateTo: "2026-03-31" })
  })

  it('"custom" with only one bound resolves to undefined - never a guessed open end', () => {
    expect(resolveDashboardPeriod({ preset: "custom", dateFrom: "2026-03-01" })).toBeUndefined()
    expect(resolveDashboardPeriod({ preset: "custom", dateTo: "2026-03-31" })).toBeUndefined()
    expect(resolveDashboardPeriod({ preset: "custom" })).toBeUndefined()
  })

  it('"custom" with dateFrom after dateTo resolves to undefined rather than an inverted range', () => {
    expect(
      resolveDashboardPeriod({ preset: "custom", dateFrom: "2026-04-01", dateTo: "2026-03-01" }),
    ).toBeUndefined()
  })

  it("resolves using the LOCAL calendar, whatever the timezone", () => {
    process.env.TZ = "Pacific/Kiritimati" // UTC+14 - as far east as timezones go
    expect(resolveDashboardPeriod({ preset: "this-month" }, new Date(2026, 2, 1))).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
    })
  })
})

describe("parseDashboardPeriodParams", () => {
  it("no period param at all -> all", () => {
    expect(parseDashboardPeriodParams(new URLSearchParams())).toEqual({ preset: "all" })
  })

  it("an unrecognized period value degrades to all, never a crash or a guess", () => {
    expect(parseDashboardPeriodParams(new URLSearchParams("period=nonsense"))).toEqual({ preset: "all" })
  })

  it("a plain preset round-trips", () => {
    expect(parseDashboardPeriodParams(new URLSearchParams("period=this-month"))).toEqual({
      preset: "this-month",
    })
  })

  it("custom reads dateFrom/dateTo alongside the preset", () => {
    expect(
      parseDashboardPeriodParams(new URLSearchParams("period=custom&dateFrom=2026-01-01&dateTo=2026-01-31")),
    ).toEqual({ preset: "custom", dateFrom: "2026-01-01", dateTo: "2026-01-31" })
  })

  it("custom with no dates yet (mid-pick) reads as an incomplete custom selection", () => {
    expect(parseDashboardPeriodParams(new URLSearchParams("period=custom"))).toEqual({
      preset: "custom",
      dateFrom: undefined,
      dateTo: undefined,
    })
  })
})

describe("dashboardPeriodToParams", () => {
  it("all clears every key, including a stale custom range", () => {
    expect(dashboardPeriodToParams({ preset: "all" })).toEqual({
      period: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it("a plain preset writes only `period`", () => {
    expect(dashboardPeriodToParams({ preset: "this-year" })).toEqual({
      period: "this-year",
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it("custom writes all three keys", () => {
    expect(
      dashboardPeriodToParams({ preset: "custom", dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
    ).toEqual({ period: "custom", dateFrom: "2026-01-01", dateTo: "2026-01-31" })
  })

  it("round-trips through parseDashboardPeriodParams for every preset", () => {
    for (const selection of [
      { preset: "all" as const },
      { preset: "this-month" as const },
      { preset: "this-year" as const },
      { preset: "last-30-days" as const },
      { preset: "custom" as const, dateFrom: "2026-02-01", dateTo: "2026-02-28" },
    ]) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(dashboardPeriodToParams(selection))) {
        if (value !== undefined) params.set(key, value)
      }
      expect(parseDashboardPeriodParams(params)).toEqual(selection)
    }
  })
})
