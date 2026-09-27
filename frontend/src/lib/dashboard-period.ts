import { toCalendarDate } from "./calendar-date"

/**
 * The dashboard's own period filter (issue #418) - resolves a preset (or an explicit custom range)
 * to concrete `YYYY-MM-DD` bounds using the BROWSER's own local calendar, exactly the way a document
 * form's own date fields do (see `calendar-date.ts`'s own header: a picked day is a calendar day in
 * the user's own timezone, never a UTC instant). The backend (`GET /api/documents/dashboard`) only
 * ever sees concrete dates - it has no opinion on what "this month" means, this module is the one
 * place that decides.
 *
 * "All time" (the default, and the pre-#418 behavior) is represented as `undefined` throughout, the
 * same convention `ContributionContext.period` holds on the backend - never an explicit "all" range
 * that would need its own special-casing everywhere a range is consumed.
 */
export const DASHBOARD_PERIOD_PRESETS = ["all", "this-month", "this-year", "last-30-days", "custom"] as const
export type DashboardPeriodPreset = (typeof DASHBOARD_PERIOD_PRESETS)[number]

export interface DashboardPeriodSelection {
  preset: DashboardPeriodPreset
  /** Only meaningful (and only ever read) when `preset === "custom"` - a preset resolves its own
   *  bounds from `now`, it never reads these. */
  dateFrom?: string
  dateTo?: string
}

export interface DashboardPeriodRange {
  dateFrom: string
  dateTo: string
}

/** `date`'s own first day of the month it falls in, as a calendar day. */
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** `date`'s own last day of the month it falls in - day 0 of the FOLLOWING month is the last day of
 *  THIS one, the standard JS idiom, and it needs no leap-year/30-vs-31 table of its own. */
function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

/**
 * Resolves `selection` against `now` (the caller's local clock - defaulted to `new Date()`, and
 * always overridable so a test controls it via `process.env.TZ` + a fixed instant, the same pattern
 * `calendar-date.spec.ts` already uses). Returns `undefined` for "all time" and for an incomplete or
 * inverted custom range - never a guessed range: a half-picked custom range behaves exactly like no
 * period at all, until both ends are actually chosen.
 */
export function resolveDashboardPeriod(
  selection: DashboardPeriodSelection,
  now: Date = new Date(),
): DashboardPeriodRange | undefined {
  switch (selection.preset) {
    case "all":
      return undefined

    case "this-month":
      return {
        dateFrom: toCalendarDate(startOfMonth(now)) as string,
        dateTo: toCalendarDate(endOfMonth(now)) as string,
      }

    case "this-year":
      return {
        dateFrom: toCalendarDate(new Date(now.getFullYear(), 0, 1)) as string,
        dateTo: toCalendarDate(new Date(now.getFullYear(), 11, 31)) as string,
      }

    case "last-30-days": {
      // Inclusive of today: today minus 29 days gives a 30-day span (today counts as one of the 30).
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
      return { dateFrom: toCalendarDate(from) as string, dateTo: toCalendarDate(now) as string }
    }

    case "custom": {
      if (!selection.dateFrom || !selection.dateTo) return undefined
      if (selection.dateFrom > selection.dateTo) return undefined // same lexicographic-is-chronological rule the backend's own dto applies
      return { dateFrom: selection.dateFrom, dateTo: selection.dateTo }
    }
  }
}

/** The dashboard's own URL query param names - `period` names the preset, `dateFrom`/`dateTo` carry
 *  the custom range's own bounds (absent/ignored for every other preset). Read with plain
 *  `URLSearchParams` access, exactly the pattern `[typeId]/index.tsx` already uses for its own
 *  filters, so the dashboard page needs no bespoke param-reading logic of its own. */
export function parseDashboardPeriodParams(searchParams: URLSearchParams): DashboardPeriodSelection {
  const period = searchParams.get("period")
  if (period === "custom") {
    return {
      preset: "custom",
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
    }
  }
  if (period && (DASHBOARD_PERIOD_PRESETS as readonly string[]).includes(period)) {
    return { preset: period as DashboardPeriodPreset }
  }
  // An unset, or unrecognized, `period` param defaults to "all" - the pre-#418 behavior, and the
  // same "never guess, degrade to the safe default" posture `document-list.tsx`'s own dangling-key
  // handling holds.
  return { preset: "all" }
}

/** The inverse of `parseDashboardPeriodParams` - what to write into the URL's own query string for a
 *  given selection. "all" clears every one of these three keys (never leaves a stale `dateFrom`
 *  behind from a previous custom range); a plain preset clears `dateFrom`/`dateTo` too, since only
 *  "custom" ever reads them. */
export function dashboardPeriodToParams(
  selection: DashboardPeriodSelection,
): Record<"period" | "dateFrom" | "dateTo", string | undefined> {
  if (selection.preset === "custom") {
    return { period: "custom", dateFrom: selection.dateFrom, dateTo: selection.dateTo }
  }
  return {
    period: selection.preset === "all" ? undefined : selection.preset,
    dateFrom: undefined,
    dateTo: undefined,
  }
}
